import { afterEach, describe, expect, it, vi } from 'vitest'
import { applyEdits, diffEvents, eventsToCommitments, sessionToEvent, syncTrainings, type GEvent } from './gcal'
import { reflowConflicts, syncFixed } from '../domain/adapt'
import { generatePlan } from '../domain/plan'
import { freeSlots, windowsFromLimits } from '../domain/schedule'
import { addDaysIso, weekdayOf } from '../domain/dates'
import type { Commitment, Profile, Session } from '../domain/types'

const ev = (id: string, start: string, end: string, extra: Partial<GEvent> = {}): GEvent => ({ id, summary: 'Aula de Cálculo', start: { dateTime: start }, end: { dateTime: end }, ...extra })

describe('importar eventos do Google', () => {
  it('lê todos os eventos, um a um, menos os cancelados e os recusados', () => {
    const list = eventsToCommitments([
      ev('a', '2026-10-21T09:30:00+01:00', '2026-10-21T11:00:00+01:00'),
      { id: 'b', summary: 'Feriado', start: { date: '2026-10-22' }, end: { date: '2026-10-23' } },
      ev('c', '2026-10-22T10:00:00+01:00', '2026-10-22T11:00:00+01:00', { status: 'cancelled' }),
      ev('d', '2026-10-22T12:00:00+01:00', '2026-10-22T13:00:00+01:00', { transparency: 'transparent' }),
      ev('e', '2026-10-22T14:00:00+01:00', '2026-10-22T15:00:00+01:00', { attendees: [{ self: true, responseStatus: 'declined' }] }),
      ev('f', '2026-10-23T19:00:00+01:00', '2026-10-23T20:30:00+01:00', { summary: 'Treino futebol' }),
    ])
    expect(list).toHaveLength(4)
    expect(list[0]).toMatchObject({ id: 'g-a', date: '2026-10-21', start: 570, end: 660, kind: 'class', source: 'google' })
    // Dia inteiro entra, mas marcado como tal (não ocupa horas sem o dizeres)
    expect(list[1]).toMatchObject({ id: 'g-b', date: '2026-10-22', allDay: true })
    // Marcado como "disponível" continua a contar: muitos horários da universidade vêm assim
    expect(list[2]).toMatchObject({ id: 'g-d', start: 720 })
    expect(list[3].kind).toBe('football')
  })

  it('um evento de vários dias ocupa cada dia', () => {
    const list = eventsToCommitments([ev('t', '2026-10-23T18:00:00+01:00', '2026-10-25T20:00:00+00:00', { summary: 'Viagem' })])
    expect(list.map((c) => [c.date, c.start, c.end])).toEqual([['2026-10-23', 1080, 1440], ['2026-10-24', 0, 1440], ['2026-10-25', 0, 1200]])
  })

  it('não junta aulas repetidas: cada semana fica com as suas, e o tipo escolhido à mão mantém-se', () => {
    const weeks = [0, 7, 14, 21].map((d) => addDaysIso('2026-10-20', d))
    const list = eventsToCommitments(weeks.map((d, i) => ev(`x${i}`, `${d}T14:00:00+00:00`, `${d}T16:00:00+00:00`)), new Map([['Aula de Cálculo', 'work']]))
    expect(list.map((c) => c.date)).toEqual(weeks)
    expect(list.every((c) => c.kind === 'work' && c.weekday === undefined)).toBe(true)
  })

  it('as mudanças feitas na app mantêm-se depois de sincronizar', () => {
    const list = eventsToCommitments([ev('a', '2026-10-21T09:00:00+01:00', '2026-10-21T10:00:00+01:00'), ev('b', '2026-10-22T09:00:00+01:00', '2026-10-22T10:00:00+01:00')])
    const out = applyEdits(list, { 'g-a': { deleted: true }, 'g-b': { start: 600, end: 660, kind: 'other' } })
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ id: 'g-b', start: 600, end: 660, kind: 'other' })
  })
})

const session = (id: string, date: string, start: number, minutes = 60): Session => ({
  id, date, start, minutes, sport: 'run', kind: 'endurance', title: 'Corrida fácil', key: false, plannedTss: 50,
  steps: [{ label: 'Corrida fácil', minutes, zone: 2 }],
})

