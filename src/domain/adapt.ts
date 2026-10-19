import { addDaysIso, mondayOf } from './dates'
import { dayCapacity, estimateTss, priority } from './plan'
import type { Plan, Profile, Session } from './types'

export interface AdaptResult {
  plan: Plan
  /** Frases para mostrar ao utilizador sobre o que mudou */
  changes: string[]
}

const used = (plan: Plan, date: string, exceptId?: string) =>
  plan.sessions.filter((s) => s.date === date && !s.skipped && s.id !== exceptId).reduce((a, s) => a + s.minutes, 0)

const sportsOn = (plan: Plan, date: string, exceptId?: string) =>
  plan.sessions
    .filter((s) => s.date === date && !s.skipped && s.id !== exceptId)
    .flatMap((s) => (s.sport === 'brick' ? ['bike', 'run'] : [s.sport]))

const clash = (plan: Plan, s: Session, date: string) => {
  const mine = s.sport === 'brick' ? ['bike', 'run'] : [s.sport]
  return sportsOn(plan, date, s.id).some((x) => mine.includes(x))
}

function withMinutes(s: Session, minutes: number): Session {
  const total = s.steps.reduce((a, x) => a + x.minutes, 0) || 1
  const steps = s.steps.map((x) => ({ ...x, minutes: Math.max(0.5, Math.round((x.minutes * minutes) / total * 2) / 2) }))
  return { ...s, minutes, steps, plannedTss: estimateTss(steps, s.sport) }
}

const label = (d: string) =>
  new Date(d + 'T12:00:00').toLocaleDateString('pt-PT', { weekday: 'long', day: 'numeric', month: 'short' })

/**
 * Procura um dia ainda por fazer desta semana (a partir de `from`) onde a sessão
 * caiba. Se for preciso, encurta-a até 70% ou tira uma sessão secundária desse dia.
 */
function findSlot(plan: Plan, profile: Profile, s: Session, from: string): { date: string; minutes: number; drop?: Session } | null {
  const sunday = addDaysIso(mondayOf(s.date), 6)
  const options: { date: string; minutes: number; drop?: Session; score: number }[] = []
  for (let d = from; d <= sunday; d = addDaysIso(d, 1)) {
    if (d >= profile.raceDate) break
    if (d === s.date || clash(plan, s, d)) continue
    // Não juntar duas sessões-chave no mesmo dia
    const others = plan.sessions.filter((x) => x.date === d && !x.skipped && x.id !== s.id)
    if (s.key && others.some((x) => x.key)) continue
    const free = dayCapacity(profile, plan, d) - used(plan, d, s.id)
    if (free >= s.minutes * 0.7 && free >= 20) {
      options.push({ date: d, minutes: Math.min(s.minutes, Math.floor(free / 5) * 5), score: free })
      continue
    }
    const droppable = others.filter((x) => priority(x) < priority(s)).sort((a, b) => priority(a) - priority(b))[0]
    if (droppable && free + droppable.minutes >= s.minutes * 0.7) {
      options.push({ date: d, minutes: Math.min(s.minutes, Math.floor((free + droppable.minutes) / 5) * 5), drop: droppable, score: free + droppable.minutes - 1000 })
    }
  }
  options.sort((a, b) => b.score - a.score)
  return options[0] ?? null
}

/** Marca uma sessão como não feita. Se for importante, tenta encaixá-la mais à frente na mesma semana. */
export function skipSession(plan: Plan, profile: Profile, id: string, today: string): AdaptResult {
  const s = plan.sessions.find((x) => x.id === id)
  if (!s) return { plan, changes: [] }
  const changes: string[] = []
  let sessions = plan.sessions.map((x) => (x.id === id ? { ...x, skipped: true } : x))
  let next: Plan = { ...plan, sessions }

  if (priority(s) >= 40 && s.kind !== 'race') {
    const from = addDaysIso(s.date < today ? today : s.date, 1)
    const slot = findSlot(next, profile, { ...s, skipped: false }, from)
    if (slot) {
      const moved = { ...withMinutes(s, slot.minutes), id: `${s.id}-m`, date: slot.date, movedFrom: s.date, skipped: false }
      sessions = next.sessions.map((x) => (slot.drop && x.id === slot.drop.id ? { ...x, skipped: true } : x))
      sessions.push(moved)
      next = { ...next, sessions }
      changes.push(`"${s.title}" passou para ${label(slot.date)}${slot.minutes < s.minutes ? ` (${slot.minutes} min)` : ''}.`)
      if (slot.drop) changes.push(`Para isso, "${slot.drop.title}" sai do plano.`)
    } else {
      changes.push(`Não há espaço esta semana para recuperar "${s.title}". Segue o plano sem a compensar.`)
    }
  } else {
    changes.push(`"${s.title}" fica de fora. Não vale a pena compensar sessões secundárias.`)
  }
  return { plan: { ...next, sessions: sortSessions(next.sessions) }, changes }
}

/**
 * Altera o tempo disponível num dia concreto (ex.: "hoje só tenho 45 min").
 * As sessões que deixam de caber são movidas, encurtadas ou retiradas, por esta ordem.
 */
export function setDayAvailability(plan: Plan, profile: Profile, date: string, minutes: number, today: string): AdaptResult {
  let next: Plan = { ...plan, dayOverrides: { ...plan.dayOverrides, [date]: minutes } }
  const changes: string[] = []
  const daySessions = next.sessions
    .filter((s) => s.date === date && !s.skipped && s.kind !== 'race')
    .sort((a, b) => priority(b) - priority(a))

  let free = minutes
  const keep: string[] = []
  for (const s of daySessions) {
    if (s.minutes <= free) {
      keep.push(s.id)
      free -= s.minutes
    }
  }
  // As que não couberam: mover para outro dia da semana, senão encurtar, senão retirar
  for (const s of daySessions) {
    if (keep.includes(s.id)) continue
    const from = addDaysIso(date < today ? today : date, 1)
    const slot = findSlot(next, profile, s, from)
    if (slot && priority(s) >= 20) {
      const moved = { ...withMinutes(s, slot.minutes), id: `${s.id}-m`, date: slot.date, movedFrom: s.date }
      next = {
        ...next,
        sessions: [
          ...next.sessions.map((x) => (x.id === s.id ? { ...x, skipped: true } : slot.drop && x.id === slot.drop.id ? { ...x, skipped: true } : x)),
          moved,
        ],
      }
      changes.push(`"${s.title}" passou para ${label(slot.date)}.`)
      if (slot.drop) changes.push(`Para isso, "${slot.drop.title}" sai do plano.`)
    } else if (free >= 20 && free >= s.minutes * 0.5) {
      const shortened = Math.floor(free / 5) * 5
      next = { ...next, sessions: next.sessions.map((x) => (x.id === s.id ? withMinutes(x, shortened) : x)) }
      changes.push(`"${s.title}" fica reduzida a ${shortened} min.`)
      free -= shortened
    } else {
      next = { ...next, sessions: next.sessions.map((x) => (x.id === s.id ? { ...x, skipped: true } : x)) }
      changes.push(`"${s.title}" fica de fora.`)
    }
  }
  if (changes.length === 0) changes.push('O plano desse dia já cabe no tempo que tens.')
  return { plan: { ...next, sessions: sortSessions(next.sessions) }, changes }
}

const sortSessions = (s: Session[]) => [...s].sort((a, b) => a.date.localeCompare(b.date) || priority(b) - priority(a))
