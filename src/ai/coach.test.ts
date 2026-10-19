import { describe, expect, it } from 'vitest'
import { applyProposal, weekContext } from './coach'
import { generatePlan } from '../domain/plan'
import { freeSlots, toHHMM, windowsFromLimits } from '../domain/schedule'
import type { Profile } from '../domain/types'

const NO_CONTENT = { titulo: '', blocos: [], distancia: { natacao_m: null, bicicleta_km: null, corrida_km: null } }

const profile: Profile = {
  name: 'R', raceName: 'Ironman', raceDate: '2027-10-16', planStart: '2026-10-19',
  athlete: { goal: 'finish', level: { swim: 'beginner', bike: 'intermediate', run: 'intermediate' }, currentWeeklyHours: 6, longestRideMin: 120, longestRunMin: 70, longestSwimMin: 40, injuries: ['other'], injuryDetails: { other: { when: '2026-08', notes: 'entorse no tornozelo' } }, hasPowerMeter: false, hasHrMonitor: true, hasSmartTrainer: false, poolDays: [0, 1, 2, 3, 4, 5], maxSessionsPerDay: 2, longDay: 5, availableHours: 8 },
  schedule: { windows: windowsFromLimits(390, 1320), commitments: [{ id: 'g-1', title: 'Aula', kind: 'class', date: '2026-10-27', start: 540, end: 1080, source: 'google' }] },
  tests: {},
}

describe('treinador IA', () => {
  const plan = generatePlan(profile)
  const { context, movable, days } = weekContext(profile, plan, [], '2026-10-26', '2026-10-26')

  it('envia o tempo livre, as lesões e só os treinos de triatlo', () => {
    const c = context as { atleta: { lesoes: string[] }; treinos: { modalidade: string }[]; dias: { livre: string[] }[] }
    expect(c.atleta.lesoes[0]).toContain('entorse no tornozelo')
    expect(c.treinos.every((t) => ['swim', 'bike', 'run', 'brick'].includes(t.modalidade))).toBe(true)
    expect(c.dias[1].livre.join(' ')).not.toContain('09:00')
  })

  it('aceita o que cumpre as regras e deixa o resto como estava', () => {
    const a = movable.find((s) => s.date !== '2026-10-27' && s.minutes <= 90)!
    const b = movable.find((s) => s.id !== a.id)!
    const r = applyProposal(plan, profile, movable, days, {
      resumo: 'Semana leve.',
      treinos: [
        { id: a.id, data: a.date, hora: '07:00', minutos: a.minutes * 3, porque: 'manhã livre', ...NO_CONTENT },
        { id: b.id, data: '2026-10-27', hora: '10:00', minutos: b.minutes, porque: 'por cima da aula', ...NO_CONTENT },
      ],
      retirados: [],
    })
    const na = r.plan.sessions.find((s) => s.id === a.id)!
    expect(na).toMatchObject({ date: a.date, start: 420, why: 'manhã livre' })
    expect(na.minutes).toBeLessThanOrEqual(Math.round(a.minutes * 1.1 / 5) * 5)
    expect(r.plan.sessions.find((s) => s.id === b.id)).toEqual(b)
    expect(r.changes.at(-1)).toContain(b.title)
    for (const s of r.plan.sessions.filter((x) => x.date === a.date && !x.skipped && x.kind !== 'fixed')) {
      expect(freeSlots(profile, s.date).some((w) => w.start <= s.start! && w.end >= s.start! + s.minutes)).toBe(true)
    }
  })
})

describe('treinador IA: dois treinos chave', () => {
  it('não junta dois treinos chave no mesmo dia, mesmo que o outro ainda não tenha sido visto', () => {
    const plan = generatePlan(profile)
    const { movable, days } = weekContext(profile, plan, [], '2026-10-26', '2026-10-26')
    const keys = movable.filter((s) => s.key)
    if (keys.length < 2) return
    const [a, b] = keys
    const r = applyProposal(plan, profile, movable, days, {
      resumo: '', retirados: [],
      treinos: [{ id: a.id, data: b.date, hora: '07:00', minutos: a.minutes, porque: 'x', ...NO_CONTENT }],
    })
    expect(r.plan.sessions.find((s) => s.id === a.id)!.date).toBe(a.date)
  })
})

describe('treinador IA: conteúdo dos treinos', () => {
  const plan = generatePlan(profile)
  const { context, movable, days } = weekContext(profile, plan, [], '2026-10-26', '2026-10-26')

  it('envia as distâncias da prova, os ritmos e a evolução', () => {
    const c = context as { prova: { corrida_km: number; semanas_ate_a_prova: number }; ritmos: { natacao: string }; evolucao_rumo_a_prova: unknown[] }
    expect(c.prova.corrida_km).toBe(42.2)
    expect(c.prova.semanas_ate_a_prova).toBeGreaterThan(40)
    expect(c.ritmos.natacao).toContain('/100 m')
    expect(c.evolucao_rumo_a_prova.length).toBeGreaterThan(1)
  })

  it('usa os blocos da IA quando fazem sentido e recusa intensidade num treino fácil', () => {
    const swim = movable.find((s) => s.sport === 'swim' && s.kind === 'intervals')!
    const easy = movable.find((s) => s.kind === 'endurance' && s.sport === 'run')!
    const r = applyProposal(plan, profile, movable, days, {
      resumo: '', retirados: [],
      treinos: [
        { id: swim.id, data: swim.date, hora: toHHMM(swim.start!), minutos: swim.minutes, porque: 'mais uma série que na semana passada',
          titulo: 'Natação: 6 × 100 m', distancia: { natacao_m: 1800, bicicleta_km: null, corrida_km: null },
          blocos: [
            { descricao: '300 m soltos', minutos: swim.minutes * 0.25, zona: 1 },
            { descricao: '6 × 100 m a 2:20/100 m, 20 s de pausa', minutos: swim.minutes * 0.5, zona: 4 },
            { descricao: '200 m soltos', minutos: swim.minutes * 0.25, zona: 1 },
          ] },
        { id: easy.id, data: easy.date, hora: toHHMM(easy.start!), minutos: easy.minutes, porque: 'x', titulo: 'Corrida a fundo', distancia: { natacao_m: null, bicicleta_km: null, corrida_km: 8 },
          blocos: [{ descricao: 'tudo a fundo', minutos: easy.minutes, zona: 5 }] },
      ],
    })
    const ns = r.plan.sessions.find((s) => s.id === swim.id)!
    expect(ns.title).toBe('Natação: 6 × 100 m')
    expect(ns.steps[1].label).toContain('6 × 100 m')
    expect(ns.steps.reduce((a, x) => a + x.minutes, 0)).toBeCloseTo(swim.minutes, 0)
    const ne = r.plan.sessions.find((s) => s.id === easy.id)!
    expect(ne.title).toBe(easy.title)
    expect(ne.steps.some((x) => x.label === 'tudo a fundo')).toBe(false)
  })
})
