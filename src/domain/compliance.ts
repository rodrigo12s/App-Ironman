import type { Activity, Session } from './types'

export type SessionStatus = 'planned' | 'today' | 'done' | 'partial' | 'off' | 'missed' | 'skipped'

export interface SessionMatch {
  session: Session
  activities: Activity[]
  status: SessionStatus
  /** Duração feita / duração planeada */
  ratio: number | null
}

const sportMatches = (s: Session, a: Activity) => {
  if (s.sport === 'brick') return a.sport === 'bike' || a.sport === 'run'
  if (s.sport === 'strength') return a.sport === 'strength' || a.sport === 'other'
  return s.sport === a.sport
}

/** Associa as atividades feitas às sessões planeadas do mesmo dia e modalidade */
export function matchSessions(sessions: Session[], activities: Activity[], today: string): { matches: SessionMatch[]; unplanned: Activity[] } {
  const usedIds = new Set<string>()
  const matches = sessions.map((session): SessionMatch => {
    if (session.skipped) return { session, activities: [], status: 'skipped', ratio: null }
    const found = activities.filter((a) => a.date === session.date && !usedIds.has(a.id) && sportMatches(session, a))
    // Um brick aceita uma de cada modalidade; as outras sessões ficam com uma atividade
    const picked = session.sport === 'brick' ? pickBrick(found) : found.slice(0, 1)
    picked.forEach((a) => usedIds.add(a.id))
    if (picked.length === 0) {
      const status = session.date < today ? 'missed' : session.date === today ? 'today' : 'planned'
      return { session, activities: [], status, ratio: null }
    }
    const done = picked.reduce((acc, a) => acc + a.durationSec / 60, 0)
    const ratio = done / session.minutes
    const status = ratio >= 0.8 && ratio <= 1.2 ? 'done' : ratio >= 0.5 && ratio <= 1.5 ? 'partial' : 'off'
    return { session, activities: picked, status, ratio }
  })
  const unplanned = activities.filter((a) => !usedIds.has(a.id))
  return { matches, unplanned }
}

function pickBrick(found: Activity[]): Activity[] {
  const bike = found.find((a) => a.sport === 'bike')
  const run = found.find((a) => a.sport === 'run')
  return [bike, run].filter((a): a is Activity => !!a)
}

export function complianceRate(matches: SessionMatch[]): number | null {
  const due = matches.filter((m) => m.status !== 'planned' && m.status !== 'today' && m.status !== 'skipped')
  if (due.length === 0) return null
  const ok = due.filter((m) => m.status === 'done' || m.status === 'partial').length
  return ok / due.length
}
