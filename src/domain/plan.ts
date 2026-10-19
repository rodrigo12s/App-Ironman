import { addDaysIso, daysBetween, mondayOf, weekdayOf } from './dates'
import type { Phase, Plan, Profile, Session, Sport, Step, Week } from './types'

/** Fator de intensidade típico de cada zona, usado para estimar a carga planeada */
const ZONE_IF = [0, 0.55, 0.7, 0.83, 0.95, 1.08]

/** Limites para não exagerar num primeiro Ironman */
const MAX_LONG_RIDE = 360
const MAX_LONG_RUN = 150
const MAX_SWIM = 75
const MAX_SESSIONS_PER_DAY = 2

export function estimateTss(steps: Step[], sport: Sport): number {
  if (sport === 'strength') return Math.round((steps.reduce((a, s) => a + s.minutes, 0) / 60) * 40)
  const tss = steps.reduce((acc, s) => acc + (s.minutes / 60) * ZONE_IF[s.zone] ** 2 * 100, 0)
  return Math.round(tss)
}

/** Divide as semanas entre as fases, contando para trás a partir da semana da prova */
export function buildWeeks(profile: Profile): Week[] {
  const first = mondayOf(profile.planStart)
  const raceMonday = mondayOf(profile.raceDate)
  const n = Math.floor(daysBetween(first, raceMonday) / 7) + 1
  if (n < 4) throw new Error('São precisas pelo menos 4 semanas até à prova.')

  const taper = n >= 16 ? 2 : 1
  const peak = n >= 12 ? 3 : n >= 8 ? 2 : 1
  const rest = n - 1 - taper - peak
  const build = Math.round(rest * 0.4)
  const base = rest - build

  const phases: Phase[] = [
    ...Array<Phase>(base).fill('base'),
    ...Array<Phase>(build).fill('build'),
    ...Array<Phase>(peak).fill('peak'),
    ...Array<Phase>(taper).fill('taper'),
    'race',
  ]

  const capacity = profile.availability.reduce((a, b) => a + b, 0)
  const weeks: Week[] = []
  let blockCounter = 0
  let lastLoad = 0
  phases.forEach((phase, index) => {
    const start = addDaysIso(first, index * 7)
    const inBlock = phase === 'base' || phase === 'build'
    blockCounter = inBlock ? blockCounter + 1 : 0
    const recovery = inBlock && blockCounter % 4 === 0

    let fraction: number
    if (phase === 'base') fraction = 0.55 + 0.2 * (index / Math.max(1, base))
    else if (phase === 'build') fraction = 0.75 + 0.15 * ((index - base) / Math.max(1, build))
    else if (phase === 'peak') fraction = 0.95
    else if (phase === 'taper') fraction = index === n - 2 ? 0.55 : 0.7
    else fraction = 0.35

    let target = Math.round(capacity * fraction)
    // Subidas de volume semanais limitadas a ~10%, exceto ao sair de uma semana de descarga
    if (!recovery && lastLoad > 0 && target > lastLoad * 1.1 && inBlock) target = Math.round(lastLoad * 1.1)
    if (recovery) target = Math.round(target * 0.65)
    else lastLoad = target

    weeks.push({ index, start, phase, recovery, targetMinutes: target })
  })
  return weeks
}

