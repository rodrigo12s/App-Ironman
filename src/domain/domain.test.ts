import { describe, expect, it } from 'vitest'
import { FitBaseType, FitEncoder } from 'fit-file-parser'
import { generatePlan } from './plan'
import { setDayAvailability, skipSession } from './adapt'
import { loadAlerts, loadSeries } from './load'
import { matchSessions } from './compliance'
import { parseFit } from './fit'
import { cssPer100, ftp, paceZones, powerZones } from './zones'
import type { Activity, Profile } from './types'

const profile: Profile = {
  name: 'Rodrigo',
  raceName: 'Ironman Cascais',
  raceDate: '2027-10-16',
  planStart: '2026-10-19',
  availability: [60, 90, 75, 90, 45, 330, 180],
  tests: { swim400Sec: 400, swim200Sec: 190, bike20minWatts: 240, run30minPaceSecPerKm: 285, bikeLthr: 160, runLthr: 168 },
}

describe('zonas', () => {
  it('calcula CSS, FTP e zonas', () => {
    expect(cssPer100(profile.tests)).toBe(105)
    expect(ftp(profile.tests)).toBe(228)
    expect(powerZones(228)[1]).toMatchObject({ low: 125, high: 170 })
    const run = paceZones(285, 'run')
    expect(run[3].low).toBeLessThan(run[3].high!)
  })
})

describe('plano', () => {
  const plan = generatePlan(profile)
  it('vai até à prova com as fases na ordem certa', () => {
    expect(plan.weeks[0].phase).toBe('base')
    expect(plan.weeks.at(-1)!.phase).toBe('race')
    expect(plan.sessions.at(-1)!.kind).toBe('race')
    const order = ['base', 'build', 'peak', 'taper', 'race']
    const idx = plan.weeks.map((w) => order.indexOf(w.phase))
    expect([...idx].sort((a, b) => a - b)).toEqual(idx)
  })
  it('respeita o tempo disponível de cada dia', () => {
    const byDay = new Map<string, number>()
    for (const s of plan.sessions) if (s.kind !== 'race') byDay.set(s.date, (byDay.get(s.date) ?? 0) + s.minutes)
    for (const [d, m] of byDay) {
      const wd = (new Date(d + 'T12:00:00').getDay() + 6) % 7
      expect(m, d).toBeLessThanOrEqual(Math.max(30, profile.availability[wd]))
    }
  })
  it('tem semanas de descarga e taper com menos volume', () => {
    expect(plan.weeks.some((w) => w.recovery)).toBe(true)
    const peak = Math.max(...plan.weeks.filter((w) => w.phase === 'peak').map((w) => w.targetMinutes))
    const taper = plan.weeks.filter((w) => w.phase === 'taper').map((w) => w.targetMinutes)
    taper.forEach((t) => expect(t).toBeLessThan(peak))
  })
  it('limita a corrida longa e a bicicleta longa', () => {
    expect(Math.max(...plan.sessions.filter((s) => s.sport === 'run').map((s) => s.minutes))).toBeLessThanOrEqual(150)
    expect(Math.max(...plan.sessions.filter((s) => s.sport === 'bike').map((s) => s.minutes))).toBeLessThanOrEqual(360)
  })
})

describe('reorganização', () => {
  const plan = generatePlan(profile)
  it('move uma sessão-chave falhada para outro dia da semana', () => {
    const week = plan.sessions.filter((s) => s.date >= '2026-10-26' && s.date <= '2026-11-01')
    const key = week.find((s) => s.key && s.date < '2026-10-31')
    if (!key) return
    const { plan: next, changes } = skipSession(plan, profile, key.id, key.date)
    expect(next.sessions.find((s) => s.id === key.id)!.skipped).toBe(true)
    const moved = next.sessions.find((s) => s.movedFrom === key.date && s.title === key.title)
    expect(changes.length).toBeGreaterThan(0)
    if (moved) expect(moved.date > key.date).toBe(true)
  })
  it('não compensa sessões secundárias', () => {
    const minor = plan.sessions.find((s) => !s.key)!
    const { plan: next } = skipSession(plan, profile, minor.id, minor.date)
    expect(next.sessions.filter((s) => s.movedFrom)).toHaveLength(0)
  })
  it('ajusta um dia com menos tempo', () => {
    const day = plan.sessions.find((s) => s.minutes >= 60 && s.kind !== 'race')!
    const { plan: next } = setDayAvailability(plan, profile, day.date, 30, day.date)
    const left = next.sessions.filter((s) => s.date === day.date && !s.skipped).reduce((a, s) => a + s.minutes, 0)
    expect(left).toBeLessThanOrEqual(30)
  })
})

const act = (date: string, sport: Activity['sport'], min: number, tss: number): Activity => ({
  id: `${date}-${sport}`, date, startTime: date + 'T08:00:00Z', sport, durationSec: min * 60, tss, tssMethod: 'estimate', source: 'manual',
})

describe('carga e cumprimento', () => {
  it('calcula CTL/ATL/TSB e alerta subidas bruscas', () => {
    const acts: Activity[] = []
    for (let i = 0; i < 28; i++) acts.push(act(`2026-09-${String(i + 1).padStart(2, '0')}`, 'bike', 60, i < 21 ? 30 : 200))
    const series = loadSeries(acts, null, '2026-09-01', '2026-09-28', '2026-09-28')
    const last = series.at(-1)!
    expect(last.atl).toBeGreaterThan(last.ctl)
    expect(loadAlerts(series, acts, '2026-09-28').some((a) => a.title.includes('depressa'))).toBe(true)
  })
  it('associa atividades às sessões', () => {
    const plan = generatePlan(profile)
    const s = plan.sessions.find((x) => x.sport === 'run')!
    const { matches } = matchSessions([s], [act(s.date, 'run', s.minutes, 50)], s.date)
    expect(matches[0].status).toBe('done')
  })
})

describe('ficheiros .FIT', () => {
  it('lê uma corrida', async () => {
    const enc = new FitEncoder()
    const ts = FitEncoder.toFitTimestamp(new Date('2026-10-20T07:00:00Z'))
    enc.writeMessage(0, [
      { number: 0, size: 1, baseType: FitBaseType.Enum, value: 4 },
      { number: 4, size: 4, baseType: FitBaseType.Uint32, value: ts },
    ])
    // session: start_time(2), sport(5), total_timer_time(8, s*1000), total_distance(9, m*100), avg_heart_rate(16), avg_speed(14, m/s*1000)
    enc.writeMessage(18, [
      { number: 253, size: 4, baseType: FitBaseType.Uint32, value: ts + 3600 },
      { number: 2, size: 4, baseType: FitBaseType.Uint32, value: ts },
      { number: 5, size: 1, baseType: FitBaseType.Enum, value: 1 },
      { number: 7, size: 4, baseType: FitBaseType.Uint32, value: 3600 * 1000 },
      { number: 8, size: 4, baseType: FitBaseType.Uint32, value: 3600 * 1000 },
      { number: 9, size: 4, baseType: FitBaseType.Uint32, value: 12000 * 100 },
      { number: 14, size: 2, baseType: FitBaseType.Uint16, value: 3333 },
      { number: 16, size: 1, baseType: FitBaseType.Uint8, value: 150 },
    ])
    const bytes = enc.close()
    const [a] = await parseFit(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, profile, 'corrida.fit')
    expect(a.sport).toBe('run')
    expect(a.durationSec).toBe(3600)
    expect(a.distanceM).toBe(12000)
    expect(a.date).toBe('2026-10-20')
    expect(a.tssMethod).toBe('pace')
    expect(a.tss).toBeGreaterThan(40)
  })
})
