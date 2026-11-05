export interface HostInfo {
  apiKey: string
  platform: string
  electron: string
  chrome: string
  node: string
  isDev: boolean
  userData: string
}

export interface PhoneInfo {
  available: boolean
  url: string | null
  urls: string[]
  pairUrl: string | null
  pairUrls: string[]
  port: number | null
  httpPort: number | null
  fingerprint: string | null
  clients: number
  reason: string | null
}

export interface HostBridge {
  info: () => Promise<HostInfo>
  phoneInfo: () => Promise<PhoneInfo>
  onPhoneFrame: (callback: (bytes: Uint8Array) => void) => () => void
  onPhoneClients: (callback: (count: number) => void) => () => void
  saveExport: (payload: {
    defaultName: string
    contents: string
    filters?: Array<{ name: string; extensions: string[] }>
  }) => Promise<{ saved: boolean; path?: string }>
  writeGuardState: (state: Record<string, unknown>) => Promise<{ file: string }>
}

declare global {
  interface Window {
    zendevHost?: HostBridge
  }
}

export function host(): HostBridge | undefined {
  if (typeof window === 'undefined') return undefined
  return window.zendevHost
}

export function inElectron(): boolean {
  return typeof window !== 'undefined' && Boolean(window.zendevHost)
}
