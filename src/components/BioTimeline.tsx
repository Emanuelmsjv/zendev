import type { Marker, MarkerKind, SessionPoint } from '../lib/types'

interface BioTimelineProps {
  points: SessionPoint[]
  markers: Marker[]
  onExportJson: () => void
  onExportCsv: () => void
}

const WIDTH = 1000
const HEIGHT = 120

const MARKER_COLOR: Record<MarkerKind, string> = {
  commit: 'var(--accent)',
  run: 'var(--accent-2)',
  'guardrail-raised': '#ff8a7a',
  'guardrail-passed': '#ffb86b',
  'guardrail-aborted': '#8fd6a8',
  phase: 'var(--dim)',
}

function formatClock(t: number): string {
  const total = Math.round(t / 1000)
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  return `${minutes}:${seconds.toString().padStart(2, '0')}`
}

export function BioTimeline({ points, markers, onExportJson, onExportCsv }: BioTimelineProps) {
  const maxT = Math.max(points.length ? points[points.length - 1].t : 0, 30_000)
  const x = (t: number) => (t / maxT) * WIDTH
  const y = (index: number) => HEIGHT - index * HEIGHT

  const line = points
    .map((point, index) => `${index === 0 ? 'M' : 'L'}${x(point.t).toFixed(1)},${y(point.index).toFixed(1)}`)
    .join(' ')

  const area = points.length
    ? `${line}L${x(points[points.length - 1].t).toFixed(1)},${HEIGHT}L0,${HEIGHT}Z`
    : ''

  const nearest = (t: number): number => {
    if (!points.length) return 0
    let best = points[0]
    for (const point of points) {
      if (Math.abs(point.t - t) < Math.abs(best.t - t)) best = point
    }
    return best.index
  }

  return (
    <section className="timeline" aria-label="Session bio-timeline">
      <header className="timeline-head">
        <div>
          <h2>Bio-timeline</h2>
          <p className="fineprint">
            {points.length} samples · {markers.length} markers · {formatClock(maxT)} elapsed
          </p>
        </div>
        <div className="timeline-actions">
          <button type="button" className="ghost" onClick={onExportCsv} disabled={!points.length}>
            Export CSV
          </button>
          <button type="button" className="ghost" onClick={onExportJson} disabled={!points.length}>
            Export JSON
          </button>
        </div>
      </header>

      <svg
        className="timeline-svg"
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        preserveAspectRatio="none"
        role="img"
        aria-label="Relative load over the session with code markers"
      >
        {[0.25, 0.5, 0.75].map((level) => (
          <line
            key={level}
            x1={0}
            x2={WIDTH}
            y1={y(level)}
            y2={y(level)}
            className="gridline"
          />
        ))}
        <line x1={0} x2={WIDTH} y1={y(0.72)} y2={y(0.72)} className="threshold" />
        {area ? <path d={area} className="timeline-area" /> : null}
        {line ? <path d={line} className="timeline-line" /> : null}

        {markers.map((marker, index) => (
          <g key={`${marker.t}-${marker.kind}-${index}`}>
            <line
              x1={x(marker.t)}
              x2={x(marker.t)}
              y1={0}
              y2={HEIGHT}
              className="marker-line"
              style={{ stroke: MARKER_COLOR[marker.kind] }}
            >
              <title>{`${formatClock(marker.t)} — ${marker.label}`}</title>
            </line>
            <circle
              cx={x(marker.t)}
              cy={y(nearest(marker.t))}
              r={2.5}
              style={{ fill: MARKER_COLOR[marker.kind] }}
            >
              <title>{marker.label}</title>
            </circle>
          </g>
        ))}
      </svg>

      {points.length === 0 ? (
        <p className="timeline-empty">Start a session and the curve builds here, one second at a time.</p>
      ) : (
        <div className="timeline-legend">
          <span><i style={{ background: MARKER_COLOR.commit }} /> commit</span>
          <span><i style={{ background: MARKER_COLOR.run }} /> run</span>
          <span><i style={{ background: MARKER_COLOR['guardrail-raised'] }} /> guardrail raised</span>
          <span><i style={{ background: MARKER_COLOR['guardrail-aborted'] }} /> backed out</span>
          <span className="fineprint">dashed line = 72% guardrail threshold</span>
        </div>
      )}
    </section>
  )
}
