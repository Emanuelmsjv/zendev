import { useCallback, useEffect, useRef, useState } from 'react'
import { host } from '../lib/host'
import type { Scenario } from '../lib/simulator'
import { sampleAt } from '../lib/simulator'
import {
  initialStressState,
  reduceStress,
  tensionFromExpressions,
  type StressState,
} from '../lib/stress'
import type { SessionPoint, StressReading, VitalsSample, VitalsSource } from '../lib/types'

interface Measurement {
  value?: number | null
  confidence?: number | null
  stable?: boolean | null
}

interface HrvMessage {
  rmssd?: number | null
  confidence?: number | null
}

interface ExpressionScoreMessage {
  type?: number | string
  confidence?: number | null
}

interface MetricsMessage {
  cardio?: { pulseRate?: Measurement[]; hrv?: HrvMessage[] }
  breathing?: { rate?: Measurement[] }
  eda?: { trace?: Measurement[] }
  face?: { expression?: Array<{ scores?: ExpressionScoreMessage[] }> }
}

const EXPRESSION_NAMES: Record<number, string> = {
  1: 'ANGRY',
  2: 'CONTEMPT',
  3: 'DISGUST',
  4: 'FEAR',
  5: 'HAPPY',
  6: 'NEUTRAL',
  7: 'SAD',
  8: 'SURPRISE',
}

export interface VitalsApi {
  source: VitalsSource
  reading: StressReading
  sample: VitalsSample | null
  points: SessionPoint[]
  stream: MediaStream | null
  status: string
  hint: string | null
  error: string | null
  running: boolean
  start: () => Promise<void>
  stop: () => Promise<void>
  resetSession: () => void
}

const IDLE_READING: StressReading = {
  index: 0,
  instant: 0,
  phase: 'calibrating',
  confidence: 0,
  contributions: [],
  baseline: null,
  baselineProgress: 0,
  baselineSamples: 0,
  note: 'Press start to begin.',
}

function lastOf<T>(items: T[] | undefined): T | undefined {
  if (!items || items.length === 0) return undefined
  return items[items.length - 1]
}

const STALE_MS = 8_000

interface CachedValue {
  value: number
  confidence: number
  t: number
}

interface CachedBreathing extends CachedValue {
  stability: number
}

interface MetricsCache {
  pulse: CachedValue | null
  hrv: CachedValue | null
  breathing: CachedBreathing | null
  eda: { value: number; t: number } | null
  edaSlope: { value: number; t: number } | null
}

function emptyCache(): MetricsCache {
  return { pulse: null, hrv: null, breathing: null, eda: null, edaSlope: null }
}

function fresh<T extends CachedValue>(field: T | null, t: number): T | null {
  if (!field) return null
  return t - field.t <= STALE_MS ? field : null
}

interface SmoothedValue {
  value: number
  t: number
}

interface SmootherState {
  pulse: SmoothedValue | null
  hrv: SmoothedValue | null
  breathing: SmoothedValue | null
}

function emptySmoother(): SmootherState {
  return { pulse: null, hrv: null, breathing: null }
}

function smoothInto(
  previous: SmoothedValue | null,
  value: number,
  t: number,
  tauSeconds: number,
  maxPerSecond: number,
): SmoothedValue {
  if (!previous) return { value, t }
  const seconds = Math.max((t - previous.t) / 1000, 0.05)
  const alpha = 1 - Math.exp(-seconds / tauSeconds)
  const blended = previous.value + alpha * (value - previous.value)
  const limit = maxPerSecond * seconds
  const next = Math.min(previous.value + limit, Math.max(previous.value - limit, blended))
  return { value: next, t }
}

function smoothSample(smoother: SmootherState, sample: VitalsSample): VitalsSample {
  if (sample.pulse !== null) {
    smoother.pulse = smoothInto(smoother.pulse, sample.pulse, sample.t, 2.5, 8)
  }
  if (sample.hrvRmssd !== null) {
    smoother.hrv = smoothInto(smoother.hrv, sample.hrvRmssd, sample.t, 6, 20)
  }
  if (sample.breathingRate !== null) {
    smoother.breathing = smoothInto(smoother.breathing, sample.breathingRate, sample.t, 4, 3)
  }

  return {
    ...sample,
    pulse: sample.pulse === null ? null : (smoother.pulse?.value ?? sample.pulse),
    hrvRmssd: sample.hrvRmssd === null ? null : (smoother.hrv?.value ?? sample.hrvRmssd),
    breathingRate:
      sample.breathingRate === null ? null : (smoother.breathing?.value ?? sample.breathingRate),
  }
}

