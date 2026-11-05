import { MIN_BASELINE_SAMPLES } from '../lib/stress'
import { PHASE_COPY } from '../lib/theme'
import type { SessionPoint, StressReading } from '../lib/types'

interface StressMeterProps {
  reading: StressReading
  points: SessionPoint[]
}

function sparkPath(points: SessionPoint[], width: number, height: number): string {
  if (points.length < 2) return ''
  const recent = points.slice(-90)
  const step = width / Math.max(recent.length - 1, 1)
  const line = recent
    .map((point, index) => {
      const x = index * step
      const y = height - point.index * height
      return `${index === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')
  return `${line}L${width},${height}L0,${height}Z`
}

export function StressMeter({ reading, points }: StressMeterProps) {
  const percent = Math.round(reading.index * 100)
  const confidence = Math.round(reading.confidence * 100)
  const copy = PHASE_COPY[reading.phase]

  return (
    <section className="meter" aria-label="Stress estimate">
      <div className="meter-head">
        <div>
          <p className="eyebrow">Relative load</p>
          <div className="meter-value">
            <span className="big">{percent}</span>
            <span className="unit">%</span>
          </div>
        </div>
        <div className={`phase phase-${reading.phase}`}>
          <span className="phase-dot" />
          {copy.title}
        </div>
      </div>

      <div className="meter-bar" role="img" aria-label={`Stress index ${percent} percent`}>
        <div className="meter-fill" style={{ width: `${percent}%` }} />
        <div className="meter-mark strain" style={{ left: '45%' }} title="Strain threshold" />
        <div className="meter-mark guard" style={{ left: '72%' }} title="Guardrail threshold" />
      </div>

      <svg className="spark" viewBox="0 0 260 48" preserveAspectRatio="none" aria-hidden="true">
        <path d={sparkPath(points, 260, 48)} />
      </svg>

      <p className="meter-copy">{copy.line}</p>

      {reading.phase === 'calibrating' ? (
        <div className="calibration">
          <div className="calibration-bar">
            <div
              className="calibration-fill"
              style={{ width: `${Math.round(reading.baselineProgress * 100)}%` }}
            />
          </div>
          <span className="fineprint">
            {reading.baselineProgress >= 1
              ? 'Waiting for a confident face frame'
              : `Baseline ${Math.round(reading.baselineProgress * 100)}% · ${Math.min(
                  reading.baselineSamples,
                  MIN_BASELINE_SAMPLES,
                )}/${MIN_BASELINE_SAMPLES} readings`}
          </span>
        </div>
      ) : (
        <div className="meter-foot">
          <span className="fineprint">confidence {confidence}%</span>
          {reading.baseline?.pulse ? (
            <span className="fineprint">calm baseline {reading.baseline.pulse.toFixed(0)} bpm</span>
          ) : null}
        </div>
      )}
    </section>
  )
}
