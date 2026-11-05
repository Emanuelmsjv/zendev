import { useState } from 'react'
import type { VitalsSource } from '../lib/types'

interface ConsentGateProps {
  initialKey: string
  onAccept: (choice: { source: VitalsSource; apiKey: string }) => void
}

const KEEPS = [
  'Camera or phone-camera frames while a session is running',
  'Pulse, breathing, and heart-rate variability',
  'A 20-minute session curve and your commit markers',
]

const LEAVES = [
  'Your API key, to Presage, only to validate the licence',
  'Nothing else: frames and metrics never leave this process',
  'SDK telemetry is explicitly switched off in code',
]

const STORES = [
  'Session data lives in this profile, not on a server',
  'One button under Settings deletes all of it',
  'Your key is never written into the repository',
]

export function ConsentGate({ initialKey, onAccept }: ConsentGateProps) {
  const [accepted, setAccepted] = useState(false)
  const [apiKey, setApiKey] = useState(initialKey)
  const [reveal, setReveal] = useState(false)

  const canUseCamera = accepted && apiKey.trim().length > 0
  const canSimulate = accepted

  return (
    <div className="gate">
      <div className="gate-card">
        <header className="gate-head">
          <div className="mark" aria-hidden="true">
            <span className="mark-dot" />
            <span className="mark-wave" />
          </div>
          <div>
            <p className="eyebrow">Presage SmartSpectra SDK Challenge</p>
            <h1>ZenDev</h1>
            <p className="gate-sub">
              An editor that reads your body and changes itself. Not a medical device, and it
              will never pretend to be one.
            </p>
          </div>
        </header>

        <div className="gate-grid">
          <section>
            <h2>What it reads</h2>
            <ul>
              {KEEPS.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </section>
          <section>
            <h2>What leaves this machine</h2>
            <ul>
              {LEAVES.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </section>
          <section>
            <h2>What it keeps</h2>
            <ul>
              {STORES.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </section>
        </div>

        <div className="gate-key">
          <label htmlFor="api-key">SmartSpectra API key</label>
          <div className="key-row">
            <input
              id="api-key"
              type={reveal ? 'text' : 'password'}
              value={apiKey}
              spellCheck={false}
              autoComplete="off"
              placeholder="paste the key from physiology.presagetech.com"
              onChange={(event) => setApiKey(event.target.value)}
            />
            <button type="button" className="ghost" onClick={() => setReveal((v) => !v)}>
              {reveal ? 'Hide' : 'Show'}
            </button>
          </div>
          <p className="fineprint">
            Stored in this app profile only. You can also set <code>SMARTSPECTRA_API_KEY</code>{' '}
            and leave this blank.
          </p>
        </div>

        <label className="consent-check">
          <input
            type="checkbox"
            checked={accepted}
            onChange={(event) => setAccepted(event.target.checked)}
          />
          <span>
            I understand this measures relative arousal from my camera or phone, is not a
            diagnosis, and that I can stop and delete everything at any time.
          </span>
        </label>

        <div className="gate-actions">
          <button
            type="button"
            className="primary"
            disabled={!canUseCamera}
            onClick={() => onAccept({ source: 'camera', apiKey: apiKey.trim() })}
          >
            Start with camera
          </button>
          <button
            type="button"
            className="secondary"
            disabled={!canSimulate}
            onClick={() => onAccept({ source: 'simulated', apiKey: apiKey.trim() })}
          >
            Explore with simulated vitals
          </button>
          <button
            type="button"
            className="secondary"
            disabled={!canUseCamera}
            onClick={() => onAccept({ source: 'phone', apiKey: apiKey.trim() })}
          >
            Use my phone camera
          </button>
        </div>
        <p className="fineprint center">
          The simulator is clearly labelled in the app. The phone camera opens a local link you
          can switch to at any time from the top bar.
        </p>
      </div>
    </div>
  )
}
