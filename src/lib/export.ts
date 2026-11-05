import type { Marker, SessionPoint, StressReading, VitalsSource } from './types'

export function toCsv(points: SessionPoint[]): string {
  const header = 't_ms,time_s,stress,pulse_bpm,breathing_br_min,hrv_rmssd'
  const rows = points.map((point) =>
    [
      point.t,
      (point.t / 1000).toFixed(1),
      point.index.toFixed(4),
      point.pulse === null ? '' : point.pulse.toFixed(1),
      point.breathingRate === null ? '' : point.breathingRate.toFixed(2),
      point.hrvRmssd === null ? '' : point.hrvRmssd.toFixed(2),
    ].join(','),
  )
  return [header, ...rows].join('\n')
}

export function sessionPayload(options: {
  source: VitalsSource
  reading: StressReading
  points: SessionPoint[]
  markers: Marker[]
}): string {
  return JSON.stringify(
    {
      app: 'ZenDev',
      note: 'Relative arousal versus the user baseline. Not a medical measurement.',
      exportedAt: new Date().toISOString(),
      source: options.source,
      baseline: options.reading.baseline,
      thresholds: { strain: 0.45, guardrail: 0.72 },
      points: options.points,
      markers: options.markers,
    },
    null,
    2,
  )
}

export function stamp(): string {
  const now = new Date()
  const pad = (n: number) => n.toString().padStart(2, '0')
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`
}

export function download(filename: string, contents: string, type: string): void {
  const blob = new Blob([contents], { type })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}
