import type { TestResults } from './types'

export interface Zone {
  zone: number
  name: string
  low: number
  high: number | null
}

const ZONE_NAMES = ['Recuperação', 'Resistência', 'Ritmo (tempo)', 'Limiar', 'VO2máx']

/** CSS (critical swim speed) em segundos por 100 m: (T400 - T200) / 2 */
export function cssPer100(t: TestResults): number | null {
  if (!t.swim400Sec || !t.swim200Sec || t.swim400Sec <= t.swim200Sec) return null
  return (t.swim400Sec - t.swim200Sec) / 2
}

/** FTP estimado como 95% da potência média de 20 min */
export function ftp(t: TestResults): number | null {
  return t.bike20minWatts ? Math.round(t.bike20minWatts * 0.95) : null
}

/** Ritmo de limiar na corrida (s/km): o ritmo médio do teste de 30 min é uma boa aproximação */
export function runThresholdPace(t: TestResults): number | null {
  return t.run30minPaceSecPerKm ?? null
}

/** Zonas de potência (Coggan, simplificado a 5 zonas), em watts */
export function powerZones(ftpW: number): Zone[] {
  const bounds = [0, 0.55, 0.75, 0.9, 1.05, 1.2]
  return ZONE_NAMES.map((name, i) => ({
    zone: i + 1,
    name,
    low: Math.round(ftpW * bounds[i]),
    high: i === 4 ? null : Math.round(ftpW * bounds[i + 1]) - 1,
  }))
}

/** Zonas de FC a partir da FC de limiar (Friel, simplificado a 5 zonas) */
export function hrZones(lthr: number, sport: 'bike' | 'run'): Zone[] {
  const b = sport === 'run' ? [0, 0.85, 0.9, 0.95, 1.0, 1.03] : [0, 0.81, 0.9, 0.94, 1.0, 1.03]
  return ZONE_NAMES.map((name, i) => ({
    zone: i + 1,
    name,
    low: Math.round(lthr * b[i]),
    high: i === 4 ? null : Math.round(lthr * b[i + 1]) - 1,
  }))
}

/**
 * Zonas de ritmo (s/km ou s/100 m). Valores maiores são mais lentos, por isso
 * "low" é o limite rápido e "high" o limite lento da zona.
 */
export function paceZones(threshold: number, sport: 'run' | 'swim'): Zone[] {
  // Limites do lado lento das zonas 2 a 5, como fração do ritmo de limiar
  const edges = sport === 'run' ? [1.29, 1.14, 1.06, 0.99] : [1.15, 1.07, 1.02, 0.97]
  return ZONE_NAMES.map((name, i) => ({
    zone: i + 1,
    name,
    low: i === 4 ? 0 : Math.round(threshold * edges[i]),
    high: i === 0 ? null : Math.round(threshold * edges[i - 1]),
  }))
}

export function formatPace(sec: number): string {
  const m = Math.floor(sec / 60)
  const s = Math.round(sec % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

export function parsePace(text: string): number | undefined {
  const m = text.trim().match(/^(\d+):(\d{1,2})$/)
  if (!m) return undefined
  return Number(m[1]) * 60 + Number(m[2])
}
