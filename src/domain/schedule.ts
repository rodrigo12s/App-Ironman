import { weekdayOf } from './dates'
import type { Commitment, Plan, Profile, Schedule, TimeWindow, Weekday } from './types'

/** Margem antes e depois de um compromisso (deslocações, mudar de roupa) */
export const BUFFER = 15
const MIN_SLOT = 20

export const toHHMM = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
export const fromHHMM = (s: string) => {
  const [h, m] = s.split(':').map(Number)
  return h * 60 + (m || 0)
}

export function commitmentsOn(schedule: Schedule, date: string): Commitment[] {
  const wd = weekdayOf(date)
  return schedule.commitments.filter((c) => {
    if (c.date) return c.date === date
    if (c.weekday !== wd) return false
    if (c.from && date < c.from) return false
    if (c.until && date > c.until) return false
    return !c.except?.includes(date)
  })
}

/** Compromissos que ocupam horas (os de dia inteiro só quando marcados assim) */
export function busyOn(schedule: Schedule, date: string): Commitment[] {
  return commitmentsOn(schedule, date).filter((c) => !c.allDay || c.blocksDay)
}

/** Janelas de treino iguais em todos os dias, a partir da hora mais cedo e mais tarde */
export const windowsFromLimits = (start: number, end: number): TimeWindow[][] => Array.from({ length: 7 }, () => [{ start, end }])

/** Tira os intervalos `cut` (com margem) aos intervalos `slots` */
export function subtract(slots: TimeWindow[], cut: TimeWindow[], buffer = 0): TimeWindow[] {
  let out = slots.map((s) => ({ ...s }))
  for (const c of cut) {
    const a = c.start - buffer
    const b = c.end + buffer
    out = out.flatMap((s) => {
      if (b <= s.start || a >= s.end) return [s]
      const parts: TimeWindow[] = []
      if (a > s.start) parts.push({ start: s.start, end: a })
      if (b < s.end) parts.push({ start: b, end: s.end })
      return parts
    })
  }
  return out.filter((s) => s.end - s.start >= MIN_SLOT).sort((x, y) => x.start - y.start)
}

/** Janelas livres para treinar numa data, já sem aulas, ginásio, futebol e trabalho */
export function freeSlots(profile: Profile, date: string, override?: number): TimeWindow[] {
  const windows = profile.schedule.windows[weekdayOf(date)] ?? []
  const slots = subtract(windows, busyOn(profile.schedule, date), BUFFER)
  return override === undefined ? slots : capSlots(slots, override)
}

/** Limita o total de minutos das janelas (quando o utilizador diz "hoje só tenho X min") */
export function capSlots(slots: TimeWindow[], minutes: number): TimeWindow[] {
  const out: TimeWindow[] = []
  let left = minutes
  for (const s of [...slots].sort((a, b) => b.end - b.start - (a.end - a.start))) {
    if (left < MIN_SLOT) break
    const len = Math.min(left, s.end - s.start)
    out.push({ start: s.start, end: s.start + len })
    left -= len
  }
  return out.sort((a, b) => a.start - b.start)
}

export const total = (slots: TimeWindow[]) => slots.reduce((a, s) => a + s.end - s.start, 0)

/** Janelas livres que sobram depois das sessões já marcadas nesse dia */
export function remainingSlots(profile: Profile, plan: Pick<Plan, 'dayOverrides' | 'sessions'>, date: string, exceptId?: string): TimeWindow[] {
  const base = freeSlots(profile, date, plan.dayOverrides[date])
  const booked = plan.sessions
    .filter((s) => s.date === date && !s.skipped && s.id !== exceptId && s.kind !== 'fixed' && s.start !== undefined)
    .map((s) => ({ start: s.start!, end: s.start! + s.minutes }))
  return subtract(base, booked)
}

/** Minutos livres numa semana típica, por dia (para mostrar no questionário) */
export function typicalWeek(profile: Pick<Profile, 'schedule'>, refMonday: string): number[] {
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(refMonday + 'T12:00:00')
    d.setDate(d.getDate() + i)
    const date = d.toISOString().slice(0, 10)
    const windows = profile.schedule.windows[i] ?? []
    return total(subtract(windows, busyOn(profile.schedule, date), BUFFER))
  })
}

export const isTrainingCommitment = (c: Commitment) => !c.allDay && (c.kind === 'gym' || c.kind === 'football')

/** Ginásio e futebol que contam como treino, por semana típica */
export function weeklyTraining(schedule: Schedule): { gym: number; football: number; footballDays: Weekday[] } {
  const recurring = schedule.commitments.filter((c) => c.weekday !== undefined)
  const gym = recurring.filter((c) => c.kind === 'gym').length
  const fb = recurring.filter((c) => c.kind === 'football')
  return { gym, football: fb.length, footballDays: fb.map((c) => c.weekday!) }
}
