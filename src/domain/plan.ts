import { addDaysIso, daysBetween, mondayOf, weekdayOf } from './dates'
import { commitmentsOn, freeSlots, isTrainingCommitment, subtract, total, typicalWeek, weeklyTraining } from './schedule'
import type { Athlete, Level, Phase, Plan, Profile, Session, Sport, Step, TimeWindow, Week } from './types'

/** Fator de intensidade típico de cada zona, usado para estimar a carga planeada */
const ZONE_IF = [0, 0.55, 0.7, 0.83, 0.95, 1.08]

/** Limites para não exagerar num primeiro Ironman */
const MAX_LONG_RIDE = 360
const MAX_LONG_RUN = 150
const MAX_LONG_RUN_INJURED = 120
const MAX_SWIM = 75

const RUN_INJURIES = ['knee', 'shin', 'achilles', 'plantar', 'hip']
export const hasRunInjury = (a: Athlete) => a.injuries.some((i) => RUN_INJURIES.includes(i))

const LEVEL_SCORE: Record<Level, number> = { none: 0, beginner: 1, intermediate: 2, advanced: 3 }

export function estimateTss(steps: Step[], sport: Sport): number {
  const hours = steps.reduce((a, s) => a + s.minutes, 0) / 60
  if (sport === 'strength') return Math.round(hours * 40)
  if (sport === 'football') return Math.round(hours * 70)
  const tss = steps.reduce((acc, s) => acc + (s.minutes / 60) * ZONE_IF[s.zone] ** 2 * 100, 0)
  return Math.round(tss)
}

/** Minutos semanais no pico, conforme o objetivo, a experiência e o tempo livre */
export function peakTarget(profile: Profile): number {
  const a = profile.athlete
  const capacity = typicalWeek(profile, mondayOf(profile.planStart)).reduce((x, y) => x + y, 0)
  const avgLevel = (LEVEL_SCORE[a.level.swim] + LEVEL_SCORE[a.level.bike] + LEVEL_SCORE[a.level.run]) / 3
  const goal = a.goal === 'time' ? 900 : avgLevel < 1.5 ? 720 : 780
  const available = a.availableHours ? a.availableHours * 60 : Infinity
  return Math.round(Math.min(capacity * 0.9, goal, available))
}

/** Divide as semanas entre as fases, contando para trás a partir da semana da prova */
export function buildWeeks(profile: Profile): Week[] {
  const first = mondayOf(profile.planStart)
  const raceMonday = mondayOf(profile.raceDate)
  const n = Math.floor(daysBetween(first, raceMonday) / 7) + 1
  if (n < 4) throw new Error('São precisas pelo menos 4 semanas até à prova.')

  const taper = n >= 16 ? 2 : 1
  const peakWeeks = n >= 12 ? 3 : n >= 8 ? 2 : 1
  const rest = n - 1 - taper - peakWeeks
  const build = Math.round(rest * 0.4)
  const base = rest - build

  const phases: Phase[] = [
    ...Array<Phase>(base).fill('base'),
    ...Array<Phase>(build).fill('build'),
    ...Array<Phase>(peakWeeks).fill('peak'),
    ...Array<Phase>(taper).fill('taper'),
    'race',
  ]

  const peak = peakTarget(profile)
  // Começa perto do que já treinas hoje, nunca abaixo de 3 h
  const start = Math.max(180, Math.min(profile.athlete.currentWeeklyHours * 60 * 1.05, peak * 0.85))
  const ramp = base + build

  const weeks: Week[] = []
  let blockCounter = 0
  let lastLoad = 0
  phases.forEach((phase, index) => {
    const weekStart = addDaysIso(first, index * 7)
    const inBlock = phase === 'base' || phase === 'build'
    blockCounter = inBlock ? blockCounter + 1 : 0
    const recovery = inBlock && blockCounter % 4 === 0

    let target: number
    if (inBlock) target = start + (peak * 0.95 - start) * (index / Math.max(1, ramp - 1))
    else if (phase === 'peak') target = peak
    else if (phase === 'taper') target = peak * (index === n - 2 ? 0.55 : 0.7)
    else target = peak * 0.35
    target = Math.round(target)

    // Subidas de volume semanais limitadas a 10%
    if (inBlock && !recovery && lastLoad > 0 && target > lastLoad * 1.1) target = Math.round(lastLoad * 1.1)
    if (recovery) target = Math.round(target * 0.65)
    else lastLoad = Math.max(lastLoad, target)

    weeks.push({ index, start: weekStart, phase, recovery, targetMinutes: target })
  })
  return weeks
}

