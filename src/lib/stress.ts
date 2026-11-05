import type {
  Baseline,
  Contribution,
  StressPhase,
  StressReading,
  VitalsSample,
} from './types'

export const CALIBRATION_MS = 10_000
export const CALIBRATION_MAX_SAMPLES = 24
export const MIN_BASELINE_SAMPLES = 5
export const MIN_COMPONENT_SAMPLES = 4
export const BASELINE_PULSE_CONFIDENCE = 30

export const STRAIN_THRESHOLD = 0.45
export const GUARDRAIL_THRESHOLD = 0.72

export const WEIGHTS = {
  pulse: 0.35,
  hrv: 0.3,
  breathing: 0.2,
  eda: 0.1,
  tension: 0.05,
} as const

const PULSE_DELTA_FULL = 18
const HRV_DROP_FULL = 0.45
const BREATH_DELTA_FULL = 8
const EDA_SLOPE_FULL = 0.35

const ATTACK_TAU_MS = 1200
const RELEASE_TAU_MS = 5000
const PHASE_DWELL_MS = 900
const PHASE_MARGIN = 0.04

const EXPRESSION_TENSION: Record<string, number> = {
  FEAR: 1,
  ANGRY: 0.9,
  DISGUST: 0.5,
  CONTEMPT: 0.4,
  SAD: 0.3,
  SURPRISE: 0.3,
  HAPPY: 0,
  NEUTRAL: 0,
  UNSPECIFIED: 0,
}

export interface StressState {
  baseline: Baseline | null
  calibration: VitalsSample[]
  smoothed: number
  startedAt: number
  lastAt: number
  phase: StressPhase
  phaseSince: number
}

export function initialStressState(): StressState {
  return {
    baseline: null,
    calibration: [],
    smoothed: 0,
    startedAt: -1,
    lastAt: -1,
    phase: 'calibrating',
    phaseSince: -1,
  }
}

export const clamp01 = (n: number): number => Math.min(1, Math.max(0, n))

export function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

function present(values: Array<number | null>): number[] {
  return values.filter((v): v is number => v !== null && Number.isFinite(v))
}

export function buildBaseline(samples: VitalsSample[]): Baseline | null {
  const confidentPulse = samples
    .filter((s) => s.pulse !== null && s.pulseConfidence >= BASELINE_PULSE_CONFIDENCE)
    .map((s) => s.pulse as number)

  if (confidentPulse.length < MIN_BASELINE_SAMPLES) return null

  const hrv = present(samples.filter((s) => s.hrvConfidence >= 35).map((s) => s.hrvRmssd))
  const breathing = present(
    samples.filter((s) => s.breathingConfidence >= 35).map((s) => s.breathingRate),
  )
  const edaSlope = present(samples.map((s) => s.edaSlope))

  return {
    pulse: median(confidentPulse),
    hrv: hrv.length >= MIN_COMPONENT_SAMPLES ? median(hrv) : null,
    breathing: breathing.length >= MIN_COMPONENT_SAMPLES ? median(breathing) : null,
    edaSlope: edaSlope.length >= MIN_COMPONENT_SAMPLES ? median(edaSlope) : null,
  }
}

export function tensionFromExpressions(
  scores: Array<{ type: string; confidence: number }> | null | undefined,
): number | null {
  if (!scores || scores.length === 0) return null
  let total = 0
  for (const score of scores) {
    const weight = EXPRESSION_TENSION[score.type] ?? 0
    total += weight * clamp01(score.confidence / 100)
  }
  return clamp01(total)
}

interface PhaseStep {
  phase: StressPhase
  since: number
}

function nextPhase(
  state: StressState,
  index: number,
  calibrated: boolean,
  guardrailArmed: boolean,
  now: number,
): PhaseStep {
  if (!calibrated) return { phase: 'calibrating', since: state.phaseSince }

  const current: StressPhase = state.phase === 'calibrating' ? 'flow' : state.phase
  const since = state.phase === 'calibrating' ? now : state.phaseSince

  let target: StressPhase
  if (current === 'guardrail') {
    if (guardrailArmed && index >= GUARDRAIL_THRESHOLD - PHASE_MARGIN) target = 'guardrail'
    else target = index >= STRAIN_THRESHOLD - PHASE_MARGIN ? 'strain' : 'flow'
  } else if (current === 'strain') {
    if (index < STRAIN_THRESHOLD - PHASE_MARGIN) target = 'flow'
    else if (guardrailArmed && index >= GUARDRAIL_THRESHOLD + PHASE_MARGIN) target = 'guardrail'
    else target = 'strain'
  } else if (guardrailArmed && index >= GUARDRAIL_THRESHOLD + PHASE_MARGIN) {
    target = 'guardrail'
  } else {
    target = index >= STRAIN_THRESHOLD + PHASE_MARGIN ? 'strain' : 'flow'
  }

  if (state.phase === 'calibrating' || target === current) return { phase: target, since }
  return now - since >= PHASE_DWELL_MS
    ? { phase: target, since: now }
    : { phase: current, since }
}

function blend(current: number, target: number, dtMs: number): number {
  const tau = target > current ? ATTACK_TAU_MS : RELEASE_TAU_MS
  const alpha = 1 - Math.exp(-Math.max(dtMs, 16) / tau)
  return current + alpha * (target - current)
}

export interface ReduceOptions {
  guardrailArmed: boolean
  now: number
}

