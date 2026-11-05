interface Rgb {
  r: number
  g: number
  b: number
}

export interface Palette {
  bg: string
  panel: string
  fg: string
  dim: string
  accent: string
  accent2: string
  border: string
  comment: string
  string: string
  keyword: string
  noise: number
  scrim: number
  lineHeight: number
  letterSpacing: number
}

export const FLOW: Palette = {
  bg: '#080c11',
  panel: '#0f151c',
  fg: '#e9f0f8',
  dim: '#96a5b6',
  accent: '#6fe3bd',
  accent2: '#5aa9ff',
  border: '#1d2732',
  comment: '#7d8b9b',
  string: '#9fd6a4',
  keyword: '#c3a5f7',
  noise: 0,
  scrim: 0,
  lineHeight: 1.62,
  letterSpacing: 0,
}

export const STRAIN: Palette = {
  bg: '#120f0b',
  panel: '#1a1610',
  fg: '#f2e6d3',
  dim: '#b6a68f',
  accent: '#eea96a',
  accent2: '#e08a58',
  border: '#2b241b',
  comment: '#a5947c',
  string: '#c9cf9b',
  keyword: '#dcaaa2',
  noise: 0.55,
  scrim: 0.38,
  lineHeight: 1.92,
  letterSpacing: 0.2,
}

function toRgb(hex: string): Rgb {
  const value = hex.replace('#', '')
  return {
    r: parseInt(value.slice(0, 2), 16),
    g: parseInt(value.slice(2, 4), 16),
    b: parseInt(value.slice(4, 6), 16),
  }
}

function toHex({ r, g, b }: Rgb): string {
  const part = (n: number) => Math.round(Math.min(255, Math.max(0, n))).toString(16).padStart(2, '0')
  return `#${part(r)}${part(g)}${part(b)}`
}

export function mix(a: string, b: string, t: number): string {
  const from = toRgb(a)
  const to = toRgb(b)
  return toHex({
    r: from.r + (to.r - from.r) * t,
    g: from.g + (to.g - from.g) * t,
    b: from.b + (to.b - from.b) * t,
  })
}

export function channelLuminance(channel: number): number {
  const c = channel / 255
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

export function relativeLuminance(hex: string): number {
  const { r, g, b } = toRgb(hex)
  return (
    0.2126 * channelLuminance(r) +
    0.7152 * channelLuminance(g) +
    0.0722 * channelLuminance(b)
  )
}

export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a)
  const lb = relativeLuminance(b)
  const light = Math.max(la, lb)
  const dark = Math.min(la, lb)
  return (light + 0.05) / (dark + 0.05)
}

export function themeFor(stress: number): Record<string, string> {
  const t = Math.min(1, Math.max(0, stress))
  const palette: Palette = {
    bg: mix(FLOW.bg, STRAIN.bg, t),
    panel: mix(FLOW.panel, STRAIN.panel, t),
    fg: mix(FLOW.fg, STRAIN.fg, t),
    dim: mix(FLOW.dim, STRAIN.dim, t),
    accent: mix(FLOW.accent, STRAIN.accent, t),
    accent2: mix(FLOW.accent2, STRAIN.accent2, t),
    border: mix(FLOW.border, STRAIN.border, t),
    comment: mix(FLOW.comment, STRAIN.comment, t),
    string: mix(FLOW.string, STRAIN.string, t),
    keyword: mix(FLOW.keyword, STRAIN.keyword, t),
    noise: FLOW.noise + (STRAIN.noise - FLOW.noise) * t,
    scrim: FLOW.scrim + (STRAIN.scrim - FLOW.scrim) * t,
    lineHeight: FLOW.lineHeight + (STRAIN.lineHeight - FLOW.lineHeight) * t,
    letterSpacing: FLOW.letterSpacing + (STRAIN.letterSpacing - FLOW.letterSpacing) * t,
  }

  return {
    '--bg': palette.bg,
    '--panel': palette.panel,
    '--fg': palette.fg,
    '--dim': palette.dim,
    '--accent': palette.accent,
    '--accent-2': palette.accent2,
    '--border': palette.border,
    '--comment': palette.comment,
    '--string': palette.string,
    '--keyword': palette.keyword,
    '--noise': String(palette.noise),
    '--scrim': String(palette.scrim),
    '--line-height': String(palette.lineHeight),
    '--letter-spacing': `${palette.letterSpacing}px`,
  }
}

export const PHASE_COPY: Record<string, { title: string; line: string }> = {
  calibrating: {
    title: 'Learning your baseline',
    line: 'Ten seconds of steady readings, then ZenDev stops guessing.',
  },
  flow: {
    title: 'Flow',
    line: 'Low load. Full contrast, tight lines, nothing hidden.',
  },
  strain: {
    title: 'Strain',
    line: 'Load is up. Warmer light, looser lines, secondary noise recedes.',
  },
  guardrail: {
    title: 'Guardrail',
    line: 'You are about to do something irreversible while your body says stop.',
  },
}

export const PHASE_COLOR: Record<string, string> = {
  calibrating: 'var(--dim)',
  flow: 'var(--accent)',
  strain: 'var(--accent)',
  guardrail: '#ff8a7a',
}