export interface Draft {
  sport: Sport
  kind: Session['kind']
  title: string
  minutes: number
  key: boolean
  steps: (minutes: number) => Step[]
  /** Sessão longa: vai para os dias com mais tempo */
  long?: boolean
}

const wuCd = (minutes: number, main: Step[]): Step[] => {
  const wu = Math.min(15, Math.round(minutes * 0.15))
  const cd = Math.min(10, Math.round(minutes * 0.1))
  const mainTotal = main.reduce((a, s) => a + s.minutes, 0)
  const filler = Math.max(0, minutes - wu - cd - mainTotal)
  return [
    { label: 'Aquecimento', minutes: wu, zone: 1 },
    ...main,
    ...(filler > 0 ? [{ label: 'Resistência', minutes: filler, zone: 2 }] : []),
    { label: 'Retorno à calma', minutes: cd, zone: 1 },
  ]
}

const intervals = (reps: number, on: number, zone: number, off: number, label: string): Step[] =>
  Array.from({ length: reps }, (_, i) => [
    { label: `${label} ${i + 1}/${reps}`, minutes: on, zone },
    { label: 'Recuperação', minutes: off, zone: 1 },
  ]).flat()

/** Quanto do volume vai para cada modalidade, conforme os pontos fracos e as lesões */
export function sportShares(athlete: Athlete, footballMinutes: number, weekMinutes: number) {
  const shares = { swim: 0.18, bike: 0.5, run: 0.27 }
  const levels = athlete.level
  const weakest = (['swim', 'bike', 'run'] as const).reduce((w, s) => (LEVEL_SCORE[levels[s]] < LEVEL_SCORE[levels[w]] ? s : w), 'bike' as 'swim' | 'bike' | 'run')
  if (LEVEL_SCORE[levels[weakest]] < 2 && weakest !== 'bike') {
    shares[weakest] += 0.05
    shares.bike -= 0.05
  }
  if (hasRunInjury(athlete)) {
    shares.run -= 0.04
    shares.bike += 0.04
  }
  // O futebol já dá impacto e intensidade de corrida: tira parte do volume de corrida
  if (footballMinutes > 0 && weekMinutes > 0) {
    shares.run -= Math.min(shares.run * 0.35, (footballMinutes * 0.4) / weekMinutes)
  }
  return shares
}

interface WeekCtx {
  athlete: Athlete
  testWeek: boolean
  /** Semanas de progressão já feitas (para subir as sessões longas aos poucos) */
  progression: number
  gymPerWeek: number
  footballMinutes: number
}

