import type { StressReading } from '../lib/types'

export function Explain({ reading }: { reading: StressReading }) {
  const sorted = [...reading.contributions].sort((a, b) => b.points - a.points)

  return (
    <section className="explain" aria-label="Why this reading">
      <header className="explain-head">
        <h2>Why this reading</h2>
        <span className="fineprint">share of the index</span>
      </header>

      {sorted.length === 0 ? (
        <p className="explain-empty">{reading.note ?? 'No confident sensor contribution yet.'}</p>
      ) : (
        <ul className="explain-list">
          {sorted.map((item) => (
            <li key={item.key}>
              <div className="explain-row">
                <span className="explain-label">{item.label}</span>
                <span className="explain-points">{(item.share * 100).toFixed(0)}%</span>
              </div>
              <div className="explain-bar">
                <div className="explain-fill" style={{ width: `${item.share * 100}%` }} />
              </div>
              <div className="explain-detail">
                <span>{item.detail}</span>
                <span className="fineprint">conf {Math.round(item.confidence * 100)}%</span>
              </div>
            </li>
          ))}
        </ul>
      )}

      <p className="explain-note">
        Everything is compared with your own first ten calm seconds, never with a population
        average. A high number means <em>different from your baseline</em>, not unwell.
      </p>
    </section>
  )
}
