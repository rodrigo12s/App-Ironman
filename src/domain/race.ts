import { addDaysIso } from './dates'
import { cssPer100, runThresholdPace } from './zones'
import type { Level, Profile, RaceDistance, RaceType, Session, Step } from './types'

export const RACE_PRESETS: Record<Exclude<RaceType, 'custom'>, { label: string; swimM: number; bikeKm: number; runKm: number }> = {
  sprint: { label: 'Sprint', swimM: 750, bikeKm: 20, runKm: 5 },
  olympic: { label: 'Olímpico', swimM: 1500, bikeKm: 40, runKm: 10 },
  half: { label: 'Half (70.3)', swimM: 1900, bikeKm: 90, runKm: 21.1 },
  full: { label: 'Ironman', swimM: 3800, bikeKm: 180, runKm: 42.2 },
}

/** A distância da prova; quem ainda não escolheu fica com um Ironman completo */
export function raceOf(profile: Pick<Profile, 'race'>): RaceDistance {
  if (profile.race) return profile.race
  return { type: 'full', ...RACE_PRESETS.full }
}

export function raceLabel(r: RaceDistance): string {
  return r.type === 'custom' ? 'Distância personalizada' : RACE_PRESETS[r.type].label
}

/** Ritmos de resistência (zona 2) do atleta, pelos testes ou pela experiência */
export interface Paces {
  /** Natação, segundos por 100 m */
  swim: number
  /** Bicicleta, km/h */
  bike: number
  /** Corrida, segundos por km */
  run: number
}

const SWIM: Record<Level, number> = { none: 165, beginner: 145, intermediate: 125, advanced: 108 }
const BIKE: Record<Level, number> = { none: 23, beginner: 25, intermediate: 28, advanced: 31 }
const RUN: Record<Level, number> = { none: 450, beginner: 405, intermediate: 350, advanced: 305 }

export function enduranceSpeeds(profile: Pick<Profile, 'athlete' | 'tests'>): Paces {
  const css = cssPer100(profile.tests)
  const thr = runThresholdPace(profile.tests)
  const l = profile.athlete.level
  return {
    swim: css ? Math.round(css * 1.1) : SWIM[l.swim],
    bike: BIKE[l.bike] + (profile.athlete.hasPowerMeter ? 0.5 : 0),
    run: thr ? Math.round(thr * 1.22) : RUN[l.run],
  }
}

/** Quanto mais rápido em cada zona, em relação à zona 2 */
const ZONE_SPEED = [0, 0.88, 1, 1.07, 1.13, 1.2]

/** Duração estimada de cada parte da prova, em minutos */
export function raceMinutes(profile: Pick<Profile, 'athlete' | 'tests' | 'race'>) {
  const r = raceOf(profile)
  const p = enduranceSpeeds(profile)
  // Provas curtas fazem-se mais depressa do que o ritmo de treino longo
  const f = r.bikeKm >= 150 ? 1 : r.bikeKm >= 80 ? 1.05 : 1.12
  const swim = (r.swimM / 100) * p.swim / 60 / f
  const bike = (r.bikeKm / (p.bike * f)) * 60
  const run = (r.runKm * p.run) / 60 / f
  return { swim: Math.round(swim), bike: Math.round(bike), run: Math.round(run), total: Math.round(swim + bike + run + 8) }
}

/**
 * Limites das sessões longas para a distância da prova: o teto (o máximo que
 * faz sentido treinar) e o mínimo a atingir no pico.
 */
export function longLimits(profile: Pick<Profile, 'athlete' | 'tests' | 'race'>, runInjury: boolean) {
  const m = raceMinutes(profile)
  const rideCap = Math.min(360, Math.max(90, Math.round((m.bike * 0.95 + 60) / 15) * 15))
  const ridePeak = Math.min(300, Math.round((rideCap * 0.83) / 15) * 15)
  const runCapRace = Math.min(150, Math.max(50, Math.round((m.run * 0.75 + 30) / 5) * 5))
  const runCap = runInjury ? Math.min(runCapRace, 120) : runCapRace
  const runPeak = Math.min(120, Math.round((runCap * 0.8) / 5) * 5)
  const swimCap = Math.min(90, Math.max(40, Math.round((m.swim + 10) / 5) * 5))
  return {
    rideCap, ridePeak, rideBuild: Math.round((ridePeak * 0.7) / 15) * 15,
    runCap, runPeak, runBuild: Math.round((runPeak * 0.75) / 5) * 5,
    swimCap, swimSession: Math.min(75, swimCap),
  }
}

