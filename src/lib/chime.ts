type ChimeKind = 'alert' | 'ready'

let audio: AudioContext | null = null

function context(): AudioContext | null {
  if (typeof window === 'undefined' || typeof window.AudioContext !== 'function') return null
  if (!audio) audio = new window.AudioContext()
  if (audio.state === 'suspended') void audio.resume()
  return audio
}

export function playChime(kind: ChimeKind): void {
  const ctx = context()
  if (!ctx) return

  const notes = kind === 'alert' ? [392, 523.25] : [523.25, 659.25]
  const level = kind === 'alert' ? 0.055 : 0.04
  const now = ctx.currentTime

  notes.forEach((frequency, index) => {
    const start = now + index * 0.16
    const oscillator = ctx.createOscillator()
    const gain = ctx.createGain()
    oscillator.type = 'sine'
    oscillator.frequency.setValueAtTime(frequency, start)
    gain.gain.setValueAtTime(0.0001, start)
    gain.gain.exponentialRampToValueAtTime(level, start + 0.02)
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.85)
    oscillator.connect(gain)
    gain.connect(ctx.destination)
    oscillator.start(start)
    oscillator.stop(start + 0.9)
  })
}
