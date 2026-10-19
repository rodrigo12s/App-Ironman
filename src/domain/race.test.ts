import { describe, expect, it } from 'vitest'
import { generatePlan, peakTarget } from './plan'
import { RACE_PRESETS, longLimits, progressionToRace, raceMinutes, sessionDistance } from './race'
import { windowsFromLimits } from './schedule'
import type { Profile, RaceType } from './types'

const base: Profile = {
  name: 'Rodrigo', raceName: 'Prova', raceDate: '2027-10-16', planStart: '2026-10-19',
  athlete: {
    goal: 'finish', level: { swim: 'beginner', bike: 'intermediate', run: 'intermediate' },
    currentWeeklyHours: 6, longestRideMin: 120, longestRunMin: 70, longestSwimMin: 40, injuries: [],
    hasPowerMeter: false, hasHrMonitor: true, hasSmartTrainer: false, poolDays: [0, 1, 2, 3, 4, 5],
    maxSessionsPerDay: 2, longDay: 5, availableHours: 14,
  },
  schedule: { windows: windowsFromLimits(390, 1320), commitments: [] },
  tests: {},
}
const withRace = (type: Exclude<RaceType, 'custom'>): Profile => ({ ...base, race: { type, ...RACE_PRESETS[type] } })

describe('distância da prova', () => {
  it('sem distância conta com um Ironman e mantém os limites antigos', () => {
    const l = longLimits(base, false)
    expect(l.rideCap).toBe(360)
    expect(l.ridePeak).toBe(300)
    expect(l.runCap).toBe(150)
    expect(l.runPeak).toBe(120)
    expect(raceMinutes(base).total).toBeGreaterThan(700)
  })

  it('provas mais curtas: menos volume e sessões longas mais curtas', () => {
    const peaks = (['sprint', 'olympic', 'half', 'full'] as const).map((t) => peakTarget(withRace(t)))
    expect(peaks).toEqual([...peaks].sort((a, b) => a - b))
    expect(peaks[0]).toBeLessThan(peaks[3] * 0.7)
    const half = generatePlan(withRace('half'))
    const full = generatePlan(withRace('full'))
    const longest = (p: typeof half, sport: string) => Math.max(...p.sessions.filter((s) => s.sport === sport && s.kind !== 'race').map((s) => s.minutes))
    expect(longest(half, 'run')).toBeLessThan(longest(full, 'run'))
    expect(longest(half, 'bike')).toBeLessThan(longest(full, 'bike'))
    const race = half.sessions.find((s) => s.kind === 'race')!
    expect(race.steps.map((s) => s.label)).toEqual(['Natação 1,9 km', 'Bicicleta 90 km', 'Corrida 21,1 km'])
  })

  it('as sessões longas evoluem até perto das distâncias da prova', () => {
    const p = withRace('full')
    const plan = generatePlan(p)
    const prog = progressionToRace(p, plan.sessions, plan.weeks)
    expect(prog[0].bike).toBeLessThan(50)
    expect(Math.max(...prog.map((x) => x.bike))).toBeGreaterThan(70)
    expect(Math.max(...prog.map((x) => x.run))).toBeGreaterThan(40)
    const ride = plan.sessions.find((s) => s.sport === 'bike' && s.kind === 'long')!
    expect(sessionDistance(ride, p).bikeKm).toBeGreaterThan(30)
  })
})