export function weekDrafts(week: Week, ctx: WeekCtx): Draft[] {
  const { athlete, testWeek, progression } = ctx
  const t = week.targetMinutes
  const shares = sportShares(athlete, ctx.footballMinutes, t)
  const swim = t * shares.swim
  const bike = t * shares.bike
  const run = t * shares.run
  const { phase } = week
  const d: Draft[] = []

  if (phase === 'race') {
    d.push(
      { sport: 'swim', kind: 'endurance', title: 'Natação de ativação', minutes: 30, key: false, steps: (m) => wuCd(m, intervals(4, 2, 4, 1, 'Ritmo de prova')) },
      { sport: 'bike', kind: 'endurance', title: 'Bicicleta de ativação', minutes: 45, key: false, steps: (m) => wuCd(m, intervals(3, 3, 3, 3, 'Ritmo de prova')) },
      { sport: 'run', kind: 'endurance', title: 'Corrida de ativação', minutes: 25, key: false, steps: (m) => wuCd(m, intervals(4, 1, 4, 2, 'Aceleração')) },
    )
    return d
  }

  const powerTest = athlete.hasPowerMeter || athlete.hasSmartTrainer
  if (testWeek) {
    d.push(
      { sport: 'swim', kind: 'test', title: 'Teste CSS (400 m + 200 m)', minutes: 45, key: true, steps: () => [
        { label: 'Aquecimento', minutes: 15, zone: 1 },
        { label: '400 m a fundo', minutes: 8, zone: 5 },
        { label: 'Recuperação', minutes: 8, zone: 1 },
        { label: '200 m a fundo', minutes: 4, zone: 5 },
        { label: 'Retorno à calma', minutes: 10, zone: 1 },
      ] },
      { sport: 'bike', kind: 'test', title: powerTest ? 'Teste FTP (20 min)' : 'Teste de limiar na bicicleta (30 min)', minutes: 60, key: true, steps: () => [
        { label: 'Aquecimento', minutes: 20, zone: 2 },
        { label: '5 min forte', minutes: 5, zone: 4 },
        { label: 'Recuperação', minutes: 5, zone: 1 },
        { label: powerTest ? '20 min o mais forte possível' : '30 min ao máximo sustentável (regista a FC dos últimos 20)', minutes: 25, zone: 4 },
        { label: 'Retorno à calma', minutes: 5, zone: 1 },
      ] },
      { sport: 'run', kind: 'test', title: 'Teste de limiar (30 min)', minutes: 50, key: true, steps: () => [
        { label: 'Aquecimento', minutes: 12, zone: 1 },
        { label: '30 min ao máximo sustentável', minutes: 30, zone: 4 },
        { label: 'Retorno à calma', minutes: 8, zone: 1 },
      ] },
    )
  }

  // Natação: quem está a começar faz mais técnica
  const swimBeginner = LEVEL_SCORE[athlete.level.swim] <= 1
  const swimSessions = testWeek ? 2 : 3
  const swimEach = Math.min(MAX_SWIM, Math.max(30, Math.round(swim / swimSessions / 5) * 5))
  const technique = phase === 'base' || swimBeginner
  d.push({ sport: 'swim', kind: 'endurance', title: technique ? 'Natação técnica' : 'Natação contínua', minutes: swimEach, key: false,
    steps: (m) => wuCd(m, [{ label: technique ? 'Drills: braçada, respiração bilateral, posição do corpo' : 'Nado contínuo', minutes: Math.round(m * 0.5), zone: 2 }]) })
  if (!week.recovery) {
    d.push({ sport: 'swim', kind: 'intervals', title: swimBeginner && phase === 'base' ? 'Natação: séries curtas com pausa' : 'Natação: séries ao ritmo CSS', minutes: swimEach, key: phase !== 'base',
      steps: (m) => wuCd(m, intervals(Math.max(4, Math.round(m / 10)), swimBeginner ? 2 : 4, 4, 1, swimBeginner ? '100 m' : 'CSS')) })
  }
  if (swimSessions === 3) {
    const longSwimCap = Math.min(MAX_SWIM + 15, Math.max(30, athlete.longestSwimMin) + progression * 3)
    d.push({ sport: 'swim', kind: 'long', title: phase === 'peak' ? 'Natação longa (águas abertas, se possível)' : 'Natação longa', minutes: Math.min(longSwimCap, swimEach + 15), key: phase === 'peak',
      steps: (m) => wuCd(m, [{ label: 'Nado contínuo a ritmo de prova', minutes: Math.round(m * 0.6), zone: 3 }]) })
  }

  // Bicicleta: a longa sobe ~15 min por semana a partir da mais longa que já fizeste
  const longRideCap = Math.min(MAX_LONG_RIDE, Math.max(60, athlete.longestRideMin) + progression * 15)
  // Mínimos para chegar à prova com a resistência necessária: ~3h30 na construção e 5 h no pico
  // e nunca muito abaixo do que já fazes hoje
  const rideFloor = phase === 'peak' ? 300 : phase === 'build' ? 210 : Math.max(60, Math.round((athlete.longestRideMin * 0.8) / 15) * 15)
  const longRide = Math.min(longRideCap, Math.max(rideFloor, Math.round((bike * 0.5) / 15) * 15))
  const midRide = Math.max(45, Math.round((bike * 0.27) / 5) * 5)
  const shortRide = Math.max(40, Math.round((bike * 0.23) / 5) * 5)
  const isBrick = phase === 'build' || phase === 'peak'
  if (isBrick && !week.recovery) {
    const brickRun = phase === 'peak' ? 30 : 20
    d.push({ sport: 'brick', kind: 'brick', title: 'Brick: bicicleta longa + corrida', minutes: longRide + brickRun, key: true, long: true,
      steps: (m) => {
        const bikeM = m - brickRun
        const blocks = phase === 'peak' ? 3 : 2
        const block = Math.round(bikeM * 0.15)
        return [
          { label: 'Bicicleta: aquecimento', minutes: 20, zone: 1 },
          ...Array.from({ length: blocks }, (_, i) => [
            { label: `Bicicleta: bloco a ritmo Ironman ${i + 1}/${blocks}`, minutes: block, zone: 3 },
            { label: 'Bicicleta: resistência', minutes: Math.max(5, Math.round((bikeM - 20 - blocks * block) / blocks)), zone: 2 },
          ]).flat(),
          { label: 'Transição rápida e corrida a ritmo de prova', minutes: brickRun, zone: 3 },
        ]
      } })
  } else if (!testWeek) {
    d.push({ sport: 'bike', kind: 'long', title: 'Bicicleta longa', minutes: longRide, key: true, long: true, steps: (m) => wuCd(m, []) })
  }
  if (!week.recovery && !testWeek) {
    d.push({ sport: 'bike', kind: phase === 'base' ? 'tempo' : 'intervals', title: phase === 'base' ? 'Bicicleta: tempo' : 'Bicicleta: sweet spot', minutes: midRide, key: phase !== 'base',
      steps: (m) => wuCd(m, phase === 'base' ? intervals(3, Math.round(m * 0.12), 3, 5, 'Tempo') : intervals(3, Math.round(m * 0.15), 4, 5, 'Sweet spot')) })
  }
  d.push({ sport: 'bike', kind: 'recovery', title: athlete.hasSmartTrainer ? 'Bicicleta leve (rolo)' : 'Bicicleta leve', minutes: shortRide, key: false,
    steps: (m) => [{ label: 'Rolar solto, cadência alta', minutes: m, zone: 1 }] })

  // Corrida: a longa sobe ~5 min por semana; com lesões o teto é mais baixo
  const runCap = hasRunInjury(athlete) ? MAX_LONG_RUN_INJURED : MAX_LONG_RUN
  const longRunCap = Math.min(runCap, Math.max(30, athlete.longestRunMin) + progression * 5)
  const runFloor = phase === 'peak' ? 120 : phase === 'build' ? 90 : Math.max(30, Math.round((athlete.longestRunMin * 0.75) / 5) * 5)
  const longRun = Math.min(longRunCap, Math.max(runFloor, Math.round((run * 0.45) / 5) * 5))
  const easyRun = Math.max(25, Math.round((run * 0.3) / 5) * 5)
  const tempoRun = Math.max(30, Math.round((run * 0.25) / 5) * 5)
  if (!testWeek) {
    d.push({ sport: 'run', kind: 'long', title: 'Corrida longa', minutes: longRun, key: true, long: true,
      steps: (m) => wuCd(m, phase === 'peak' ? [{ label: 'Ritmo de maratona Ironman', minutes: Math.round(m * 0.3), zone: 3 }] : []) })
  }
  d.push({ sport: 'run', kind: 'endurance', title: 'Corrida fácil + 6 acelerações', minutes: easyRun, key: false,
    steps: (m) => wuCd(m, intervals(6, 0.5, 5, 1.5, 'Aceleração')) })
  // Quem joga futebol já tem intensidade na semana: sem corrida de tempo extra
  if (!week.recovery && phase !== 'base' && !testWeek && ctx.footballMinutes === 0) {
    d.push({ sport: 'run', kind: 'tempo', title: 'Corrida: tempo', minutes: tempoRun, key: false,
      steps: (m) => wuCd(m, intervals(2, Math.round(m * 0.25), 3, 3, 'Tempo')) })
  }

  // Força: duas vezes na base, uma na construção, descontando o ginásio que já fazes
  const strength = Math.max(0, (phase === 'base' ? 2 : phase === 'build' ? 1 : 0) - ctx.gymPerWeek)
  for (let i = 0; i < strength; i++) {
    d.push({ sport: 'strength', kind: 'strength', title: 'Força e mobilidade', minutes: 30, key: false,
      steps: (m) => [{ label: 'Circuito: agachamento, peso morto, pranchas, glúteos, gémeos', minutes: m, zone: 2 }] })
  }
  return d
}

