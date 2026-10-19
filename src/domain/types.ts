export type Sport = 'swim' | 'bike' | 'run' | 'strength' | 'brick'

export type Phase = 'base' | 'build' | 'peak' | 'taper' | 'race'

/** 0 = segunda ... 6 = domingo */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6

export interface TestResults {
  /** Natação: tempo dos 400 m e dos 200 m, em segundos */
  swim400Sec?: number
  swim200Sec?: number
  /** Bicicleta: potência média no teste de 20 min (W) */
  bike20minWatts?: number
  /** Bicicleta: FC média nos últimos 20 min de um esforço de 30 min */
  bikeLthr?: number
  /** Corrida: ritmo médio do teste de 30 min, em segundos por km */
  run30minPaceSecPerKm?: number
  /** Corrida: FC média dos últimos 20 min do teste de 30 min */
  runLthr?: number
  testedOn?: string
}

export interface Profile {
  name: string
  raceName: string
  raceDate: string // yyyy-MM-dd
  planStart: string // yyyy-MM-dd
  /** Minutos disponíveis por dia da semana (segunda a domingo) */
  availability: [number, number, number, number, number, number, number]
  tests: TestResults
}

export interface Step {
  label: string
  minutes: number
  zone: number // 1..5
}

export interface Session {
  id: string
  date: string // yyyy-MM-dd
  sport: Sport
  kind: 'endurance' | 'long' | 'tempo' | 'intervals' | 'recovery' | 'test' | 'strength' | 'brick' | 'race'
  title: string
  minutes: number
  key: boolean
  steps: Step[]
  plannedTss: number
  /** Sessão marcada como falhada pelo utilizador */
  skipped?: boolean
  /** Data original, se a sessão foi movida */
  movedFrom?: string
}

export interface Week {
  index: number
  start: string // segunda-feira
  phase: Phase
  recovery: boolean
  targetMinutes: number
}

export interface Plan {
  generatedAt: string
  weeks: Week[]
  sessions: Session[]
  /** Minutos disponíveis num dia específico, quando diferem do habitual */
  dayOverrides: Record<string, number>
}

export interface Activity {
  id: string
  date: string // yyyy-MM-dd
  startTime: string // ISO
  sport: Sport | 'other'
  durationSec: number
  distanceM?: number
  avgHr?: number
  avgPower?: number
  normalizedPower?: number
  avgSpeed?: number // m/s
  tss: number
  tssMethod: 'power' | 'pace' | 'hr' | 'estimate'
  source: 'fit' | 'manual'
  name?: string
}

export interface Wellness {
  date: string
  sleepHours?: number
  restingHr?: number
  hrv?: number
  feeling?: 1 | 2 | 3 | 4 | 5
  soreness?: string
}

export interface AppState {
  profile: Profile | null
  plan: Plan | null
  activities: Activity[]
  wellness: Wellness[]
}
