export const SAMPLE_PATH = 'apps/api/src/session.ts'

export const SAMPLE_CODE = `import { db } from './db'
import { emit } from './events'

interface Session {
  id: string
  userId: string
  startedAt: number
  lastSeenAt: number
}

const TTL_MS = 30 * 60 * 1000

export async function openSession(userId: string): Promise<Session> {
  const session: Session = {
    id: crypto.randomUUID(),
    userId,
    startedAt: Date.now(),
    lastSeenAt: Date.now(),
  }

  await db.sessions.insert(session)
  emit('session:opened', session)
  return session
}

export async function touch(id: string): Promise<boolean> {
  const session = await db.sessions.find(id)
  if (session == null) return false

  const expired = Date.now() - session.lastSeenAt > TTL_MS
  if (expired) return false

  await db.sessions.update(id, { lastSeenAt: Date.now() })
  return true
}

export async function closeStale(now = Date.now()): Promise<number> {
  const sessions = await db.sessions.where({ lastSeenAt: { lt: now - TTL_MS } })
  if (!sessions.length) return 0

  for (const session of sessions) {
    await db.sessions.delete(session.id)
    emit('session:closed', session.id)
  }

  return sessions.length
}
`

export const TERMINAL_WELCOME = [
  'zendev sandbox shell — commands are simulated, nothing on disk is touched.',
  'Try: npm test · git commit -am "checkpoint" · git push --force origin main',
]