interface Draft {
  sport: Sport
  kind: Session['kind']
  title: string
  minutes: number
  key: boolean
  steps: (minutes: number) => Step[]
  /** Preferência por dias com mais tempo (sessões longas) */
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

function weekDrafts(week: Week, testWeek: boolean): Draft[] {
  const t = week.targetMinutes
  const swim = t * 0.18
  const bike = t * 0.5
  const run = t * 0.27
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

  if (testWeek) {
    d.push(
      { sport: 'swim', kind: 'test', title: 'Teste CSS (400 m + 200 m)', minutes: 45, key: true, steps: () => [
        { label: 'Aquecimento', minutes: 15, zone: 1 },
        { label: '400 m a fundo', minutes: 8, zone: 5 },
        { label: 'Recuperação', minutes: 8, zone: 1 },
        { label: '200 m a fundo', minutes: 4, zone: 5 },
        { label: 'Retorno à calma', minutes: 10, zone: 1 },
      ] },
      { sport: 'bike', kind: 'test', title: 'Teste FTP (20 min)', minutes: 60, key: true, steps: () => [
        { label: 'Aquecimento', minutes: 20, zone: 2 },
        { label: '5 min forte', minutes: 5, zone: 4 },
        { label: 'Recuperação', minutes: 10, zone: 1 },
        { label: '20 min o mais forte possível', minutes: 20, zone: 4 },
        { label: 'Retorno à calma', minutes: 5, zone: 1 },
      ] },
      { sport: 'run', kind: 'test', title: 'Teste de limiar (30 min)', minutes: 50, key: true, steps: () => [
        { label: 'Aquecimento', minutes: 12, zone: 1 },
        { label: '30 min ao máximo sustentável', minutes: 30, zone: 4 },
        { label: 'Retorno à calma', minutes: 8, zone: 1 },
      ] },
    )
  }

  // Natação
  const swimSessions = testWeek ? 2 : 3
  const swimEach = Math.min(MAX_SWIM, Math.max(30, Math.round(swim / swimSessions / 5) * 5))
  d.push({ sport: 'swim', kind: 'endurance', title: phase === 'base' ? 'Natação técnica e resistência' : 'Natação contínua', minutes: swimEach, key: false,
    steps: (m) => wuCd(m, [{ label: phase === 'base' ? 'Drills de técnica' : 'Nado contínuo', minutes: Math.round(m * 0.5), zone: 2 }]) })
  if (!week.recovery) {
    d.push({ sport: 'swim', kind: 'intervals', title: 'Natação: séries ao ritmo CSS', minutes: swimEach, key: phase !== 'base',
      steps: (m) => wuCd(m, intervals(Math.max(4, Math.round(m / 10)), 4, 4, 1, 'CSS')) })
  }
  if (swimSessions === 3) {
    d.push({ sport: 'swim', kind: 'long', title: phase === 'peak' ? 'Natação longa (águas abertas, se possível)' : 'Natação longa', minutes: Math.min(MAX_SWIM, swimEach + 10), key: phase === 'peak',
      steps: (m) => wuCd(m, [{ label: 'Nado contínuo a ritmo de prova', minutes: Math.round(m * 0.6), zone: 3 }]) })
  }

  // Bicicleta
  const longRide = Math.min(MAX_LONG_RIDE, Math.round((bike * 0.5) / 15) * 15)
  const midRide = Math.max(45, Math.round((bike * 0.27) / 5) * 5)
  const shortRide = Math.max(45, Math.round((bike * 0.23) / 5) * 5)
  const isBrick = phase === 'build' || phase === 'peak'
  if (isBrick && !week.recovery) {
    const brickRun = phase === 'peak' ? 30 : 20
    d.push({ sport: 'brick', kind: 'brick', title: 'Brick: bicicleta longa + corrida', minutes: longRide + brickRun, key: true, long: true,
      steps: (m) => {
        const bikeM = m - brickRun
        const ironmanBlocks = phase === 'peak' ? 3 : 2
        const block = Math.round(bikeM * 0.15)
        return [
          { label: 'Bicicleta: aquecimento', minutes: 20, zone: 1 },
          ...Array.from({ length: ironmanBlocks }, (_, i) => [
            { label: `Bicicleta: bloco a ritmo Ironman ${i + 1}/${ironmanBlocks}`, minutes: block, zone: 3 },
            { label: 'Bicicleta: resistência', minutes: Math.max(5, Math.round((bikeM - 20 - ironmanBlocks * block) / ironmanBlocks)), zone: 2 },
          ]).flat(),
          { label: 'Transição rápida e corrida a ritmo de prova', minutes: brickRun, zone: 3 },
        ]
      } })
  } else if (!testWeek) {
    d.push({ sport: 'bike', kind: 'long', title: 'Bicicleta longa', minutes: longRide, key: true, long: true,
      steps: (m) => wuCd(m, []) })
  }
  if (!week.recovery && !testWeek) {
    d.push({ sport: 'bike', kind: phase === 'base' ? 'tempo' : 'intervals', title: phase === 'base' ? 'Bicicleta: tempo' : 'Bicicleta: sweet spot', minutes: midRide, key: phase !== 'base',
      steps: (m) => wuCd(m, phase === 'base' ? intervals(3, Math.round(m * 0.12), 3, 5, 'Tempo') : intervals(3, Math.round(m * 0.15), 4, 5, 'Sweet spot')) })
  }
  d.push({ sport: 'bike', kind: 'recovery', title: 'Bicicleta leve', minutes: shortRide, key: false,
    steps: (m) => [{ label: 'Rolar solto, cadência alta', minutes: m, zone: 1 }] })

  // Corrida
  const longRun = Math.min(MAX_LONG_RUN, Math.round((run * 0.45) / 5) * 5)
  const easyRun = Math.max(30, Math.round((run * 0.3) / 5) * 5)
  const tempoRun = Math.max(30, Math.round((run * 0.25) / 5) * 5)
  if (!testWeek) {
    d.push({ sport: 'run', kind: 'long', title: 'Corrida longa', minutes: longRun, key: true, long: true,
      steps: (m) => wuCd(m, phase === 'peak' ? [{ label: 'Ritmo de maratona Ironman', minutes: Math.round(m * 0.3), zone: 3 }] : []) })
  }
  d.push({ sport: 'run', kind: 'endurance', title: 'Corrida fácil + 6 acelerações', minutes: easyRun, key: false,
    steps: (m) => wuCd(m, intervals(6, 0.5, 5, 1.5, 'Aceleração')) })
  if (!week.recovery && phase !== 'base' && !testWeek) {
    d.push({ sport: 'run', kind: 'tempo', title: 'Corrida: tempo', minutes: tempoRun, key: false,
      steps: (m) => wuCd(m, intervals(2, Math.round(m * 0.25), 3, 3, 'Tempo')) })
  }

  // Força: duas vezes na base, uma na construção
  const strength = phase === 'base' ? 2 : phase === 'build' ? 1 : 0
  for (let i = 0; i < strength; i++) {
    d.push({ sport: 'strength', kind: 'strength', title: 'Força e mobilidade', minutes: 30, key: false,
      steps: (m) => [{ label: 'Circuito: agachamento, peso morto, pranchas, glúteos, gémeos', minutes: m, zone: 2 }] })
  }
  return d
}

/** Prioridade para escolher o que sai quando não há tempo: maior número = mais importante */
export function priority(s: Pick<Session, 'key' | 'kind' | 'sport'>): number {
  if (s.kind === 'race') return 100
  if (s.kind === 'test') return 50
  if (s.key) return 40
  if (s.sport === 'strength') return 10
  if (s.kind === 'recovery') return 5
  return 20
}

export function dayCapacity(profile: Profile, plan: Pick<Plan, 'dayOverrides'>, date: string): number {
  return plan.dayOverrides[date] ?? profile.availability[weekdayOf(date)]
}

/**
 * Coloca as sessões nos dias da semana: as mais longas primeiro, nos dias com
 * mais tempo livre, sem repetir modalidade no mesmo dia.
 */
function placeWeek(week: Week, drafts: Draft[], profile: Profile, overrides: Record<string, number>, raceDate: string): Session[] {
  const days = Array.from({ length: 7 }, (_, i) => addDaysIso(week.start, i)).filter(
    (d) => d >= profile.planStart && d <= raceDate,
  )
  const remaining = new Map(days.map((d) => [d, overrides[d] ?? profile.availability[weekdayOf(d)]]))
  const placed = new Map<string, Session[]>(days.map((d) => [d, []]))
  if (week.phase === 'race') remaining.set(raceDate, 0)

  // Sessões longas primeiro (ficam com os dias de mais tempo, normalmente o fim de semana)
  const sorted = [...drafts].sort(
    (a, b) => Number(!!b.long) - Number(!!a.long) || priority(b) - priority(a) || b.minutes - a.minutes,
  )
  const sessions: Session[] = []
  for (const draft of sorted) {
    const sportOf = (s: Session) => (s.sport === 'brick' ? ['bike', 'run'] : [s.sport])
    const candidates = days
      .filter((d) => (placed.get(d)?.length ?? 0) < MAX_SESSIONS_PER_DAY)
      .filter((d) => !placed.get(d)!.some((s) => sportOf(s).some((x) => (draft.sport === 'brick' ? ['bike', 'run'] : [draft.sport]).includes(x))))
      // Evitar duas sessões-chave no mesmo dia
      .filter((d) => !(draft.key && placed.get(d)!.some((s) => s.key)))
      .sort((a, b) => remaining.get(b)! - remaining.get(a)!)
    const day = candidates[0]
    if (!day) continue
    const free = remaining.get(day)!
    let minutes = Math.min(draft.minutes, free)
    // Se não cabe nem 70% da sessão, uma sessão secundária fica de fora;
    // uma sessão-chave é encurtada, com um mínimo de 30 minutos
    if (minutes < draft.minutes * 0.7 || minutes < 20) {
      if (!draft.key) continue
      minutes = Math.min(draft.minutes, Math.max(free, 30))
    }
    minutes = Math.round(minutes / 5) * 5
    const steps = scaleSteps(draft.steps(minutes), minutes)
    const session: Session = {
      id: `${day}-${draft.sport}-${placed.get(day)!.length}`,
      date: day,
      sport: draft.sport,
      kind: draft.kind,
      title: draft.title,
      minutes,
      key: draft.key,
      steps,
      plannedTss: estimateTss(steps, draft.sport),
    }
    placed.get(day)!.push(session)
    remaining.set(day, free - minutes)
    sessions.push(session)
  }
  return sessions.sort((a, b) => a.date.localeCompare(b.date))
}

/** Ajusta os passos para somarem exatamente a duração da sessão */
function scaleSteps(steps: Step[], minutes: number): Step[] {
  const total = steps.reduce((a, s) => a + s.minutes, 0)
  if (total <= 0) return steps
  const f = minutes / total
  const scaled = steps.map((s) => ({ ...s, minutes: Math.max(0.5, Math.round(s.minutes * f * 2) / 2) }))
  return scaled
}

function raceSession(date: string, name: string): Session {
  const steps: Step[] = [
    { label: 'Natação 3,8 km', minutes: 80, zone: 2 },
    { label: 'Bicicleta 180 km', minutes: 390, zone: 3 },
    { label: 'Maratona 42,2 km', minutes: 300, zone: 2 },
  ]
  return { id: `${date}-race`, date, sport: 'brick', kind: 'race', title: name || 'Ironman', minutes: 770, key: true, steps, plannedTss: 280 }
}

export function generatePlan(profile: Profile, overrides: Record<string, number> = {}): Plan {
  const weeks = buildWeeks(profile)
  let recoveryCount = 0
  const sessions = weeks.flatMap((week) => {
    if (week.recovery) recoveryCount++
    // Testes na primeira semana e em semanas alternadas de descarga
    const testWeek = week.index === 0 || (week.recovery && recoveryCount % 2 === 0)
    return placeWeek(week, weekDrafts(week, testWeek), profile, overrides, profile.raceDate)
  })
  sessions.push(raceSession(profile.raceDate, profile.raceName))
  return { generatedAt: new Date().toISOString(), weeks, sessions, dayOverrides: overrides }
}