/** Prioridade para escolher o que sai quando não há tempo: maior número = mais importante */
export function priority(s: Pick<Session, 'key' | 'kind' | 'sport'>): number {
  if (s.kind === 'race' || s.kind === 'fixed') return 100
  if (s.kind === 'test') return 50
  if (s.key) return 40
  if (s.sport === 'strength') return 10
  if (s.kind === 'recovery') return 5
  return 20
}

const sportsOf = (s: Pick<Session, 'sport'>) => (s.sport === 'brick' ? ['bike', 'run'] : [s.sport])
const hardRun = (s: Pick<Session, 'sport' | 'kind'>) =>
  (s.sport === 'run' || s.sport === 'brick') && ['long', 'tempo', 'intervals', 'test', 'brick'].includes(s.kind)

/**
 * Regras de bom senso para pôr uma sessão num dia: piscina só nos dias com
 * acesso, nada de corrida no dia do futebol nem corrida dura no dia seguinte,
 * sem duas sessões-chave no mesmo dia nem a mesma modalidade duas vezes.
 */
export function allowedOn(profile: Profile, draft: Pick<Session, 'sport' | 'kind' | 'key'>, date: string, sameDay: Session[]): boolean {
  const a = profile.athlete
  const wd = weekdayOf(date)
  if (draft.sport === 'swim' && a.poolDays.length > 0 && !a.poolDays.includes(wd as never)) return false
  const football = sameDay.some((s) => s.sport === 'football')
  const footballYesterday = commitmentsOn(profile.schedule, addDaysIso(date, -1)).some((c) => c.kind === 'football' && !c.allDay)
  if (football && (draft.key || draft.sport === 'run' || draft.sport === 'brick')) return false
  if (footballYesterday && hardRun(draft)) return false
  const planned = sameDay.filter((s) => s.kind !== 'fixed' && !s.skipped)
  const limit = football ? 1 : a.maxSessionsPerDay
  if (planned.length >= limit) return false
  const mine = sportsOf(draft)
  if (planned.some((s) => sportsOf(s).some((x) => mine.includes(x)))) return false
  if (draft.key && planned.some((s) => s.key)) return false
  // Força planeada no mesmo dia do ginásio não faz sentido
  if (draft.sport === 'strength' && sameDay.some((s) => s.sport === 'strength' && !s.skipped)) return false
  return true
}