export interface ReduceResult {
  state: StressState
  reading: StressReading
}

interface Part {
  key: keyof typeof WEIGHTS
  label: string
  weight: number
  score: number
  detail: string
  confidence: number
}

export function reduceStress(
  state: StressState,
  sample: VitalsSample,
  options: ReduceOptions,
): ReduceResult {
  const startedAt = state.startedAt < 0 ? options.now : state.startedAt
  const collecting =
    !state.baseline && sample.pulse !== null && sample.pulseConfidence >= BASELINE_PULSE_CONFIDENCE
  const calibration = collecting ? [...state.calibration, sample] : state.calibration

  const elapsed = options.now - startedAt
  const reachedEnd = elapsed >= CALIBRATION_MS || calibration.length >= CALIBRATION_MAX_SAMPLES
  const calibrated = state.baseline ?? (reachedEnd ? buildBaseline(calibration) : null)
  const justCalibrated = !state.baseline && calibrated !== null

  const baselineProgress = calibrated
    ? 1
    : clamp01(
        Math.max(elapsed / CALIBRATION_MS, calibration.length / MIN_BASELINE_SAMPLES),
      )

  const parts: Part[] = []

  if (calibrated?.pulse != null && sample.pulse !== null && sample.pulseConfidence >= 20) {
    parts.push({
      key: 'pulse',
      label: 'Pulse',
      weight: WEIGHTS.pulse,
      score: clamp01((sample.pulse - calibrated.pulse) / PULSE_DELTA_FULL),
      detail: `${sample.pulse.toFixed(0)} bpm, baseline ${calibrated.pulse.toFixed(0)}`,
      confidence: clamp01(sample.pulseConfidence / 100),
    })
  }

  if (calibrated?.hrv != null && sample.hrvRmssd !== null && sample.hrvConfidence >= 20) {
    const span = Math.max(calibrated.hrv * HRV_DROP_FULL, 1)
    parts.push({
      key: 'hrv',
      label: 'HRV (RMSSD)',
      weight: WEIGHTS.hrv,
      score: clamp01((calibrated.hrv - sample.hrvRmssd) / span),
      detail: `${sample.hrvRmssd.toFixed(1)} ms, baseline ${calibrated.hrv.toFixed(1)} ms`,
      confidence: clamp01(sample.hrvConfidence / 100),
    })
  }

  if (
    calibrated?.breathing != null &&
    sample.breathingRate !== null &&
    sample.breathingConfidence >= 20
  ) {
    const rateScore = clamp01((sample.breathingRate - calibrated.breathing) / BREATH_DELTA_FULL)
    const instability = 1 - clamp01(sample.breathingStability)
    parts.push({
      key: 'breathing',
      label: 'Breathing',
      weight: WEIGHTS.breathing,
      score: clamp01(rateScore * 0.75 + instability * 0.25),
      detail: `${sample.breathingRate.toFixed(1)} br/min, baseline ${calibrated.breathing.toFixed(1)}`,
      confidence: clamp01(sample.breathingConfidence / 100),
    })
  }

  if (calibrated?.edaSlope != null && sample.edaSlope !== null) {
    parts.push({
      key: 'eda',
      label: 'Skin conductance',
      weight: WEIGHTS.eda,
      score: clamp01((sample.edaSlope - calibrated.edaSlope) / EDA_SLOPE_FULL),
      detail: `slope ${sample.edaSlope.toFixed(3)}/s, baseline ${calibrated.edaSlope.toFixed(3)}/s`,
      confidence: 0.6,
    })
  }

  if (sample.tension !== null) {
    parts.push({
      key: 'tension',
      label: 'Facial tension',
      weight: WEIGHTS.tension,
      score: clamp01(sample.tension),
      detail: `${Math.round(sample.tension * 100)}% negative-expression weight`,
      confidence: 0.55,
    })
  }

  const weightSum = parts.reduce((total, part) => total + part.weight, 0)
  const instant =
    weightSum === 0
      ? 0
      : parts.reduce((total, part) => total + part.weight * part.score, 0) / weightSum

  const confidence =
    weightSum === 0
      ? 0
      : parts.reduce((total, part) => total + part.weight * part.confidence, 0) / weightSum

  const dt = state.lastAt < 0 ? 1000 : Math.max(0, options.now - state.lastAt)
  const smoothed = justCalibrated ? instant : blend(state.smoothed, instant, dt)
  const step = nextPhase(state, smoothed, calibrated !== null, options.guardrailArmed, options.now)

  const contributions: Contribution[] = parts.map((part) => {
    const share = weightSum === 0 ? 0 : part.weight / weightSum
    return {
      key: part.key,
      label: part.label,
      share,
      points: share * smoothed,
      detail: part.detail,
      confidence: part.confidence,
    }
  })

  const reading: StressReading = {
    index: clamp01(smoothed),
    instant: clamp01(instant),
    phase: step.phase,
    confidence,
    contributions,
    baseline: calibrated,
    baselineProgress,
    baselineSamples: calibration.length,
    note:
      parts.length === 0
        ? calibrated
          ? 'Waiting for a confident reading from any sensor.'
          : 'Hold still in frame while ZenDev learns your calm baseline.'
        : null,
  }

  return {
    state: {
      baseline: calibrated,
      calibration,
      smoothed,
      startedAt,
      lastAt: options.now,
      phase: step.phase,
      phaseSince: step.since,
    },
    reading,
  }
}
