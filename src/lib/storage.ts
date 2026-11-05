import type { Marker, SessionPoint, VitalsSource } from './types'
import type { Scenario } from './simulator'

const NAMESPACE = 'zendev.v1'

export interface Settings {
  source: VitalsSource
  apiKey: string
  guardrailEnabled: boolean
  scenario: Scenario
  breathSeconds: number
  soundEnabled: boolean
}

export const DEFAULT_SETTINGS: Settings = {
  source: 'simulated',
  apiKey: '',
  guardrailEnabled: true,
  scenario: 'auto',
  breathSeconds: 20,
  soundEnabled: true,
}

interface SessionRecord {
  savedAt: string
  points: SessionPoint[]
  markers: Marker[]
}

const canStore = (): boolean => typeof localStorage !== 'undefined'

function read<T>(key: string, fallback: T): T {
  if (!canStore()) return fallback
  try {
    const raw = localStorage.getItem(`${NAMESPACE}.${key}`)
    if (raw === null) return fallback
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

function write(key: string, value: unknown): void {
  if (!canStore()) return
  try {
    localStorage.setItem(`${NAMESPACE}.${key}`, JSON.stringify(value))
  } catch {
    return
  }
}

export function loadSettings(): Settings {
  return { ...DEFAULT_SETTINGS, ...read<Partial<Settings>>('settings', {}) }
}

export function saveSettings(patch: Partial<Settings>): Settings {
  const next = { ...loadSettings(), ...patch }
  write('settings', next)
  return next
}

export function loadConsent(): boolean {
  const record = read<{ acceptedAt: string | null }>('consent', { acceptedAt: null })
  return Boolean(record.acceptedAt)
}

export function saveConsent(): string {
  const acceptedAt = new Date().toISOString()
  write('consent', { acceptedAt })
  return acceptedAt
}

export function loadAcceptedAt(): string | null {
  return read<{ acceptedAt: string | null }>('consent', { acceptedAt: null }).acceptedAt
}

export function saveSession(record: Omit<SessionRecord, 'savedAt'>): void {
  write('session', { savedAt: new Date().toISOString(), ...record })
}

export function loadSession(): SessionRecord | null {
  return read<SessionRecord | null>('session', null)
}

export function purgeAll(): void {
  if (!canStore()) return
  for (const key of Object.keys(localStorage)) {
    if (key.startsWith(`${NAMESPACE}.`)) localStorage.removeItem(key)
  }
}