export function dayCapacity(profile: Profile, plan: Pick<Plan, 'dayOverrides'>, date: string): number {
  return total(freeSlots(profile, date, plan.dayOverrides[date]))
}

/** Sessões fixas (ginásio, futebol) que vêm do horário */
export function fixedSessions(profile: Profile, date: string): Session[] {
  return commitmentsOn(profile.schedule, date)
    .filter(isTrainingCommitment)
    .map((c) => {
      const minutes = c.end - c.start
      const sport: Sport = c.kind === 'football' ? 'football' : 'strength'
      const steps: Step[] = [{ label: c.kind === 'football' ? 'Treino ou jogo de futebol' : 'Ginásio', minutes, zone: c.kind === 'football' ? 3 : 2 }]
      return { id: `${date}-fixed-${c.id}`, date, sport, kind: 'fixed' as const, title: c.title, minutes, key: false, steps, plannedTss: estimateTss(steps, sport), start: c.start, commitmentId: c.id }
    })
}

/**
 * Hora de início dentro de uma janela livre. Treinos longos e fins de semana
 * começam cedo; nos outros dias segue a preferência (manhã ou fim do dia).
 */
export function startIn(slot: TimeWindow, minutes: number, profile: Profile, date: string, long = false): number {
  const latest = slot.end - Math.min(minutes, slot.end - slot.start)
  if (long || weekdayOf(date) >= 5 || profile.athlete.preferredTime === 'morning') return slot.start
  const target = 18 * 60
  return Math.round(Math.max(slot.start, Math.min(target, latest)) / 5) * 5
}

