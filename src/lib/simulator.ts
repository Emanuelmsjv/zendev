import type { VitalsSample } from './types'

export type Scenario = 'calm' | 'deadline' | 'panic' | 'auto'

interface Targets {
  pulse: number
  hrv: number
  breathing: number
  tension: number
  stability: number
}

const ANCHORS: Record<Exclude<Scenario, 'auto'>, Targets> = {
  calm: { pulse: 63, hrv: 47, breathing: 13.5, tension: 0.05, stability: 0.95 },
  deadline: { pulse: 79, hrv: 33, breathing: 18, tension: 0.35, stability: 0.8 },
  panic: { pulse: 93, hrv: 21, breathing: 23, tension: 0.72, stability: 0.5 },
}

const AUTO_KEYFRAMES: Array<{ at: number; targets: Targets }> = [
  { at: 0, targets: ANCHORS.calm },
  { at: 24_000, targets: { pulse: 68, hrv: 43, breathing: 15, tension: 0.1, stability: 0.92 } },
  { at: 42_000, targets: ANCHORS.deadline },
  { at: 58_000, targets: ANCHORS.panic },
  { at: 72_000, targets: { pulse: 84, hrv: 28, breathing: 20, tension: 0.5, stability: 0.68 } },
  { at: 90_000, targets: ANCHORS.calm },
]

const AUTO_PERIOD = 90_000

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function hash(seed: number, n: number): number {
  let h = (seed ^ Math.imul(n + 0x9e3779b9, 0x85ebca6b)) >>> 0
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

const smoothstep = (t: number): number => {
  const x = Math.min(1, Math.max(0, t))
  return x * x * (3 - 2 * x)
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

function autoTargets(t: number): Targets {
  const at = t % AUTO_PERIOD
  for (let i = 0; i < AUTO_KEYFRAMES.length - 1; i += 1) {
    const from = AUTO_KEYFRAMES[i]
    const to = AUTO_KEYFRAMES[i + 1]
    if (at >= from.at && at <= to.at) {
      const k = smoothstep((at - from.at) / (to.at - from.at))
      return {
        pulse: lerp(from.targets.pulse, to.targets.pulse, k),
        hrv: lerp(from.targets.hrv, to.targets.hrv, k),
        breathing: lerp(from.targets.breathing, to.targets.breathing, k),
        tension: lerp(from.targets.tension, to.targets.tension, k),
        stability: lerp(from.targets.stability, to.targets.stability, k),
      }
    }
  }
  return AUTO_KEYFRAMES[AUTO_KEYFRAMES.length - 1].targets
}

export function targetsAt(t: number, scenario: Scenario): Targets {
  return scenario === 'auto' ? autoTargets(t) : ANCHORS[scenario]
}

export function sampleAt(t: number, seed: number, scenario: Scenario): VitalsSample {
  const targets = targetsAt(t, scenario)
  const tick = Math.floor(t / 1000)
  const jitter = (n: number) => (hash(seed, tick * 7 + n) - 0.5) * 2

  const pulse = targets.pulse + jitter(1) * 1.8
  const hrv = Math.max(8, targets.hrv + jitter(2) * 1.6)
  const breathing = Math.max(6, targets.breathing + jitter(3) * 0.7)
  const stability = Math.min(1, Math.max(0.2, targets.stability - Math.abs(jitter(4)) * 0.05))

  return {
    t,
    pulse,
    pulseConfidence: 88 - Math.abs(jitter(5)) * 10,
    hrvRmssd: hrv,
    hrvConfidence: 80 - Math.abs(jitter(6)) * 12,
    breathingRate: breathing,
    breathingConfidence: 76 - Math.abs(jitter(7)) * 14,
    breathingStability: stability,
    edaSlope: t >= 35_000 ? (targets.tension - 0.05) * 0.12 + jitter(8) * 0.01 : null,
    tension: targets.tension + jitter(9) * 0.04,
  }
}

export const SCENARIOS: Array<{ id: Scenario; label: string; hint: string }> = [
  { id: 'auto', label: 'Auto', hint: 'A 90-second calm → crunch → recovery arc' },
  { id: 'calm', label: 'Calm', hint: 'Steady baseline, good for calibration' },
  { id: 'deadline', label: 'Deadline', hint: 'Elevated but still thinking clearly' },
  { id: 'panic', label: 'Panic', hint: 'High load, guardrail territory' },
]
