import { useEffect, useRef, useState } from 'react'
import { assessCommand } from '../lib/commands'

export interface LogLine {
  id: number
  kind: 'in' | 'out' | 'warn' | 'error'
  text: string
}

interface TerminalProps {
  lines: LogLine[]
  onCommand: (command: string) => void
  disabled?: boolean
}

const RISK_LABEL: Record<string, string> = {
  safe: 'safe',
  caution: 'needs care',
  destructive: 'irreversible',
}

export function Terminal({ lines, onCommand, disabled }: TerminalProps) {
  const [value, setValue] = useState('')
  const [history, setHistory] = useState<string[]>([])
  const [historyIndex, setHistoryIndex] = useState(-1)
  const logRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = logRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [lines])

  const assessment = assessCommand(value)

  const submit = () => {
    const command = value.trim()
    if (!command) return
    setHistory((current) => [...current, command])
    setHistoryIndex(-1)
    setValue('')
    onCommand(command)
  }

  const stepHistory = (delta: number) => {
    if (history.length === 0) return
    const next = Math.min(history.length, Math.max(0, (historyIndex < 0 ? history.length : historyIndex) + delta))
    setHistoryIndex(next === history.length ? -1 : next)
    setValue(next === history.length ? '' : history[next])
  }

  return (
    <section className="terminal" aria-label="Sandboxed shell">
      <header className="terminal-head">
        <h2>Sandbox shell</h2>
        <span className="fineprint">commands are simulated — nothing on disk is touched</span>
      </header>

      <div className="terminal-log" ref={logRef}>
        {lines.map((line) => (
          <p key={line.id} className={`log log-${line.kind}`}>
            {line.kind === 'in' ? <span className="log-prompt">$</span> : null}
            <span>{line.text}</span>
          </p>
        ))}
      </div>

      <div className="terminal-input">
        <span className="log-prompt">$</span>
        <input
          type="text"
          value={value}
          spellCheck={false}
          disabled={disabled}
          aria-label="Command"
          placeholder="git push --force origin main"
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') submit()
            if (event.key === 'ArrowUp') {
              event.preventDefault()
              stepHistory(-1)
            }
            if (event.key === 'ArrowDown') {
              event.preventDefault()
              stepHistory(1)
            }
          }}
        />
        <span className={`risk risk-${assessment.level}`}>{RISK_LABEL[assessment.level]}</span>
        <button type="button" className="ghost" onClick={submit} disabled={disabled || !value.trim()}>
          Run
        </button>
      </div>
      {assessment.detail ? <p className="terminal-detail">{assessment.detail}</p> : null}
    </section>
  )
}
