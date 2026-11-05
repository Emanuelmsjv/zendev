export type VitalsSource = 'camera' | 'phone' | 'simulated'

export type StressPhase = 'calibrating' | 'flow' | 'strain' | 'guardrail'

export interface VitalsSample {
  t: number
  pulse: number | null
  pulseConfidence: number
  hrvRmssd: number | null
  hrvConfidence: number
  breathingRate: number | null
  breathingConfidence: number
  breathingStability: number
  edaSlope: number | null
  tension: number | null
}

export interface Baseline {
  pulse: number | null
  hrv: number | null
  breathing: number | null
  edaSlope: number | null
}

export interface Contribution {
  key: string
  label: string
  share: number
  points: number
  detail: string
  confidence: number
}

export interface StressReading {
  index: number
  instant: number
  phase: StressPhase
  confidence: number
  contributions: Contribution[]
  baseline: Baseline | null
  baselineProgress: number
  baselineSamples: number
  note: string | null
}

export type MarkerKind =
  | 'commit'
  | 'run'
  | 'guardrail-raised'
  | 'guardrail-passed'
  | 'guardrail-aborted'
  | 'phase'

export interface Marker {
  t: number
  kind: MarkerKind
  label: string
}

export interface SessionPoint {
  t: number
  index: number
  pulse: number | null
  breathingRate: number | null
  hrvRmssd: number | null
}

export interface RiskAssessment {
  level: 'safe' | 'caution' | 'destructive'
  rule: string | null
  detail: string | null
}
