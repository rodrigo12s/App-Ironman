export type Sport = 'swim' | 'bike' | 'run' | 'strength' | 'brick' | 'football'

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

export type Level = 'none' | 'beginner' | 'intermediate' | 'advanced'

export type Injury = 'knee' | 'shin' | 'achilles' | 'plantar' | 'back' | 'hip' | 'other'

/** Respostas do questionário inicial */
export interface Athlete {
  age?: number
  goal: 'finish' | 'time'
  targetHours?: number
  level: { swim: Level; bike: Level; run: Level }
  /** Horas de treino por semana nas últimas 4 semanas (tudo incluído) */
  currentWeeklyHours: number
  /** Sessões mais longas das últimas 4 a 6 semanas, em minutos */
  longestRideMin: number
  longestRunMin: number
  longestSwimMin: number
  injuries: Injury[]
  hasPowerMeter: boolean
  hasHrMonitor: boolean
  hasSmartTrainer: boolean
  /** Dias com acesso a piscina (0 = segunda ... 6 = domingo) */
  poolDays: Weekday[]
  maxSessionsPerDay: 1 | 2
  /** Dia preferido para o treino longo de bicicleta */
  longDay: Weekday
}

/** Intervalo horário, em minutos desde a meia-noite */
export interface TimeWindow {
  start: number
  end: number
}

export type CommitmentKind = 'class' | 'gym' | 'football' | 'work' | 'other'

/** Compromisso fixo: aulas, ginásio, futebol, trabalho… */
export interface Commitment {
  id: string
  title: string
  kind: CommitmentKind
  start: number
  end: number
  /** Repete todas as semanas neste dia (0 = segunda) */
  weekday?: Weekday
  /** Ou acontece só nesta data */
  date?: string
  /** Período em que a repetição é válida (ex.: semestre) */
  from?: string
  until?: string
  /** Datas em que não acontece (feriados, férias) */
  except?: string[]
  source: 'manual' | 'ics'
}

export interface Schedule {
  /** Janelas em que consegues treinar, por dia da semana (segunda a domingo) */
  windows: TimeWindow[][]
  commitments: Commitment[]
}

export interface Profile {
  name: string
  raceName: string
  raceDate: string // yyyy-MM-dd
  planStart: string // yyyy-MM-dd
  athlete: Athlete
  schedule: Schedule
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
  kind: 'endurance' | 'long' | 'tempo' | 'intervals' | 'recovery' | 'test' | 'strength' | 'brick' | 'race' | 'fixed'
  /** Hora de início sugerida, em minutos desde a meia-noite */
  start?: number
  /** Para sessões fixas (ginásio, futebol): o compromisso de origem */
  commitmentId?: string
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
  /** Dados da versão antiga da app, para pré-preencher o questionário */
  legacy?: { raceName: string; raceDate: string; tests: TestResults }
}
