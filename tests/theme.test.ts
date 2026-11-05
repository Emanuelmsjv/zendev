import { describe, expect, it } from 'vitest'
import { FLOW, STRAIN, contrastRatio, mix, themeFor } from '../src/lib/theme'

const LEVELS = Array.from({ length: 21 }, (_, index) => index / 20)

describe('adaptive theme', () => {
  it('keeps primary text above AAA at every stress level', () => {
    for (const level of LEVELS) {
      const vars = themeFor(level)
      expect(contrastRatio(vars['--fg'], vars['--bg'])).toBeGreaterThanOrEqual(7)
    }
  })

  it('keeps secondary text above AA at every stress level', () => {
    for (const level of LEVELS) {
      const vars = themeFor(level)
      expect(contrastRatio(vars['--dim'], vars['--bg'])).toBeGreaterThanOrEqual(4.5)
      expect(contrastRatio(vars['--comment'], vars['--bg'])).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('returns the flow palette at zero', () => {
    const vars = themeFor(0)
    expect(vars['--bg']).toBe(FLOW.bg)
    expect(vars['--fg']).toBe(FLOW.fg)
    expect(vars['--noise']).toBe('0')
    expect(vars['--line-height']).toBe(String(FLOW.lineHeight))
  })

  it('returns the strain palette at one', () => {
    const vars = themeFor(1)
    expect(vars['--bg']).toBe(STRAIN.bg)
    expect(vars['--noise']).toBe(String(STRAIN.noise))
    expect(vars['--line-height']).toBe(String(STRAIN.lineHeight))
  })

  it('loosens the line height and hides more noise as load rises', () => {
    let previousHeight = 0
    let previousNoise = -1
    for (const level of LEVELS) {
      const vars = themeFor(level)
      const height = Number(vars['--line-height'])
      const noise = Number(vars['--noise'])
      expect(height).toBeGreaterThanOrEqual(previousHeight)
      expect(noise).toBeGreaterThanOrEqual(previousNoise)
      previousHeight = height
      previousNoise = noise
    }
  })

  it('clamps values outside zero and one', () => {
    expect(themeFor(-3)['--bg']).toBe(FLOW.bg)
    expect(themeFor(9)['--bg']).toBe(STRAIN.bg)
  })

  it('mixes hex colours componentwise', () => {
    expect(mix('#000000', '#ffffff', 0)).toBe('#000000')
    expect(mix('#000000', '#ffffff', 1)).toBe('#ffffff')
    expect(mix('#000000', '#ffffff', 0.5)).toBe('#808080')
  })
})
