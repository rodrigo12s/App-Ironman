import { addDaysIso, mondayOf } from './dates'
import { allowedOn, bestSlot, estimateTss, priority } from './plan'
import { freeSlots, remainingSlots, subtract, toHHMM } from './schedule'
import type { Plan, Profile, Session, TimeWindow } from './types'

export interface AdaptResult {
  plan: Plan
  /** Frases para mostrar ao utilizador sobre o que mudou */
  changes: string[]
}

function withMinutes(s: Session, minutes: number): Session {
  const total = s.steps.reduce((a, x) => a + x.minutes, 0) || 1
  const steps = s.steps.map((x) => ({ ...x, minutes: Math.max(0.5, Math.round(((x.minutes * minutes) / total) * 2) / 2) }))
  return { ...s, minutes, steps, plannedTss: estimateTss(steps, s.sport) }
}

const label = (d: string) =>
  new Date(d + 'T12:00:00').toLocaleDateString('pt-PT', { weekday: 'long', day: 'numeric', month: 'short' })

const active = (plan: Plan, date: string, exceptId?: string) =>
  plan.sessions.filter((x) => x.date === date && !x.skipped && x.id !== exceptId)

interface Slot {
  date: string
  start: number
  minutes: number
  drop?: Session
}

/**
 * Procura um dia ainda por fazer desta semana (a partir de `from`) com uma
 * janela livre onde a sessão caiba, pelo menos a 70%. Se for preciso, tira uma
 * sessão menos importante desse dia.
 */
function findSlot(plan: Plan, profile: Profile, s: Session, from: string): Slot | null {
  const sunday = addDaysIso(mondayOf(s.date), 6)
  const options: (Slot & { score: number })[] = []
  for (let d = from; d <= sunday && d < profile.raceDate; d = addDaysIso(d, 1)) {
    if (d === s.date) continue
    const sameDay = active(plan, d, s.id)
    const need = Math.max(20, s.minutes * 0.7)
    if (allowedOn(profile, s, d, sameDay)) {
      const slot = bestSlot(remainingSlots(profile, plan, d, s.id))
      if (slot && slot.end - slot.start >= need) {
        options.push({ date: d, start: slot.start, minutes: fit(s.minutes, slot), score: slot.end - slot.start })
        continue
      }
    }
    // Tirar uma sessão secundária desse dia abre espaço?
    const droppable = sameDay.filter((x) => x.kind !== 'fixed' && priority(x) < priority(s)).sort((a, b) => priority(a) - priority(b))[0]
    if (!droppable) continue
    const without = active(plan, d, s.id).filter((x) => x.id !== droppable.id)
    if (!allowedOn(profile, s, d, without)) continue
    const slots = subtract(
      freeSlots(profile, d, plan.dayOverrides[d]),
      without.filter((x) => x.kind !== 'fixed' && x.start !== undefined).map((x) => ({ start: x.start!, end: x.start! + x.minutes })),
    )
    const slot = bestSlot(slots)
    if (slot && slot.end - slot.start >= need) {
      options.push({ date: d, start: slot.start, minutes: fit(s.minutes, slot), drop: droppable, score: slot.end - slot.start - 10000 })
    }
  }
  options.sort((a, b) => b.score - a.score)
  return options[0] ?? null
}

const fit = (minutes: number, slot: TimeWindow) => Math.floor(Math.min(minutes, slot.end - slot.start) / 5) * 5

function moveTo(plan: Plan, s: Session, slot: Slot, changes: string[]): Plan {
  const moved: Session = { ...withMinutes(s, slot.minutes), id: `${s.id}-m`, date: slot.date, start: slot.start, movedFrom: s.movedFrom ?? s.date, skipped: false }
  const sessions = plan.sessions.map((x) => (x.id === s.id || (slot.drop && x.id === slot.drop.id) ? { ...x, skipped: true } : x))
  changes.push(`"${s.title}" passou para ${label(slot.date)} às ${toHHMM(slot.start)}${slot.minutes < s.minutes ? ` (${slot.minutes} min)` : ''}.`)
  if (slot.drop) changes.push(`Para isso, "${slot.drop.title}" sai do plano.`)
  return { ...plan, sessions: [...sessions, moved] }
}

/** Marca uma sessão como não feita. Se for importante, tenta encaixá-la mais à frente na mesma semana. */
export function skipSession(plan: Plan, profile: Profile, id: string, today: string): AdaptResult {
  const s = plan.sessions.find((x) => x.id === id)
  if (!s) return { plan, changes: [] }
  const changes: string[] = []
  let next: Plan = { ...plan, sessions: plan.sessions.map((x) => (x.id === id ? { ...x, skipped: true } : x)) }

  if (s.kind === 'fixed') {
    changes.push(`"${s.title}" fica marcado como não feito esta semana.`)
  } else if (priority(s) >= 40 && s.kind !== 'race') {
    const slot = findSlot(next, profile, s, addDaysIso(s.date < today ? today : s.date, 1))
    if (slot) next = moveTo(next, s, slot, changes)
    else changes.push(`Não há espaço esta semana para recuperar "${s.title}". Segue o plano sem a compensar.`)
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
  const daySessions = active(next, date)
    .filter((s) => s.kind !== 'race' && s.kind !== 'fixed')
    .sort((a, b) => priority(b) - priority(a))

  // Volta a encaixar as sessões do dia nas janelas que sobram, das mais importantes para as menos
  let slots = freeSlots(profile, date, minutes)
  const leftOver: Session[] = []
  for (const s of daySessions) {
    const slot = bestSlot(slots)
    if (slot && slot.end - slot.start >= s.minutes) {
      next = { ...next, sessions: next.sessions.map((x) => (x.id === s.id ? { ...x, start: slot.start } : x)) }
      slots = subtract(slots, [{ start: slot.start, end: slot.start + s.minutes }])
    } else leftOver.push(s)
  }

  for (const s of leftOver) {
    const from = addDaysIso(date < today ? today : date, 1)
    const slot = priority(s) >= 20 ? findSlot(next, profile, s, from) : null
    const here = bestSlot(slots)
    if (slot) {
      next = moveTo(next, s, slot, changes)
    } else if (here && here.end - here.start >= Math.max(20, s.minutes * 0.5)) {
      const shortened = fit(s.minutes, here)
      next = { ...next, sessions: next.sessions.map((x) => (x.id === s.id ? { ...withMinutes(x, shortened), start: here.start } : x)) }
      slots = subtract(slots, [{ start: here.start, end: here.start + shortened }])
      changes.push(`"${s.title}" fica reduzida a ${shortened} min.`)
    } else {
      next = { ...next, sessions: next.sessions.map((x) => (x.id === s.id ? { ...x, skipped: true } : x)) }
      changes.push(`"${s.title}" fica de fora.`)
    }
  }
  if (changes.length === 0) changes.push('O plano desse dia já cabe no tempo que tens.')
  return { plan: { ...next, sessions: sortSessions(next.sessions) }, changes }
}

const sortSessions = (s: Session[]) => [...s].sort((a, b) => a.date.localeCompare(b.date) || (a.start ?? 0) - (b.start ?? 0))
