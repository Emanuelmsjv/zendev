import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { CameraDock } from './components/CameraDock'
import { CircuitBreaker } from './components/CircuitBreaker'
import { ConsentGate } from './components/ConsentGate'
import { ConsoleDock, type ConsoleTab } from './components/ConsoleDock'
import { Editor } from './components/Editor'
import { StressMeter } from './components/StressMeter'
import type { LogLine } from './components/Terminal'
import { useVitals } from './hooks/useVitals'
import { assessCommand } from './lib/commands'
import { download, sessionPayload, stamp, toCsv } from './lib/export'
import { host, inElectron, type HostInfo, type PhoneInfo } from './lib/host'
import { SAMPLE_CODE, SAMPLE_PATH, TERMINAL_WELCOME } from './lib/sample'
import { SCENARIOS, type Scenario } from './lib/simulator'
import {
  loadConsent,
  loadSettings,
  purgeAll,
  saveConsent,
  saveSession,
  saveSettings,
  type Settings,
} from './lib/storage'
import { GUARDRAIL_THRESHOLD } from './lib/stress'
import { themeFor } from './lib/theme'
import type { Marker, MarkerKind, VitalsSource } from './lib/types'

let logId = 0
const nextLog = (kind: LogLine['kind'], text: string): LogLine => {
  logId += 1
  return { id: logId, kind, text }
}

