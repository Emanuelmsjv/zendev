import * as vscode from 'vscode'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

interface GuardState {
  app: string
  updatedAt: string
  stressIndex: number
  confidence: number
  phase: 'calibrating' | 'flow' | 'strain' | 'guardrail'
  guardrailArmed: boolean
  threshold: number
  disclaimer?: string
}

const PHASE_ICON: Record<string, string> = {
  calibrating: '$(sync~spin)',
  flow: '$(pulse)',
  strain: '$(warning)',
  guardrail: '$(error)',
}

const PHASE_COLOR: Record<string, string | undefined> = {
  flow: 'charts.green',
  strain: 'charts.yellow',
  guardrail: 'charts.red',
}

let timer: NodeJS.Timeout | undefined
let status: vscode.StatusBarItem
let latest: GuardState | null = null

function guardFile(): string {
  const configured = vscode.workspace.getConfiguration('zendev').get<string>('guardFile')
  if (configured) return configured
  return path.join(os.homedir(), '.zendev', 'guard.json')
}

function readState(): GuardState | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(guardFile(), 'utf8')) as GuardState
    if (typeof parsed.stressIndex !== 'number' || typeof parsed.phase !== 'string') return null
    return parsed
  } catch {
    return null
  }
}

function stale(state: GuardState): boolean {
  const seconds = vscode.workspace.getConfiguration('zendev').get<number>('staleSeconds') ?? 15
  const updated = Date.parse(state.updatedAt)
  return !Number.isFinite(updated) || Date.now() - updated > seconds * 1000
}

function refresh(): void {
  const state = readState()
  latest = state
  if (!state || stale(state)) {
    status.hide()
    return
  }

  const percent = Math.round(state.stressIndex * 100)
  const icon = PHASE_ICON[state.phase] ?? '$(pulse)'
  const label = state.phase === 'calibrating' ? 'learning baseline' : state.phase
  status.text = `${icon} ${percent}% · ${label}`
  const color = PHASE_COLOR[state.phase]
  status.color = color ? new vscode.ThemeColor(color) : undefined
  status.backgroundColor = undefined
  status.tooltip = new vscode.MarkdownString(
    [
      '**ZenDev** bio-adaptive load',
      '',
      `- load: **${percent}%** of your own baseline`,
      `- phase: ${state.phase}`,
      `- confidence: ${Math.round(state.confidence * 100)}%`,
      `- guardrail: ${state.guardrailArmed ? 'armed' : 'off'}`,
      `- updated: ${new Date(state.updatedAt).toLocaleTimeString()}`,
      '',
      state.disclaimer ?? 'Relative arousal, not a medical measurement.',
    ].join('\n'),
  )
  status.command = 'zendev.showReading'
  status.show()
}

function sendCommand(command: string): void {
  const terminal =
    vscode.window.terminals.find((terminal) => terminal.name === 'ZenDev') ??
    vscode.window.createTerminal('ZenDev')
  terminal.show(true)
  terminal.sendText(command, true)
}

function breathe(command: string, seconds: number): Thenable<boolean> {
  return vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: 'ZenDev guardrail',
      cancellable: true,
    },
    (progress, token) =>
      new Promise<boolean>((resolve) => {
        const total = Math.max(6, seconds) * 1000
        const startedAt = Date.now()
        let settled = false

        const finish = (value: boolean) => {
          if (settled) return
          settled = true
          clearInterval(tick)
          resolve(value)
        }

        const tick = setInterval(() => {
          const elapsed = Date.now() - startedAt
          const remaining = Math.max(0, Math.ceil((total - elapsed) / 1000))
          const cycle = elapsed % 10_000
          const phase = cycle < 4_000 ? 'Breathe in' : cycle < 5_000 ? 'Hold' : 'Breathe out'
          progress.report({ message: `${phase} · ${remaining}s · ${command}` })
          if (elapsed >= total) finish(true)
        }, 250)

        token.onCancellationRequested(() => finish(false))
      }),
  ).then(async (completed) => {
    if (!completed) return false
    const choice = await vscode.window.showWarningMessage(
      'The breath is done. This is still your call.',
      {
        modal: true,
        detail: `${command}\n\nThe command has not run yet.`,
      },
      'Run it anyway',
    )
    return choice === 'Run it anyway'
  })
}

async function runGuarded(): Promise<void> {
  const command = await vscode.window.showInputBox({
    title: 'ZenDev: run with the guardrail',
    prompt: 'The command runs in the ZenDev terminal after the guardrail checks your load.',
    placeHolder: 'git push --force origin main',
    ignoreFocusOut: true,
  })
  if (!command) return

  const state = readState()
  if (!state || stale(state)) {
    const choice = await vscode.window.showWarningMessage(
      'ZenDev is not running, so there is no live reading to guard this command.',
      'Run without the guardrail',
    )
    if (choice) sendCommand(command)
    return
  }

  const threshold =
    vscode.workspace.getConfiguration('zendev').get<number>('threshold') ?? state.threshold ?? 0.72
  const hot =
    state.guardrailArmed &&
    (state.phase === 'guardrail' ||
      state.phase === 'strain' ||
      state.stressIndex >= threshold)

  if (hot) {
    const proceed = await breathe(command, 8)
    if (!proceed) {
      void vscode.window.showInformationMessage('ZenDev guardrail: command cancelled.')
      return
    }
  }

  sendCommand(command)
}

function showReading(): void {
  const state = latest
  if (!state || stale(state)) {
    void vscode.window.showInformationMessage(
      'No live ZenDev reading. Start the desktop app and enable a sensor first.',
    )
    return
  }
  const percent = Math.round(state.stressIndex * 100)
  void vscode.window.showInformationMessage(
    `ZenDev: ${percent}% load · ${state.phase} · confidence ${Math.round(
      state.confidence * 100,
    )}% · ${state.guardrailArmed ? 'guardrail armed' : 'guardrail off'}`,
  )
}

export function activate(context: vscode.ExtensionContext): void {
  status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100)
  context.subscriptions.push(status)

  context.subscriptions.push(
    vscode.commands.registerCommand('zendev.runGuarded', runGuarded),
    vscode.commands.registerCommand('zendev.showReading', showReading),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('zendev')) refresh()
    }),
  )

  refresh()
  timer = setInterval(refresh, 1000)
  context.subscriptions.push({ dispose: () => timer && clearInterval(timer) })
}

export function deactivate(): void {
  if (timer) clearInterval(timer)
  timer = undefined
}