/** A maior janela livre; em caso de empate, a mais cedo */
export function bestSlot(slots: TimeWindow[]): TimeWindow | undefined {
  return [...slots].sort((a, b) => b.end - b.start - (a.end - a.start) || a.start - b.start)[0]
}

/**
 * Coloca as sessões nos dias e horas livres da semana: as longas primeiro, no
 * dia preferido; depois as restantes, nas maiores janelas que sobram.
 */
function placeWeek(week: Week, drafts: Draft[], profile: Profile, overrides: Record<string, number>): Session[] {
  const days = Array.from({ length: 7 }, (_, i) => addDaysIso(week.start, i)).filter((d) => d >= profile.planStart && d < profile.raceDate)
  const slots = new Map(days.map((d) => [d, freeSlots(profile, d, overrides[d])]))
  const placed = new Map<string, Session[]>(days.map((d) => [d, fixedSessions(profile, d)]))
  const longDay = profile.athlete.longDay
  const longRunDay = (longDay + 1) % 7

  const sorted = [...drafts].sort((a, b) => Number(!!b.long) - Number(!!a.long) || priority(b) - priority(a) || b.minutes - a.minutes)
  for (const draft of sorted) {
    let best: { day: string; slot: TimeWindow; score: number } | null = null
    for (const day of days) {
      if (!allowedOn(profile, draft, day, placed.get(day)!)) continue
      const slot = bestSlot(slots.get(day)!)
      if (!slot) continue
      const len = slot.end - slot.start
      // Uma sessão secundária só entra se couber pelo menos 70%; uma sessão-chave aceita até 30 min
      if (!draft.key && len < draft.minutes * 0.7) continue
      if (draft.key && len < 30) continue
      const wd = weekdayOf(day)
      let score = Math.min(len, draft.minutes) * 10 + len / 100
      if (draft.long && (draft.sport === 'bike' || draft.sport === 'brick') && wd === longDay) score += 100000
      if (draft.long && draft.sport === 'run' && wd === longRunDay) score += 100000
      if (!best || score > best.score) best = { day, slot, score }
    }
    if (!best) continue
    const len = best.slot.end - best.slot.start
    const minutes = Math.floor(Math.min(draft.minutes, len) / 5) * 5
    const steps = scaleSteps(draft.steps(minutes), minutes)
    const session: Session = {
      id: `${best.day}-${draft.sport}-${placed.get(best.day)!.length}`,
      date: best.day,
      sport: draft.sport,
      kind: draft.kind,
      title: draft.title,
      minutes,
      key: draft.key,
      steps,
      plannedTss: estimateTss(steps, draft.sport),
      start: startIn(best.slot, minutes, profile, best.day, draft.long),
    }
    placed.get(best.day)!.push(session)
    slots.set(best.day, subtract(slots.get(best.day)!, [{ start: session.start!, end: session.start! + minutes }]))
  }
  return [...placed.values()].flat().sort((a, b) => a.date.localeCompare(b.date) || (a.start ?? 0) - (b.start ?? 0))
}