export default function App() {
  const [settings, setSettings] = useState<Settings>(() => loadSettings())
  const [consent, setConsent] = useState<boolean>(() => loadConsent())
  const [hostInfo, setHostInfo] = useState<HostInfo | null>(null)
  const [phoneInfo, setPhoneInfo] = useState<PhoneInfo | null>(null)
  const [phoneClients, setPhoneClients] = useState(0)
  const [code, setCode] = useState(SAMPLE_CODE)
  const [markers, setMarkers] = useState<Marker[]>([])
  const [log, setLog] = useState<LogLine[]>(() => TERMINAL_WELCOME.map((line) => nextLog('out', line)))
  const [pending, setPending] = useState<{ command: string; detail: string | null } | null>(null)
  const [sessionKey, setSessionKey] = useState(0)
  const [confirmPurge, setConfirmPurge] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const [consoleOpen, setConsoleOpen] = useState(true)
  const [consoleTab, setConsoleTab] = useState<ConsoleTab>('timeline')

  useEffect(() => {
    const bridge = host()
    if (!bridge) return
    void bridge.info().then(setHostInfo).catch(() => undefined)
  }, [])

  useEffect(() => {
    if (settings.source !== 'phone') return
    const bridge = host()
    if (!bridge) return
    let alive = true
    void bridge
      .phoneInfo()
      .then((info) => {
        if (alive) setPhoneInfo(info)
      })
      .catch(() => undefined)
    const offClients = bridge.onPhoneClients((count) => {
      if (alive) setPhoneClients(count)
    })
    return () => {
      alive = false
      offClients()
    }
  }, [settings.source])

  const apiKey = settings.apiKey || hostInfo?.apiKey || ''

  const vitals = useVitals({
    source: settings.source,
    scenario: settings.scenario,
    apiKey,
    guardrailArmed: settings.guardrailEnabled,
  })

  const startRef = useRef(vitals.start)
  const stopRef = useRef(vitals.stop)

  useEffect(() => {
    startRef.current = vitals.start
    stopRef.current = vitals.stop
  }, [vitals.start, vitals.stop])

  const activeKey = useRef('')
  useEffect(() => {
    if (!consent) return
    const key = `${settings.source}|${settings.scenario}|${apiKey}|${sessionKey}`
    if (activeKey.current === key) return
    activeKey.current = key
    void (async () => {
      await stopRef.current()
      await startRef.current()
    })()
  }, [consent, settings.source, settings.scenario, apiKey, sessionKey])

  const lastPhase = useRef('')
  useEffect(() => {
    const phase = vitals.reading.phase
    if (phase === 'calibrating') return
    const previous = lastPhase.current
    if (previous === phase) return
    lastPhase.current = phase
    if (previous === 'strain' || (phase === 'strain' && previous !== 'calibrating')) {
      const t = vitals.points.length ? vitals.points[vitals.points.length - 1].t : 0
      setMarkers((current) => [...current, { t, kind: 'phase', label: `${previous} → ${phase}` }])
    }
  }, [vitals.reading.phase, vitals.points])

  const guardRef = useRef({
    index: vitals.reading.index,
    confidence: vitals.reading.confidence,
    phase: vitals.reading.phase,
    armed: settings.guardrailEnabled,
  })

  useEffect(() => {
    guardRef.current = {
      index: vitals.reading.index,
      confidence: vitals.reading.confidence,
      phase: vitals.reading.phase,
      armed: settings.guardrailEnabled,
    }
  }, [
    vitals.reading.index,
    vitals.reading.confidence,
    vitals.reading.phase,
    settings.guardrailEnabled,
  ])

  useEffect(() => {
    const bridge = host()
    if (!bridge || !vitals.running) return
    const write = () => {
      const snapshot = guardRef.current
      void bridge
        .writeGuardState({
          app: 'ZenDev',
          updatedAt: new Date().toISOString(),
          stressIndex: Number(snapshot.index.toFixed(3)),
          confidence: Number(snapshot.confidence.toFixed(3)),
          phase: snapshot.phase,
          guardrailArmed: snapshot.armed,
          threshold: GUARDRAIL_THRESHOLD,
          disclaimer: 'Relative arousal, not a medical measurement.',
        })
        .catch(() => undefined)
    }
    write()
    const timer = setInterval(write, 2000)
    return () => clearInterval(timer)
  }, [vitals.running])

  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setToast(null), 3200)
    return () => clearTimeout(timer)
  }, [toast])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!event.ctrlKey) return
      if (event.key === '`') {
        event.preventDefault()
        setConsoleOpen((open) => !open)
      }
      if (event.key === '1' || event.key === '2') {
        event.preventDefault()
        setConsoleOpen(true)
        setConsoleTab(event.key === '1' ? 'timeline' : 'terminal')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const sessionTime = vitals.points.length ? vitals.points[vitals.points.length - 1].t : 0

  const addMarker = useCallback(
    (kind: MarkerKind, label: string) => {
      setMarkers((current) => [...current, { t: sessionTime, kind, label }])
    },
    [sessionTime],
  )

  const execute = useCallback(
    (command: string, forced: boolean) => {
      const base = command.trim().toLowerCase()
      if (base.startsWith('git commit')) {
        setLog((current) => [
          ...current,
          nextLog('out', '[main 4f2c1a9] session: guard expired sessions before delete'),
          nextLog('out', ' 1 file changed, 3 insertions(+), 1 deletion(-)'),
        ])
        addMarker('commit', 'git commit')
        return
      }
      if (base.startsWith('npm test') || base.startsWith('npm run test')) {
        setLog((current) => [
          ...current,
          nextLog('out', ' PASS  apps/api/src/session.test.ts (12 tests) 214ms'),
          nextLog('out', ' Tests  12 passed (12)'),
        ])
        addMarker('run', 'npm test')
        return
      }
      if (assessCommand(command).level === 'destructive') {
        setLog((current) => [
          ...current,
          nextLog(
            forced ? 'warn' : 'out',
            forced
              ? 'sandbox: allowed after the guardrail, nothing was executed'
              : 'sandbox: simulated destructive command, nothing was executed',
          ),
        ])
        return
      }
      if (base.startsWith('git push')) {
        setLog((current) => [...current, nextLog('out', 'Everything up-to-date')])
        return
      }
      setLog((current) => [...current, nextLog('error', `zendev: '${command}' is not wired in the sandbox`)])
    },
    [addMarker],
  )

  const onCommand = useCallback(
    (command: string) => {
      setLog((current) => [...current, nextLog('in', command)])
      const assessment = assessCommand(command)
      const intercept =
        assessment.level === 'destructive' &&
        settings.guardrailEnabled &&
        vitals.reading.phase !== 'calibrating' &&
        vitals.reading.index >= GUARDRAIL_THRESHOLD

      if (intercept) {
        addMarker('guardrail-raised', command)
        setPending({ command, detail: assessment.detail })
        return
      }
      execute(command, false)
    },
    [addMarker, execute, settings.guardrailEnabled, vitals.reading.index, vitals.reading.phase],
  )

  const onAccept = (choice: { source: VitalsSource; apiKey: string }) => {
    saveConsent()
    setSettings(saveSettings({ source: choice.source, apiKey: choice.apiKey }))
    setConsent(true)
  }

  const patch = (next: Partial<Settings>) => {
    setSettings(saveSettings(next))
  }

  const newSession = () => {
    setMarkers([])
    lastPhase.current = ''
    setSessionKey((key) => key + 1)
    setToast('Fresh session. Baseline recalibrating.')
  }

  const doPurge = () => {
    if (!confirmPurge) {
      setConfirmPurge(true)
      return
    }
    purgeAll()
    setConfirmPurge(false)
    setCode(SAMPLE_CODE)
    setMarkers([])
    lastPhase.current = ''
    vitals.resetSession()
    setSettings({ ...loadSettings(), apiKey: '' })
    setToast('Everything ZenDev stored is gone.')
  }

  const exportCsv = async () => {
    const contents = toCsv(vitals.points)
    const name = `zendev-${stamp()}.csv`
    const bridge = host()
    if (bridge) {
      await bridge.saveExport({ defaultName: name, contents, filters: [{ name: 'CSV', extensions: ['csv'] }] })
      return
    }
    download(name, contents, 'text/csv')
  }

  const exportJson = async () => {
    const contents = sessionPayload({
      source: settings.source,
      reading: vitals.reading,
      points: vitals.points,
      markers,
    })
    const name = `zendev-${stamp()}.json`
    const bridge = host()
    if (bridge) {
      await bridge.saveExport({ defaultName: name, contents })
      return
    }
    download(name, contents, 'application/json')
  }

  useEffect(() => {
    if (!vitals.points.length) return
    saveSession({ points: vitals.points, markers })
  }, [vitals.points, markers])

  const themeVars = useMemo(() => themeFor(vitals.reading.index), [vitals.reading.index])

  const clock = `${Math.floor(sessionTime / 60000)
    .toString()
    .padStart(2, '0')}:${Math.floor((sessionTime % 60000) / 1000)
    .toString()
    .padStart(2, '0')}`

  if (!consent) {
    return <ConsentGate initialKey={apiKey} onAccept={onAccept} />
  }

  return (
    <div
      className={consoleOpen ? 'app' : 'app no-console'}
      style={themeVars as CSSProperties}
      data-phase={vitals.reading.phase}
    >
      <header className="topbar">
        <div className="brand">
          <div className="mark small" aria-hidden="true">
            <span className="mark-dot" />
            <span className="mark-wave" />
          </div>
          <span className="brand-name">ZenDev</span>
          <span className="brand-sub">bio-adaptive workspace</span>
        </div>

        <div className="topbar-controls">
          <label className="control">
            <span>Input</span>
            <select
              value={settings.source}
              onChange={(event) => patch({ source: event.target.value as VitalsSource })}
            >
              <option value="simulated">Simulated</option>
              <option value="camera">Camera</option>
              <option value="phone">Phone</option>
            </select>
          </label>

          {settings.source === 'simulated' ? (
            <label className="control">
              <span>Scenario</span>
              <select
                value={settings.scenario}
                onChange={(event) => patch({ scenario: event.target.value as Scenario })}
              >
                {SCENARIOS.map((scenario) => (
                  <option key={scenario.id} value={scenario.id}>
                    {scenario.label}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          <button
            type="button"
            className={settings.guardrailEnabled ? 'toggle on' : 'toggle'}
            aria-pressed={settings.guardrailEnabled}
            onClick={() => patch({ guardrailEnabled: !settings.guardrailEnabled })}
          >
            <span className="toggle-dot" />
            Guardrail
          </button>

          <button
            type="button"
            className={consoleOpen ? 'toggle on' : 'toggle'}
            aria-pressed={consoleOpen}
            onClick={() => setConsoleOpen((open) => !open)}
            title="Toggle the bottom console (ctrl+`)"
          >
            <span className="toggle-dot" />
            Console
          </button>
          <button
            type="button"
            className={settings.soundEnabled ? 'toggle on' : 'toggle'}
            aria-pressed={settings.soundEnabled}
            onClick={() => patch({ soundEnabled: !settings.soundEnabled })}
            title="Chime when the guardrail opens and unlocks"
          >
            <span className="toggle-dot" />
            Sound
          </button>
          <button type="button" className="ghost" onClick={newSession}>
            New session
          </button>
          <button type="button" className={confirmPurge ? 'ghost danger' : 'ghost'} onClick={doPurge}>
            {confirmPurge ? 'Really delete?' : 'Delete data'}
          </button>
        </div>
      </header>

      <main className="workspace">
        <Editor
          path={SAMPLE_PATH}
          value={code}
          onChange={setCode}
          modified={code !== SAMPLE_CODE}
        />

        <aside className="rail">
          <CameraDock
            stream={vitals.stream}
            source={settings.source}
            status={vitals.status}
            hint={vitals.hint}
            pulse={vitals.sample?.pulse ?? null}
            error={vitals.error}
            phoneUrl={settings.source === 'phone' ? (phoneInfo?.url ?? null) : null}
            phonePairUrl={settings.source === 'phone' ? (phoneInfo?.pairUrl ?? null) : null}
            phoneClients={phoneClients}
          />
          <StressMeter reading={vitals.reading} points={vitals.points} />
        </aside>
      </main>

      {consoleOpen ? (
        <ConsoleDock
          tab={consoleTab}
          onTab={setConsoleTab}
          reading={vitals.reading}
          points={vitals.points}
          markers={markers}
          lines={log}
          onCommand={onCommand}
          onExportCsv={() => void exportCsv()}
          onExportJson={() => void exportJson()}
        />
      ) : null}

      <footer className="statusbar">
        <span className={`dot ${vitals.running ? 'on' : 'off'}`} />
        <span>{vitals.running ? vitals.status : 'stopped'}</span>
        <span className="sep" />
        <span>
          {settings.source === 'camera'
            ? 'camera + Presage SDK'
            : settings.source === 'phone'
              ? 'phone camera over local wifi'
              : 'simulated vitals'}
        </span>
        {settings.source !== 'simulated' && !inElectron() ? (
          <span className="warn-inline">camera needs the desktop build — run npm run app</span>
        ) : null}
        <span className="sep" />
        <span>session {clock}</span>
        <span className="grow" />
        <span className="quiet">
          {vitals.reading.confidence > 0
            ? `confidence ${Math.round(vitals.reading.confidence * 100)}%`
            : 'no reading yet'}
        </span>
        <span className="sep" />
        <span className="quiet">
          {hostInfo?.electron ? `Electron ${hostInfo.electron}` : 'browser preview'}
        </span>
      </footer>

      {pending ? (
        <CircuitBreaker
          command={pending.command}
          detail={pending.detail}
          reading={vitals.reading}
          pulse={vitals.sample?.pulse ?? null}
          breathSeconds={settings.breathSeconds}
          sound={settings.soundEnabled}
          onCancel={() => {
            addMarker('guardrail-aborted', pending.command)
            setLog((current) => [
              ...current,
              nextLog('warn', 'guardrail: command cancelled, branch untouched'),
            ])
            setPending(null)
          }}
          onProceed={() => {
            addMarker('guardrail-passed', pending.command)
            setLog((current) => [
              ...current,
              nextLog('warn', 'guardrail: user chose to continue after breathing'),
            ])
            execute(pending.command, true)
            setPending(null)
          }}
        />
      ) : null}

      {toast ? <div className="toast">{toast}</div> : null}
    </div>
  )
}