function fromMetrics(
  decoded: MetricsMessage,
  t: number,
  previous: MetricsCache,
): { sample: VitalsSample; cache: MetricsCache } {
  const cache: MetricsCache = { ...previous }

  const pulse = lastOf(decoded.cardio?.pulseRate)
  if (pulse && typeof pulse.value === 'number') {
    cache.pulse = { value: pulse.value, confidence: pulse.confidence ?? 0, t }
  }

  const hrv = lastOf(decoded.cardio?.hrv)
  if (hrv && typeof hrv.rmssd === 'number') {
    cache.hrv = { value: hrv.rmssd, confidence: hrv.confidence ?? 0, t }
  }

  const breathing = lastOf(decoded.breathing?.rate)
  if (breathing && typeof breathing.value === 'number') {
    cache.breathing = {
      value: breathing.value,
      confidence: breathing.confidence ?? 0,
      stability: breathing.stable ? 1 : 0.4,
      t,
    }
  }

  const eda = lastOf(decoded.eda?.trace)
  if (eda && typeof eda.value === 'number') {
    if (cache.eda && t > cache.eda.t) {
      cache.edaSlope = {
        value: (eda.value - cache.eda.value) / ((t - cache.eda.t) / 1000),
        t,
      }
    }
    cache.eda = { value: eda.value, t }
  }

  const pulseNow = fresh(cache.pulse, t)
  const hrvNow = fresh(cache.hrv, t)
  const breathingNow = fresh(cache.breathing, t)
  const edaSlopeNow =
    cache.edaSlope && t - cache.edaSlope.t <= STALE_MS ? cache.edaSlope.value : null

  const expression = lastOf(decoded.face?.expression)
  const scores = expression?.scores?.map((score) => ({
    type:
      typeof score.type === 'number'
        ? (EXPRESSION_NAMES[score.type] ?? 'UNSPECIFIED')
        : (score.type ?? 'UNSPECIFIED'),
    confidence: score.confidence ?? 0,
  }))

  return {
    sample: {
      t,
      pulse: pulseNow?.value ?? null,
      pulseConfidence: pulseNow?.confidence ?? 0,
      hrvRmssd: hrvNow?.value ?? null,
      hrvConfidence: hrvNow?.confidence ?? 0,
      breathingRate: breathingNow?.value ?? null,
      breathingConfidence: breathingNow?.confidence ?? 0,
      breathingStability: breathingNow?.stability ?? 0.4,
      edaSlope: edaSlopeNow,
      tension: tensionFromExpressions(scores),
    },
    cache,
  }
}