/** Ajusta os passos para somarem exatamente a duração da sessão */
export function scaleSteps(steps: Step[], minutes: number): Step[] {
  const sum = steps.reduce((a, s) => a + s.minutes, 0)
  if (sum <= 0) return steps
  const f = minutes / sum
  return steps.map((s) => ({ ...s, minutes: Math.max(0.5, Math.round(s.minutes * f * 2) / 2) }))
}

function raceSession(date: string, name: string): Session {
  const steps: Step[] = [
    { label: 'Natação 3,8 km', minutes: 80, zone: 2 },
    { label: 'Bicicleta 180 km', minutes: 390, zone: 3 },
    { label: 'Maratona 42,2 km', minutes: 300, zone: 2 },
  ]
  return { id: `${date}-race`, date, sport: 'brick', kind: 'race', title: name || 'Ironman', minutes: 770, key: true, steps, plannedTss: 280, start: 7 * 60 }
}

export function generatePlan(profile: Profile, overrides: Record<string, number> = {}): Plan {
  const weeks = buildWeeks(profile)
  const training = weeklyTraining(profile.schedule)
  // Ginásio e futebol de cada semana (com eventos um a um, nenhuma semana é igual).
  // Depois do último evento conhecido usa-se a média das semanas conhecidas.
  const perWeek = weeks.map((w) => {
    const days = Array.from({ length: 7 }, (_, i) => addDaysIso(w.start, i))
    const list = days.flatMap((d) => commitmentsOn(profile.schedule, d).filter(isTrainingCommitment))
    return { gym: list.filter((c) => c.kind === 'gym').length, football: list.filter((c) => c.kind === 'football').reduce((a, c) => a + c.end - c.start, 0) }
  })
  const lastDated = profile.schedule.commitments.reduce((m, c) => (c.date && c.date > m ? c.date : m), '')
  const known = perWeek.filter((_, i) => weeks[i].start <= lastDated)
  const avg = known.length ? {
    gym: Math.round(known.reduce((a, x) => a + x.gym, 0) / known.length),
    football: Math.round(known.reduce((a, x) => a + x.football, 0) / known.length),
  } : null
  const recurringFootball = profile.schedule.commitments.filter((c) => c.kind === 'football' && c.weekday !== undefined).reduce((a, c) => a + c.end - c.start, 0)
  let recoveryCount = 0
  let progression = 0
  const sessions = weeks.flatMap((week) => {
    if (week.recovery) recoveryCount++
    else if (week.phase === 'base' || week.phase === 'build' || week.phase === 'peak') progression++
    // Testes na primeira semana, outra vez passado 1 mês (para ver a evolução) e em semanas alternadas de descarga
    const testWeek = week.index === 0 || week.index === 4 || (week.recovery && recoveryCount % 2 === 0)
    const beyond = avg && week.start > lastDated
    const gymPerWeek = beyond ? Math.max(training.gym, avg.gym) : perWeek[week.index].gym
    const footballMinutes = beyond ? Math.max(recurringFootball, avg.football) : perWeek[week.index].football
    const ctx = { athlete: profile.athlete, testWeek, progression: Math.max(0, progression - 1), gymPerWeek, footballMinutes }
    return placeWeek(week, weekDrafts(week, ctx), profile, overrides)
  })
  sessions.push(raceSession(profile.raceDate, profile.raceName))
  return { generatedAt: new Date().toISOString(), weeks, sessions, dayOverrides: overrides }
}
