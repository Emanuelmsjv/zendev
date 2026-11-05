import { describe, expect, it } from 'vitest'
import {
  buildBaseline,
  initialStressState,
  reduceStress,
  tensionFromExpressions,
  type StressState,
} from '../src/lib/stress'
import type { VitalsSample } from '../src/lib/types'

function sample(overrides: Partial<VitalsSample> = {}): VitalsSample {
  return {
    t: 0,
    pulse: 62,
    pulseConfidence: 90,
    hrvRmssd: 48,
    hrvConfidence: 85,
    breathingRate: 14,
    breathingConfidence: 80,
    breathingStability: 0.95,
    edaSlope: null,
    tension: null,
    ...overrides,
  }
}

function feed(state: StressState, frames: VitalsSample[], from: number): StressState {
  let next = state
  frames.forEach((frame, index) => {
    next = reduceStress(next, { ...frame, t: from + index * 1000 }, {
      guardrailArmed: true,
      now: from + index * 1000,
    }).state
  })
  return next
}

function calibrate(): StressState {
  let state = initialStressState()
  for (let i = 0; i <= 20; i += 1) {
    state = reduceStress(state, sample({ t: i * 1000 }), {
      guardrailArmed: true,
      now: i * 1000,
    }).state
  }
  return state
}

const HOT = sample({
  pulse: 82,
  hrvRmssd: 24,
  breathingRate: 23,
  breathingStability: 0.4,
})

describe('baseline calibration', () => {
  it('does not invent a baseline from one frame', () => {
    const state = initialStressState()
    const { reading } = reduceStress(state, sample(), { guardrailArmed: true, now: 0 })
    expect(reading.phase).toBe('calibrating')
    expect(reading.baseline).toBeNull()
    expect(reading.baselineSamples).toBe(1)
    expect(reading.baselineProgress).toBeLessThan(0.5)
  })

  it('uses the median of confident samples', () => {
    const samples = [50, 58, 60, 61, 62, 63, 64, 65, 200].map((pulse, index) =>
      sample({ pulse, t: index * 1000 }),
    )
    const baseline = buildBaseline(samples)
    expect(baseline?.pulse).toBe(62)
  })

  it('leaves the calibrating phase once twenty seconds have passed', () => {
    let state = initialStressState()
    for (let i = 0; i < 8; i += 1) {
      state = reduceStress(state, sample({ t: i * 1000 }), {
        guardrailArmed: true,
        now: i * 1000,
      }).state
    }
    expect(state.baseline).toBeNull()

    const { reading } = reduceStress(state, sample({ t: 20_000 }), {
      guardrailArmed: true,
      now: 20_000,
    })
    expect(reading.phase).not.toBe('calibrating')
    expect(reading.baseline?.pulse).toBeGreaterThan(0)
  })

  it('ignores low-confidence pulse frames while calibrating', () => {
    let state = initialStressState()
    for (let i = 0; i < 12; i += 1) {
      state = reduceStress(state, sample({ pulseConfidence: 10, t: i * 1000 }), {
        guardrailArmed: true,
        now: i * 1000,
      }).state
    }
    expect(state.calibration).toHaveLength(0)
  })
})

describe('stress index', () => {
  it('saturates when every weighted signal is at its full deviation', () => {
    const state = feed(calibrate(), Array(6).fill(HOT), 40_000)
    const { reading } = reduceStress(state, { ...HOT, t: 50_000 }, {
      guardrailArmed: true,
      now: 50_000,
    })
    expect(reading.instant).toBeGreaterThan(0.95)
    expect(reading.index).toBeGreaterThan(0.72)
    expect(reading.phase).toBe('guardrail')
  })

  it('keeps contributions summing to the reported index', () => {
    const state = calibrate()
    const { reading } = reduceStress(
      state,
      sample({ pulse: 71, hrvRmssd: 38, breathingRate: 17 }),
      { guardrailArmed: false, now: 24_000 },
    )
    const sum = reading.contributions.reduce((total, part) => total + part.points, 0)
    expect(sum).toBeCloseTo(reading.index, 6)
    const shares = reading.contributions.reduce((total, part) => total + part.share, 0)
    expect(shares).toBeCloseTo(1, 6)
  })

  it('absorbs a single spike instead of jumping to it', () => {
    const base = calibrate()
    const { reading } = reduceStress(
      base,
      sample({ pulse: 110, hrvRmssd: 5, breathingRate: 30, breathingStability: 0.2 }),
      { guardrailArmed: true, now: 20_400 },
    )
    expect(reading.instant).toBeGreaterThan(0.85)
    expect(reading.index).toBeLessThan(0.5)
    expect(reading.phase).toBe('flow')
  })

  it('stays inside zero and one for absurd input', () => {
    const state = calibrate()
    const high = reduceStress(state, sample({ pulse: 400, hrvRmssd: 0, breathingRate: 90 }), {
      guardrailArmed: true,
      now: 30_000,
    })
    expect(high.reading.index).toBeLessThanOrEqual(1)
    expect(high.reading.index).toBeGreaterThanOrEqual(0)

    const low = reduceStress(state, sample({ pulse: 20, hrvRmssd: 300, breathingRate: 2 }), {
      guardrailArmed: true,
      now: 30_000,
    })
    expect(low.reading.index).toBeGreaterThanOrEqual(0)
  })

  it('rises faster than it falls', () => {
    const base = calibrate()
    const calm = base.smoothed
    const up = reduceStress(base, sample({ pulse: 90, hrvRmssd: 10 }), {
      guardrailArmed: true,
      now: 30_000,
    }).state.smoothed
    const down = reduceStress(
      { ...base, smoothed: up },
      sample({ pulse: 62, hrvRmssd: 48 }),
      { guardrailArmed: true, now: 31_000 },
    ).state.smoothed

    const rise = up - calm
    const fall = up - down
    expect(rise).toBeGreaterThan(fall)
    expect(fall).toBeGreaterThan(0)
  })

  it('only reports the guardrail phase while it is armed', () => {
    const hot = feed(calibrate(), Array(6).fill(HOT), 40_000)
    const final = { ...HOT, t: 50_000 }
    const armed = reduceStress(hot, final, { guardrailArmed: true, now: 50_000 }).reading
    const disarmed = reduceStress(hot, final, { guardrailArmed: false, now: 50_000 }).reading
    expect(armed.phase).toBe('guardrail')
    expect(disarmed.phase).toBe('strain')
  })
})

describe('facial tension', () => {
  it('weights fear above surprise and ignores happiness', () => {
    const fear = tensionFromExpressions([{ type: 'FEAR', confidence: 80 }])
    const surprise = tensionFromExpressions([{ type: 'SURPRISE', confidence: 80 }])
    const happy = tensionFromExpressions([{ type: 'HAPPY', confidence: 100 }])
    expect(fear).toBeGreaterThan(surprise ?? 0)
    expect(happy).toBe(0)
  })

  it('returns null when there is no expression data', () => {
    expect(tensionFromExpressions(undefined)).toBeNull()
    expect(tensionFromExpressions([])).toBeNull()
  })
})
