import type { Marker, SessionPoint, StressReading } from '../lib/types'
import { BioTimeline } from './BioTimeline'
import { Explain } from './Explain'
import { Terminal, type LogLine } from './Terminal'

export type ConsoleTab = 'timeline' | 'terminal'

interface ConsoleDockProps {
  tab: ConsoleTab
  onTab: (tab: ConsoleTab) => void
  reading: StressReading
  points: SessionPoint[]
  markers: Marker[]
  lines: LogLine[]
  onCommand: (command: string) => void
  onExportCsv: () => void
  onExportJson: () => void
}

export function ConsoleDock({
  tab,
  onTab,
  reading,
  points,
  markers,
  lines,
  onCommand,
  onExportCsv,
  onExportJson,
}: ConsoleDockProps) {
  return (
    <section className="console" aria-label="Session console">
      <div className="console-bar">
        <div className="console-tabs" role="tablist" aria-label="Console panels">
          <button
            type="button"
            role="tab"
            id="tab-timeline"
            aria-selected={tab === 'timeline'}
            aria-controls="panel-timeline"
            className={tab === 'timeline' ? 'tab on' : 'tab'}
            onClick={() => onTab('timeline')}
          >
            Bio-timeline
          </button>
          <button
            type="button"
            role="tab"
            id="tab-terminal"
            aria-selected={tab === 'terminal'}
            aria-controls="panel-terminal"
            className={tab === 'terminal' ? 'tab on' : 'tab'}
            onClick={() => onTab('terminal')}
          >
            Sandbox
          </button>
        </div>
        <span className="console-hint">
          {tab === 'terminal'
            ? 'ctrl+` toggles the console'
            : `${points.length} samples · ${markers.length} markers`}
        </span>
      </div>

      <div className="console-body">
        {tab === 'timeline' ? (
          <div
            className="console-split"
            role="tabpanel"
            id="panel-timeline"
            aria-labelledby="tab-timeline"
          >
            <BioTimeline
              points={points}
              markers={markers}
              onExportCsv={onExportCsv}
              onExportJson={onExportJson}
            />
            <Explain reading={reading} />
          </div>
        ) : (
          <div
            className="console-single"
            role="tabpanel"
            id="panel-terminal"
            aria-labelledby="tab-terminal"
          >
            <Terminal lines={lines} onCommand={onCommand} />
          </div>
        )}
      </div>
    </section>
  )
}