/** Fração do volume de um Ironman que faz sentido no pico, pela duração da prova */
export function volumeFactor(profile: Pick<Profile, 'athlete' | 'tests' | 'race'>): number {
  const r = raceOf(profile)
  if (r.type === 'full') return 1
  const m = raceMinutes(profile).total
  return Math.min(1, Math.max(0.45, 0.3 + 0.7 * Math.sqrt(m / 770)))
}

export interface Distance {
  swimM?: number
  bikeKm?: number
  runKm?: number
}

const isRunStep = (s: Step) => /corrida|correr|maratona|transição/i.test(s.label)

/** Distância estimada de uma sessão, pelos minutos de cada zona e os teus ritmos */
export function sessionDistance(s: Session, profile: Pick<Profile, 'athlete' | 'tests' | 'race'>): Distance {
  if (s.target) return s.target
  if (s.kind === 'race') {
    const r = raceOf(profile)
    return { swimM: r.swimM, bikeKm: r.bikeKm, runKm: r.runKm }
  }
  const p = enduranceSpeeds(profile)
  const km = (steps: Step[], perMinKm: number) => steps.reduce((a, x) => a + x.minutes * perMinKm * ZONE_SPEED[x.zone], 0)
  if (s.sport === 'swim') return { swimM: Math.round((km(s.steps, 100 / p.swim / 1000 * 60) * 1000) / 50) * 50 }
  if (s.sport === 'bike') return { bikeKm: Math.round(km(s.steps, p.bike / 60)) }
  if (s.sport === 'run') return { runKm: Math.round(km(s.steps, 1 / (p.run / 60)) * 10) / 10 }
  if (s.sport === 'brick') {
    return {
      bikeKm: Math.round(km(s.steps.filter((x) => !isRunStep(x)), p.bike / 60)),
      runKm: Math.round(km(s.steps.filter(isRunStep), 1 / (p.run / 60)) * 10) / 10,
    }
  }
  return {}
}

const n = (x: number, digits = 1) => x.toLocaleString('pt-PT', { maximumFractionDigits: digits })

export function formatDistance(d: Distance): string {
  return [
    d.swimM ? (d.swimM >= 1000 ? `${n(d.swimM / 1000)} km` : `${d.swimM} m`) : '',
    d.bikeKm ? `${n(d.bikeKm, 0)} km` : '',
    d.runKm ? `${n(d.runKm)} km` : '',
  ].filter(Boolean).join(' + ')
}

/** Para cada semana, a sessão mais longa de cada modalidade, em fração da distância da prova */
export function progressionToRace(profile: Profile, sessions: Session[], weeks: { start: string; index: number }[]) {
  const r = raceOf(profile)
  return weeks.map((w) => {
    const last = addDaysIso(w.start, 6)
    const list = sessions.filter((s) => s.date >= w.start && s.date <= last && !s.skipped && s.kind !== 'race' && s.kind !== 'fixed')
    const ds = list.map((s) => sessionDistance(s, profile))
    const max = (k: keyof Distance) => Math.max(0, ...ds.map((d) => d[k] ?? 0))
    return {
      week: w.index + 1,
      start: w.start,
      swimM: max('swimM'), bikeKm: max('bikeKm'), runKm: max('runKm'),
      swim: Math.round((max('swimM') / r.swimM) * 100),
      bike: Math.round((max('bikeKm') / r.bikeKm) * 100),
      run: Math.round((max('runKm') / r.runKm) * 100),
    }
  })
}