export function useVitals(options: {
  source: VitalsSource
  scenario: Scenario
  apiKey: string
  guardrailArmed: boolean
}): VitalsApi {
  const { source, scenario, apiKey, guardrailArmed } = options

  const [reading, setReading] = useState<StressReading>(IDLE_READING)
  const [sample, setSample] = useState<VitalsSample | null>(null)
  const [points, setPoints] = useState<SessionPoint[]>([])
  const [stream, setStream] = useState<MediaStream | null>(null)
  const [status, setStatus] = useState('idle')
  const [hint, setHint] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [running, setRunning] = useState(false)

  const stressRef = useRef<StressState>(initialStressState())
  const armedRef = useRef(guardrailArmed)
  const pointsRef = useRef<SessionPoint[]>([])
  const lastPointRef = useRef(-1)
  const metricCacheRef = useRef<MetricsCache>(emptyCache())
  const smootherRef = useRef<SmootherState>(emptySmoother())
  const startRef = useRef(0)
  const sdkRef = useRef<{ stop: () => Promise<void>; destroy: () => void } | null>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const phoneCleanupRef = useRef<(() => void) | null>(null)
  const runningRef = useRef(false)

  useEffect(() => {
    armedRef.current = guardrailArmed
  }, [guardrailArmed])

  const ingest = useCallback((next: VitalsSample, now: number) => {
    const { state, reading: nextReading } = reduceStress(stressRef.current, next, {
      guardrailArmed: armedRef.current,
      now,
    })
    stressRef.current = state
    setSample(next)
    setReading(nextReading)

    const t = Math.max(0, Math.round(next.t))
    if (next.t - lastPointRef.current >= 900) {
      lastPointRef.current = next.t
      const point: SessionPoint = {
        t,
        index: nextReading.index,
        pulse: next.pulse,
        breathingRate: next.breathingRate,
        hrvRmssd: next.hrvRmssd,
      }
      pointsRef.current = [...pointsRef.current.slice(-3599), point]
      setPoints(pointsRef.current)
    }
  }, [])

  const stop = useCallback(async () => {
    runningRef.current = false
    setRunning(false)
    if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }
    phoneCleanupRef.current?.()
    phoneCleanupRef.current = null
    const sdk = sdkRef.current
    sdkRef.current = null
    if (sdk) {
      try {
        await sdk.stop()
      } catch {
        setError('The SDK did not stop cleanly.')
      }
      sdk.destroy()
    }
    setStream((current) => {
      current?.getTracks().forEach((track) => track.stop())
      return null
    })
    setStatus('stopped')
  }, [])

  const start = useCallback(async () => {
    setError(null)
    setHint(null)
    stressRef.current = initialStressState()
    pointsRef.current = []
    lastPointRef.current = -1
    metricCacheRef.current = emptyCache()
    smootherRef.current = emptySmoother()
    setPoints([])
    setReading(IDLE_READING)
    setSample(null)
    startRef.current = performance.now()
    runningRef.current = true
    setRunning(true)

    if (source === 'simulated') {
      setStatus('simulated')
      const startedAt = performance.now()
      const tick = () => {
        const t = performance.now() - startedAt
        ingest(sampleAt(t, 7, scenario), performance.now())
      }
      tick()
      timerRef.current = setInterval(tick, 1000)
      return
    }

    if (!apiKey) {
      runningRef.current = false
      setRunning(false)
      setStatus('error')
      setError('No API key. Add SMARTSPECTRA_API_KEY or paste a key on the consent screen.')
      return
    }

    setStatus('starting')
    try {
      const renderer = await import('@smartspectra/node-sdk/renderer')
      const messages = await import('@smartspectra/node-sdk/messages')

      const phone = { frames: 0, busy: false }
      let incoming: MediaStream | null = null

      if (source === 'phone') {
        const bridge = host()
        if (!bridge) {
          throw new Error('The phone camera needs the desktop build. Run npm run app.')
        }
        const info = await bridge.phoneInfo()
        if (!info.available || !info.url) {
          throw new Error(info.reason ?? 'The phone camera bridge could not start.')
        }

        const canvas = document.createElement('canvas')
        canvas.width = 1280
        canvas.height = 720
        const context = canvas.getContext('2d', { willReadFrequently: true })
        if (!context) throw new Error('Canvas is unavailable in this window.')

        const canvasStream = canvas.captureStream(30)
        incoming = canvasStream
        setStream(canvasStream)
        setStatus('waiting for phone')

        const unsubscribe = bridge.onPhoneFrame((bytes) => {
          if (!runningRef.current || phone.busy) return
          phone.busy = true
          createImageBitmap(new Blob([bytes.slice()], { type: 'image/jpeg' }))
            .then((bitmap) => {
              if (runningRef.current) {
                context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
                phone.frames += 1
                if (phone.frames === 1) setStatus('phone streaming')
              }
              bitmap.close()
            })
            .catch(() => undefined)
            .finally(() => {
              phone.busy = false
            })
        })

        phoneCleanupRef.current = () => {
          unsubscribe()
          for (const track of canvasStream.getTracks()) track.stop()
        }
      }

      const sdk = new renderer.SmartSpectraSDK({
        apiKey,
        requestedMetrics: [...renderer.breathingMetrics, ...renderer.cardioMetrics],
        enableTelemetry: false,
      })

      sdkRef.current = sdk

      if (incoming) sdk.useMediaStream(incoming)

      sdk.on('streamAvailable', (available) => {
        setStream(available)
      })

      sdk.on('processingStatus', (value) => {
        const label =
          value === renderer.ProcessingStatus.kRunning
            ? 'measuring'
            : value === renderer.ProcessingStatus.kStarting
              ? 'starting'
              : value === renderer.ProcessingStatus.kError
                ? 'error'
                : 'idle'
        setStatus(source === 'phone' && phone.frames === 0 ? 'waiting for phone' : label)
      })

      sdk.on('validationStatus', (_code, _timestamp, message) => {
        setHint(message)
      })

      sdk.on('metrics', (buffer) => {
        if (!runningRef.current) return
        const t = performance.now() - startRef.current
        const decoded = messages.decodeMetrics(buffer) as unknown as MetricsMessage
        const merged = fromMetrics(decoded, t, metricCacheRef.current)
        metricCacheRef.current = merged.cache
        ingest(smoothSample(smootherRef.current, merged.sample), performance.now())
      })

      sdk.on('error', (code, message, retryable) => {
        setError(`${message}${retryable ? ' (retryable)' : ''} [code ${code}]`)
        setStatus('error')
      })

      await sdk.start()
      setStatus(source === 'phone' && phone.frames === 0 ? 'waiting for phone' : 'measuring')
    } catch (cause) {
      runningRef.current = false
      setRunning(false)
      setStatus('error')
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }, [apiKey, ingest, scenario, source])

  const resetSession = useCallback(() => {
    stressRef.current = initialStressState()
    pointsRef.current = []
    lastPointRef.current = -1
    metricCacheRef.current = emptyCache()
    smootherRef.current = emptySmoother()
    setPoints([])
    setReading(IDLE_READING)
    setSample(null)
    startRef.current = performance.now()
  }, [])

  useEffect(() => {
    return () => {
      runningRef.current = false
      if (timerRef.current) clearInterval(timerRef.current)
      phoneCleanupRef.current?.()
      phoneCleanupRef.current = null
      const sdk = sdkRef.current
      sdkRef.current = null
      if (sdk) {
        void sdk.stop().catch(() => undefined)
        sdk.destroy()
      }
    }
  }, [])

  return {
    source,
    reading,
    sample,
    points,
    stream,
    status,
    hint,
    error,
    running,
    start,
    stop,
    resetSession,
  }
}