describe('escrever treinos no Google', () => {
  it('cria o evento com a hora, a duração e as zonas', () => {
    const b = sessionToEvent(session('s1', '2026-10-21', 18 * 60 + 30, 75), 'Europe/Lisbon')
    expect(b.summary).toBe('🏃 Corrida fácil')
    expect(b.start).toEqual({ dateTime: '2026-10-21T18:30:00', timeZone: 'Europe/Lisbon' })
    expect(b.end.dateTime).toBe('2026-10-21T19:45:00')
    expect(b.description).toContain('75 min Corrida fácil (Z2)')
    expect(b.extendedProperties.private.ironmanId).toBe('s1')
  })

  it('só cria, altera e apaga o que mudou, e não mexe em eventos criados à mão', () => {
    const keep = sessionToEvent(session('s1', '2026-10-21', 600), 'Europe/Lisbon')
    const moved = sessionToEvent(session('s2', '2026-10-22', 600), 'Europe/Lisbon')
    const fresh = sessionToEvent(session('s3', '2026-10-23', 600), 'Europe/Lisbon')
    const asGoogle = (id: string, b: typeof keep, dt = b.start.dateTime): GEvent => ({
      id, summary: b.summary, description: b.description, colorId: b.colorId,
      start: { dateTime: dt + '+01:00' }, end: { dateTime: b.end.dateTime + '+01:00' }, extendedProperties: b.extendedProperties,
    })
    const existing: GEvent[] = [
      asGoogle('e1', keep),
      asGoogle('e2', moved, '2026-10-22T08:00:00'),
      asGoogle('e3', sessionToEvent(session('gone', '2026-10-24', 600), 'Europe/Lisbon')),
      asGoogle('e4', keep), // duplicado
      { id: 'mine', summary: 'Jantar', start: { dateTime: '2026-10-21T20:00:00+01:00' }, end: { dateTime: '2026-10-21T21:00:00+01:00' } },
    ]
    const d = diffEvents(existing, [keep, moved, fresh])
    expect(d.create.map((b) => b.extendedProperties.private.ironmanId)).toEqual(['s3'])
    expect(d.update.map((u) => u.eventId)).toEqual(['e2'])
    expect(d.remove.sort()).toEqual(['e3', 'e4'])
  })

  afterEach(() => vi.unstubAllGlobals())

  it('envia os pedidos à API do Google Calendar', async () => {
    const calls: { method: string; url: string }[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit = {}) => {
      calls.push({ method: init.method ?? 'GET', url })
      if ((init.method ?? 'GET') === 'GET') return new Response(JSON.stringify({ items: [] }), { status: 200 })
      return new Response(JSON.stringify({ id: 'new' }), { status: 200 })
    }))
    const r = await syncTrainings('tok', 'cal@group', [session('s1', '2026-10-21', 600), { ...session('s2', '2026-10-22', 600), skipped: true }, { ...session('s3', '2026-10-22', 600), kind: 'fixed' }], '2026-10-20', '2027-10-16')
    expect(r).toEqual({ created: 1, updated: 0, removed: 0 })
    expect(calls[0].url).toContain('/calendars/cal%40group/events?timeMin=')
    expect(calls[1]).toMatchObject({ method: 'POST' })
  })
})

describe('ajustar o plano a eventos novos', () => {
  const base: Profile = {
    name: 'R', raceName: 'Ironman', raceDate: '2027-10-16', planStart: '2026-10-19',
    athlete: { goal: 'finish', level: { swim: 'beginner', bike: 'intermediate', run: 'intermediate' }, currentWeeklyHours: 6, longestRideMin: 120, longestRunMin: 70, longestSwimMin: 40, injuries: [], hasPowerMeter: false, hasHrMonitor: true, hasSmartTrainer: false, poolDays: [0, 1, 2, 3, 4, 5], maxSessionsPerDay: 2, longDay: 5 },
    schedule: { windows: Array.from({ length: 7 }, (_, i) => (i < 5 ? [{ start: 360, end: 480 }, { start: 1080, end: 1290 }] : [{ start: 480, end: 1200 }])), commitments: [] },
    tests: {},
  }

  it('mexe só nos treinos que ficaram por cima de um evento', () => {
    const plan = generatePlan(base)
    const target = plan.sessions.find((s) => s.date > '2026-10-20' && s.kind !== 'fixed' && s.start !== undefined)!
    const other = plan.sessions.filter((s) => s.date !== target.date && s.kind !== 'fixed')
    const profile: Profile = { ...base, schedule: { ...base.schedule, commitments: [{ id: 'g-1', title: 'Exame', kind: 'class', date: target.date, start: target.start!, end: target.start! + 30, source: 'google' }] } }
    const r = reflowConflicts(plan, profile, '2026-10-19')
    expect(r.changes.length).toBeGreaterThan(0)
    const now = r.plan.sessions.filter((s) => s.date === target.date && !s.skipped && s.kind !== 'fixed')
    const slots = freeSlots(profile, target.date)
    for (const s of now) expect(slots.some((w) => w.start <= s.start! && w.end >= s.start! + s.minutes)).toBe(true)
    // Os outros dias ficam iguais
    for (const s of other.slice(0, 20)) expect(r.plan.sessions.find((x) => x.id === s.id)).toEqual(s)
  })

  it('não muda nada quando não há conflitos', () => {
    const plan = generatePlan(base)
    expect(reflowConflicts(plan, base, '2026-10-19').changes).toEqual([])
  })
})

