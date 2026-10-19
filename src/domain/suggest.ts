import { addDaysIso, mondayOf } from './dates'
import { BUFFER, commitmentsOn, subtract } from './schedule'
import type { Profile, TimeWindow, Weekday } from './types'

/** Horas do dia em que faz sentido treinar */
const DAY_BOUNDS: Record<'week' | 'weekend', TimeWindow[]> = {
  week: [{ start: 6 * 60 + 30, end: 12 * 60 + 30 }, { start: 13 * 60 + 30, end: 21 * 60 + 30 }],
  weekend: [{ start: 8 * 60, end: 20 * 60 }],
}
const MIN_WINDOW = 45

const round15 = (m: number) => Math.floor(m / 15) * 15

/** Nos dias de semana, primeiro o fim da tarde, depois a manhã cedo, por fim o meio do dia */
function preference(w: TimeWindow, weekend: boolean): number {
  if (weekend) return w.start < 13 * 60 ? 3 : 2
  if (w.end >= 18 * 60) return 3
  if (w.end <= 9 * 60 + 30) return 2
  return 1
}

/** Tempo livre em cada dia da semana, já sem aulas, ginásio, futebol e trabalho (com margem) */
export function freeByDay(profile: Pick<Profile, 'schedule' | 'planStart'>): TimeWindow[][] {
  // Usa a primeira semana completa do plano: as aulas semanais aparecem todas
  const monday = addDaysIso(mondayOf(profile.planStart), 7)
  return Array.from({ length: 7 }, (_, i) => {
    const date = addDaysIso(monday, i)
    return subtract(DAY_BOUNDS[i >= 5 ? 'weekend' : 'week'], commitmentsOn(profile.schedule, date), BUFFER)
      .filter((w) => w.end - w.start >= MIN_WINDOW)
  })
}

/**
 * Sugere as janelas de treino a partir do calendário e das horas por semana
 * que tens: o dia do treino longo fica com o bloco maior, o dia a seguir com
 * a corrida longa, um dia de descanso, e o resto repartido pelos outros dias,
 * em horas que não chocam com nada.
 */
export function suggestWindows(profile: Pick<Profile, 'schedule' | 'planStart' | 'athlete'>, weeklyHours: number): TimeWindow[][] {
  const free = freeByDay(profile)
  const longDay = profile.athlete.longDay
  const longRun = ((longDay + 1) % 7) as Weekday
  const room = (i: number) => free[i].reduce((a, w) => a + w.end - w.start, 0)
  let budget = Math.max(0, weeklyHours * 60)

  const want: number[] = Array(7).fill(0)
  want[longDay] = Math.min(room(longDay), Math.max(180, Math.min(360, budget * 0.4)))
  want[longRun] = Math.min(room(longRun), Math.max(60, Math.min(180, budget * 0.15)))
  budget -= want[longDay] + want[longRun]

  // Descanso: o dia de semana mais ocupado, sem contar os dias longos
  const others = [0, 1, 2, 3, 4, 5, 6].filter((i) => i !== longDay && i !== longRun)
  const rest = others.filter((i) => i < 5).sort((a, b) => room(a) - room(b))[0]
  const open = others.filter((i) => i !== rest)
  // Reparte o que sobra aos bocados de 15 min, sempre ao dia com menos, até 2h30 por dia
  while (budget >= 15) {
    const day = open.filter((i) => want[i] + 15 <= Math.min(room(i), 150)).sort((x, y) => want[x] - want[y])[0]
    if (day === undefined) break
    want[day] += 15
    budget -= 15
  }

  return free.map((slots, i) => {
    let left = round15(want[i])
    if (left < MIN_WINDOW) return []
    const out: TimeWindow[] = []
    const weekend = i >= 5
    // Primeiro uma janela onde caiba tudo, depois a hora preferida
    const fits = (w: TimeWindow) => Number(w.end - w.start >= left)
    const ordered = [...slots].sort((a, b) => fits(b) - fits(a) || preference(b, weekend) - preference(a, weekend) || b.end - b.start - (a.end - a.start))
    for (const s of ordered) {
      if (left < MIN_WINDOW) break
      const len = Math.min(left, s.end - s.start)
      if (len < MIN_WINDOW) continue
      // De manhã cedo acaba antes das aulas; à tarde fica perto das 17h30, quando cabe
      const start = s.end <= 9 * 60 + 30 ? s.end - len
        : !weekend && s.start < 17 * 60 + 30 && s.end > 17 * 60 + 30 ? Math.max(s.start, Math.min(17 * 60 + 30, s.end - len))
        : s.start
      out.push({ start, end: start + len })
      left -= len
    }
    return out.sort((a, b) => a.start - b.start)
  })
}
