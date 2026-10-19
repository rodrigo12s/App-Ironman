import FitParser from 'fit-file-parser'
import { iso } from './dates'
import { computeTss } from './load'
import type { Activity, Profile } from './types'

const SPORTS: Record<string, Activity['sport']> = {
  running: 'run',
  cycling: 'bike',
  e_biking: 'bike',
  swimming: 'swim',
  training: 'strength',
  fitness_equipment: 'strength',
}

/** Lê um ficheiro .FIT (Garmin, Wahoo, Coros, Zwift…) e devolve uma atividade por sessão */
export async function parseFit(buffer: ArrayBuffer, profile: Profile | null, fileName = ''): Promise<Activity[]> {
  const parser = new FitParser({ force: true, speedUnit: 'm/s', lengthUnit: 'm', mode: 'list' })
  const data = await parser.parseAsync(buffer)
  const sessions = data.sessions ?? []
  if (sessions.length === 0) throw new Error('O ficheiro não tem nenhuma atividade.')

  return sessions
    .filter((s) => s.sport !== 'transition')
    .map((s, i) => {
      const start = s.start_time ? new Date(s.start_time) : new Date()
      const base = {
        id: `fit-${start.getTime()}-${i}`,
        date: iso(start),
        startTime: start.toISOString(),
        sport: SPORTS[String(s.sport)] ?? 'other',
        durationSec: Math.round(s.total_timer_time ?? s.total_elapsed_time ?? 0),
        distanceM: s.total_distance ? Math.round(s.total_distance) : undefined,
        avgHr: s.avg_heart_rate,
        avgPower: s.avg_power,
        normalizedPower: s.normalized_power,
        avgSpeed: s.enhanced_avg_speed ?? s.avg_speed,
        source: 'fit' as const,
        name: fileName.replace(/\.fit$/i, ''),
      }
      return { ...base, ...computeTss(base, profile) }
    })
}
