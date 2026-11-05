import { useEffect, useRef } from 'react'
import type { VitalsSource } from '../lib/types'

interface CameraDockProps {
  stream: MediaStream | null
  source: VitalsSource
  status: string
  hint: string | null
  pulse: number | null
  error: string | null
  phoneUrl?: string | null
  phonePairUrl?: string | null
  phoneClients?: number
}

export function CameraDock({
  stream,
  source,
  status,
  hint,
  pulse,
  error,
  phoneUrl = null,
  phonePairUrl = null,
  phoneClients = 0,
}: CameraDockProps) {
  const videoRef = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    video.srcObject = stream
    if (stream) {
      void video.play().catch(() => undefined)
    }
    return () => {
      if (video) video.srcObject = null
    }
  }, [stream])

  const duration = pulse && pulse > 0 ? 60 / pulse : 1
  const chip = source === 'simulated' ? 'SIMULATED' : source === 'phone' && !stream ? 'PHONE' : 'LIVE'

  return (
    <section className="dock" aria-label="Sensor input">
      <div className="dock-frame">
        {stream ? (
          <video ref={videoRef} className="dock-video" muted playsInline />
        ) : source === 'simulated' ? (
          <div className="orb-wrap">
            <span className="orb" style={{ animationDuration: `${duration}s` }} />
            <span className="orb-label">simulated</span>
          </div>
        ) : source === 'phone' ? (
          <div className="dock-phone">
            {phoneUrl ? (
              <>
                <span className="k">Pair your phone camera</span>
                <code className="phone-url">{phonePairUrl ?? phoneUrl}</code>
                <span className="phone-note">
                  {phoneClients > 0
                    ? `${phoneClients} phone connected`
                    : 'Same Wi-Fi. Install the certificate once, then no warning.'}
                </span>
                {phonePairUrl ? <code className="phone-direct">{phoneUrl}</code> : null}
              </>
            ) : (
              <span className="camera-off">Phone bridge is starting…</span>
            )}
          </div>
        ) : (
          <div className="dock-off">
            <span className="camera-off">Camera is off</span>
          </div>
        )}

        <div className="dock-overlay">
          <span className={source === 'simulated' ? 'chip sim' : 'chip live'}>{chip}</span>
          <span className="chip quiet">{status}</span>
        </div>
      </div>

      <div className="dock-meta">
        <div>
          <span className="k">Pulse</span>
          <span className="v">{pulse ? `${pulse.toFixed(0)} bpm` : '—'}</span>
        </div>
        <p className={error ? 'dock-hint error' : 'dock-hint'}>
          {error ??
            hint ??
            (source === 'phone'
              ? 'Hold the phone at chest height so your face fills the frame.'
              : 'Sit still, fill the frame, keep the light in front of you.')}
        </p>
      </div>
    </section>
  )
}
