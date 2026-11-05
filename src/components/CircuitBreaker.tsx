import { useEffect, useRef, useState } from 'react'
import { playChime } from '../lib/chime'
import type { StressReading } from '../lib/types'

interface CircuitBreakerProps {
  command: string
  detail: string | null
  reading: StressReading
  pulse: number | null
  breathSeconds: number
  sound: boolean
  onProceed: () => void
  onCancel: () => void
}

const CYCLE_MS = 10_000
const INHALE_MS = 4_000
const HOLD_MS = 1_000

export function CircuitBreaker({
  command,
  detail,
  reading,
  pulse,
  breathSeconds,
  sound,
  onProceed,
  onCancel,
}: CircuitBreakerProps) {
  const total = Math.max(6, breathSeconds) * 1000
  const [elapsed, setElapsed] = useState(0)
  const cancelRef = useRef<HTMLButtonElement>(null)
  const onCancelRef = useRef(onCancel)
  const chimedRef = useRef(false)

  useEffect(() => {
    if (sound) playChime('alert')
  }, [sound])

  useEffect(() => {
    onCancelRef.current = onCancel
  }, [onCancel])

  useEffect(() => {
    const startedAt = performance.now()
    const timer = setInterval(() => {
      setElapsed(Math.min(total, performance.now() - startedAt))
    }, 100)
    cancelRef.current?.focus()
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancelRef.current()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      clearInterval(timer)
      window.removeEventListener('keydown', onKey)
    }
  }, [total])

  const cyclePosition = elapsed % CYCLE_MS
  const phase =
    cyclePosition < INHALE_MS ? 'Breathe in' : cyclePosition < INHALE_MS + HOLD_MS ? 'Hold' : 'Breathe out'
  const remaining = Math.max(0, Math.ceil((total - elapsed) / 1000))
  const gate = Math.min(total * 0.5, 8000)
  const canProceed = elapsed >= gate
  const progress = elapsed / total

  useEffect(() => {
    if (!canProceed || chimedRef.current) return
    chimedRef.current = true
    if (sound) playChime('ready')
  }, [canProceed, sound])

  const radius = 54
  const circumference = 2 * Math.PI * radius

  return (
    <div className="breaker-backdrop" role="dialog" aria-modal="true" aria-label="Guardrail">
      <div className="breaker">
        <p className="eyebrow danger">Guardrail</p>
        <h2>Your body says stop. The command will not undo.</h2>
        <p className="breaker-lead">
          Pulse {pulse ? `${pulse.toFixed(0)} bpm` : '—'} · load{' '}
          {Math.round(reading.index * 100)}% · confidence {Math.round(reading.confidence * 100)}%
        </p>

        <div className="breaker-command">
          <code>{command}</code>
        </div>
        {detail ? <p className="breaker-detail">{detail}</p> : null}

        <div className="breathe">
          <svg viewBox="0 0 140 140" className="breathe-ring" aria-hidden="true">
            <circle cx="70" cy="70" r={radius} className="ring-track" />
            <circle
              cx="70"
              cy="70"
              r={radius}
              className="ring-fill"
              strokeDasharray={circumference}
              strokeDashoffset={circumference * (1 - progress)}
            />
          </svg>
          <div className="breathe-label">
            <span className="breathe-phase">{phase}</span>
            <span className="breathe-count">{remaining}s</span>
          </div>
        </div>

        <p className="breaker-note" aria-live="polite">
          {canProceed
            ? 'You have taken a full breath. The decision is still yours.'
            : 'Wait for one full breath before the command unlocks.'}
        </p>

        <div className="breaker-actions">
          <button ref={cancelRef} type="button" className="primary calm" onClick={onCancel}>
            Back out — keep the branch
          </button>
          <button type="button" className="secondary" onClick={onProceed} disabled={!canProceed}>
            {canProceed ? 'I have breathed. Run it anyway' : `Locked for ${Math.ceil((gate - elapsed) / 1000)}s`}
          </button>
        </div>
      </div>
    </div>
  )
}