describe('semanas todas diferentes', () => {
  const free: Profile = {
    name: 'R', raceName: 'Ironman', raceDate: '2027-10-16', planStart: '2026-10-19',
    athlete: { goal: 'finish', level: { swim: 'beginner', bike: 'intermediate', run: 'intermediate' }, currentWeeklyHours: 6, longestRideMin: 120, longestRunMin: 70, longestSwimMin: 40, injuries: [], hasPowerMeter: false, hasHrMonitor: true, hasSmartTrainer: false, poolDays: [0, 1, 2, 3, 4, 5], maxSessionsPerDay: 2, longDay: 5, availableHours: 8, dayStart: 390, dayEnd: 1320, preferredTime: 'evening' },
    schedule: { windows: windowsFromLimits(390, 1320), commitments: [] },
    tests: {},
  }

  it('treina nos buracos entre eventos diferentes em cada semana, ao fim do dia', () => {
    const commitments = eventsToCommitments([
      ev('a', '2026-10-27T09:00:00+00:00', '2026-10-27T19:00:00+00:00'),
      ev('b', '2026-11-03T14:00:00+00:00', '2026-11-03T16:00:00+00:00'),
    ])
    const profile = { ...free, schedule: { ...free.schedule, commitments } }
    const plan = generatePlan(profile)
    for (const date of ['2026-10-27', '2026-11-03']) {
      const slots = freeSlots(profile, date)
      for (const s of plan.sessions.filter((x) => x.date === date && x.kind !== 'fixed')) {
        expect(slots.some((w) => w.start <= s.start! && w.end >= s.start! + s.minutes)).toBe(true)
      }
    }
    const weekday = plan.sessions.filter((s) => s.kind !== 'fixed' && s.kind !== 'long' && weekdayOf(s.date) < 5 && s.date < '2026-12-01')
    expect(weekday.filter((s) => s.start! >= 17 * 60).length / weekday.length).toBeGreaterThan(0.6)
    // Nunca passa das horas por semana que disseste
    for (const w of plan.weeks) expect(w.targetMinutes).toBeLessThanOrEqual(8 * 60)
  })

  it('um evento de dia inteiro só tira treinos quando o marcas assim', () => {
    const [c] = eventsToCommitments([{ id: 'v', summary: 'Viagem', start: { date: '2026-10-28' }, end: { date: '2026-10-29' } }])
    expect(freeSlots({ ...free, schedule: { ...free.schedule, commitments: [c] } }, '2026-10-28').length).toBeGreaterThan(0)
    expect(freeSlots({ ...free, schedule: { ...free.schedule, commitments: [{ ...c, blocksDay: true }] } }, '2026-10-28')).toEqual([])
  })

  it('o futebol do plano acompanha o evento quando mudas a hora', () => {
    const fb: Commitment = { id: 'g-f', title: 'Futebol', kind: 'football', date: '2026-10-28', start: 1140, end: 1230, source: 'google' }
    const profile = { ...free, schedule: { ...free.schedule, commitments: [fb] } }
    const plan = generatePlan(profile)
    expect(plan.sessions.find((s) => s.commitmentId === 'g-f')?.start).toBe(1140)
    const moved = { ...profile, schedule: { ...profile.schedule, commitments: [{ ...fb, start: 1200, end: 1290 }] } }
    expect(syncFixed(plan, moved, '2026-10-19').sessions.find((s) => s.commitmentId === 'g-f')?.start).toBe(1200)
  })
})
