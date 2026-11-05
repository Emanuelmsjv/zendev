import { describe, expect, it } from 'vitest'
import { SCENARIOS, sampleAt, targetsAt } from '../src/lib/simulator'

describe('simulator', () => {
  it('is deterministic for a seed and a time', () => {
    const a = sampleAt(12_345, 42, 'auto')
    const b = sampleAt(12_345, 42, 'auto')
    expect(a).toEqual(b)
  })

  it('produces different noise for a different seed', () => {
    const a = sampleAt(12_345, 42, 'calm')
    const b = sampleAt(12_345, 43, 'calm')
    expect(a.pulse).not.toEqual(b.pulse)
  })

  it('keeps every reading inside plausible ranges', () => {
    for (let t = 0; t < 120_000; t += 997) {
      const reading = sampleAt(t, 7, 'auto')
      expect(reading.pulse).toBeGreaterThan(30)
      expect(reading.pulse).toBeLessThan(160)
      expect(reading.pulseConfidence).toBeGreaterThan(0)
      expect(reading.pulseConfidence).toBeLessThanOrEqual(100)
      expect(reading.breathingRate).toBeGreaterThan(4)
      expect(reading.hrvRmssd).toBeGreaterThanOrEqual(8)
      expect(reading.breathingStability).toBeGreaterThan(0)
      expect(reading.breathingStability).toBeLessThanOrEqual(1)
    }
  })

  it('orders the scenarios by load', () => {
    const calm = targetsAt(0, 'calm')
    const deadline = targetsAt(0, 'deadline')
    const panic = targetsAt(0, 'panic')
    expect(calm.pulse).toBeLessThan(deadline.pulse)
    expect(deadline.pulse).toBeLessThan(panic.pulse)
    expect(calm.hrv).toBeGreaterThan(panic.hrv)
  })

  it('reaches the panic target during the auto arc', () => {
    const peak = targetsAt(58_000, 'auto')
    expect(peak.pulse).toBeGreaterThan(88)
    expect(peak.tension).toBeGreaterThan(0.6)
  })

  it('starts the auto arc calm so calibration is possible', () => {
    const start = targetsAt(0, 'auto')
    expect(start.pulse).toBeLessThan(70)
    expect(start.stability).toBeGreaterThan(0.9)
  })

  it('withholds EDA before the SDK would produce it', () => {
    expect(sampleAt(10_000, 7, 'auto').edaSlope).toBeNull()
    expect(sampleAt(40_000, 7, 'auto').edaSlope).not.toBeNull()
  })

  it('exposes every scenario to the picker', () => {
    expect(SCENARIOS).toHaveLength(4)
    expect(SCENARIOS.map((scenario) => scenario.id)).toContain('panic')
  })
})
