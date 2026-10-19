import { describe, expect, it } from 'vitest'
import { suggestWindows } from './suggest'
import { defaultAthlete } from '../ui/ProfileView'
import type { Commitment } from './types'

const aula = (weekday: 0 | 1 | 2 | 3 | 4, start: number, end: number): Commitment => ({ id: `a${weekday}${start}`, title: 'Aula', kind: 'class', weekday, start, end, source: 'manual' })

describe('sugerir horários', () => {
  const commitments = [0, 1, 2, 3, 4].flatMap((d) => [aula(d as 0, 9 * 60, 13 * 60), aula(d as 0, 14 * 60, 18 * 60)])
  const profile = { planStart: '2026-10-19', athlete: { ...defaultAthlete(), longDay: 5 as const }, schedule: { windows: [], commitments } }

  it('usa as horas pedidas, sem chocar com aulas, e deixa um dia de descanso', () => {
    const w = suggestWindows(profile, 10)
    const total = w.flat().reduce((a, x) => a + x.end - x.start, 0)
    expect(total).toBeGreaterThanOrEqual(9 * 60)
    expect(total).toBeLessThanOrEqual(10 * 60 + 15)
    for (let d = 0; d < 5; d++) for (const x of w[d]) {
      // aulas das 9h às 13h e das 14h às 18h, com 15 min de margem
      expect(x.end <= 8 * 60 + 45 || x.start >= 18 * 60 + 15).toBe(true)
    }
    const longest = (d: number) => w[d].reduce((a, x) => Math.max(a, x.end - x.start), 0)
    expect(longest(5)).toBeGreaterThanOrEqual(240)
    expect(w.filter((d) => d.length === 0).length).toBeGreaterThanOrEqual(1)
  })

  it('com poucas horas, o fim de semana fica com os treinos longos', () => {
    const w = suggestWindows(profile, 5)
    expect(w[5].reduce((a, x) => a + x.end - x.start, 0)).toBeGreaterThanOrEqual(120)
    expect(w[6].reduce((a, x) => a + x.end - x.start, 0)).toBeGreaterThanOrEqual(60)
  })
})
