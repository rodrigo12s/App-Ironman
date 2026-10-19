import { describe, expect, it } from 'vitest'
import { FitBaseType, FitEncoder } from 'fit-file-parser'
import { generatePlan } from './plan'
import { setDayAvailability, skipSession } from './adapt'
import { loadAlerts, loadSeries } from './load'
import { matchSessions } from './compliance'
import { parseFit } from './fit'
import { cssPer100, ftp, paceZones, powerZones } from './zones'
import type { Activity, Profile, Session } from './types'
import { freeSlots } from './schedule'
import { addDaysIso, weekdayOf } from './dates'
import { parseIcs } from './ics'

const profile: Profile = {
  name: 'Rodrigo',
  raceName: 'Ironman Cascais',
  raceDate: '2027-10-16',
  planStart: '2026-10-19',
  athlete: {
    goal: 'finish',
    level: { swim: 'beginner', bike: 'intermediate', run: 'intermediate' },
    currentWeeklyHours: 6,
    longestRideMin: 120,
    longestRunMin: 70,
    longestSwimMin: 40,
    injuries: [],
    hasPowerMeter: true,
    hasHrMonitor: true,
    hasSmartTrainer: false,
    poolDays: [0, 1, 2, 3, 4, 5],
    maxSessionsPerDay: 2,
    longDay: 5,
  },
  schedule: {
    windows: [
      [{ start: 390, end: 480 }, { start: 1080, end: 1260 }],
      [{ start: 390, end: 480 }, { start: 1080, end: 1260 }],
      [{ start: 390, end: 480 }, { start: 1080, end: 1260 }],
      [{ start: 390, end: 480 }, { start: 1080, end: 1260 }],
      [{ start: 390, end: 480 }, { start: 1080, end: 1260 }],
      [{ start: 480, end: 840 }],
      [{ start: 480, end: 720 }],
    ],
    commitments: [
      { id: 'fut', title: 'Treino de futebol', kind: 'football', weekday: 2, start: 1140, end: 1260, source: 'manual' },
      { id: 'gym', title: 'Ginásio', kind: 'gym', weekday: 0, start: 1080, end: 1140, source: 'manual' },
      { id: 'aula', title: 'Aula de Cálculo', kind: 'class', weekday: 3, start: 1080, end: 1200, source: 'manual' },
    ],
  },
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
  it('marca as sessões dentro das janelas livres, sem chocar com aulas, ginásio ou futebol', () => {
    for (const s of plan.sessions.filter((x) => x.kind !== 'race' && x.kind !== 'fixed')) {
      const free = freeSlots(profile, s.date)
      expect(free.some((w) => s.start! >= w.start && s.start! + s.minutes <= w.end), `${s.date} ${s.title}`).toBe(true)
    }
    const sameDay = new Map<string, Session[]>()
    for (const s of plan.sessions.filter((x) => x.kind !== 'fixed')) sameDay.set(s.date, [...(sameDay.get(s.date) ?? []), s])
    for (const list of sameDay.values()) {
      const sorted = [...list].sort((a, b) => a.start! - b.start!)
      for (let i = 1; i < sorted.length; i++) expect(sorted[i].start!).toBeGreaterThanOrEqual(sorted[i - 1].start! + sorted[i - 1].minutes)
    }
  })
  it('inclui o futebol e o ginásio e evita corrida no dia do futebol e corrida dura no dia seguinte', () => {
    const football = plan.sessions.filter((s) => s.sport === 'football')
    expect(football.length).toBeGreaterThan(40)
    for (const f of football) {
      expect(plan.sessions.some((s) => s.date === f.date && (s.sport === 'run' || s.sport === 'brick'))).toBe(false)
      const next = addDaysIso(f.date, 1)
      expect(plan.sessions.some((s) => s.date === next && s.sport === 'run' && ['long', 'tempo', 'test'].includes(s.kind))).toBe(false)
    }
    expect(plan.sessions.some((s) => s.kind === 'fixed' && s.sport === 'strength')).toBe(true)
  })
  it('só põe natação nos dias com piscina', () => {
    expect(plan.sessions.filter((s) => s.sport === 'swim').every((s) => weekdayOf(s.date) !== 6)).toBe(true)
  })
  it('põe a bicicleta longa no dia preferido e começa perto do volume atual', () => {
    const longs = plan.sessions.filter((s) => s.kind === 'long' && s.sport === 'bike')
    expect(longs.filter((s) => weekdayOf(s.date) === 5).length / longs.length).toBeGreaterThan(0.8)
    expect(plan.weeks[1].targetMinutes).toBeLessThanOrEqual(6 * 60 * 1.2)
    const firstLong = longs[0]
    expect(firstLong.minutes).toBeLessThanOrEqual(135)
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
    const minor = plan.sessions.find((s) => !s.key && s.kind !== 'fixed')!
    const { plan: next } = skipSession(plan, profile, minor.id, minor.date)
    expect(next.sessions.filter((s) => s.movedFrom)).toHaveLength(0)
  })
  it('ajusta um dia com menos tempo', () => {
    const day = plan.sessions.find((s) => s.minutes >= 60 && s.kind !== 'race' && s.kind !== 'fixed')!
    const { plan: next } = setDayAvailability(plan, profile, day.date, 30, day.date)
    const left = next.sessions.filter((s) => s.date === day.date && !s.skipped && s.kind !== 'fixed').reduce((a, s) => a + s.minutes, 0)
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

describe('calendário da universidade (.ics)', () => {
  const ics = [
    'BEGIN:VCALENDAR', 'VERSION:2.0',
    'BEGIN:VEVENT', 'SUMMARY:Análise Matemática I - T', 'DTSTART:20260921T090000', 'DTEND:20260921T110000',
    'RRULE:FREQ=WEEKLY;BYDAY=MO,WE;UNTIL=20261218T235959Z', 'EXDATE:20261208T090000', 'END:VEVENT',
    'BEGIN:VEVENT', 'SUMMARY:Exame de Física', 'DTSTART:20270115T140000', 'DTEND:20270115T170000', 'END:VEVENT',
    'BEGIN:VEVENT', 'SUMMARY:Feriado', 'DTSTART;VALUE=DATE:20261201', 'END:VEVENT',
    ...['20261020', '20261027', '20261103', '20261110'].flatMap((d) => ['BEGIN:VEVENT', 'SUMMARY:Programação PL', `DTSTART:${d}T140000`, `DTEND:${d}T160000`, 'END:VEVENT']),
    'END:VCALENDAR',
  ].join('\r\n')
  const list = parseIcs(ics, '2026-10-19', '2027-10-16')
  it('lê aulas semanais, exames e ignora dias inteiros', () => {
    const am = list.filter((c) => c.title.startsWith('Análise'))
    expect(am.map((c) => c.weekday).sort()).toEqual([0, 2])
    expect(am[0]).toMatchObject({ start: 540, end: 660, until: '2026-12-18', kind: 'class' })
    expect(list.find((c) => c.title === 'Exame de Física')).toMatchObject({ date: '2027-01-15', start: 840 })
    expect(list.some((c) => c.title === 'Feriado')).toBe(false)
  })
  it('junta aulas soltas repetidas num compromisso semanal', () => {
    const pl = list.filter((c) => c.title === 'Programação PL')
    expect(pl).toHaveLength(1)
    expect(pl[0].weekday).toBe(1)
  })
  it('tira as aulas às janelas de treino', () => {
    const p2 = { ...profile, schedule: { ...profile.schedule, commitments: [...profile.schedule.commitments, ...list] } }
    // Segunda 26/10: janela da manhã 06:30-08:00 não choca com 09:00-11:00
    expect(freeSlots(p2, '2026-10-26').map((w) => w.start)).toContain(390)
    // Exame 15/01 às 14:00: a janela 18:00-21:00 mantém-se
    expect(freeSlots(p2, '2027-01-15').some((w) => w.start === 1080)).toBe(true)
  })
})
