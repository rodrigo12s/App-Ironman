import Anthropic from '@anthropic-ai/sdk'
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod'
import { z } from 'zod'
import { addDaysIso, weekdayOf } from '../domain/dates'
import { loadSeries } from '../domain/load'
import { allowedOn, estimateTss } from '../domain/plan'
import { freeSlots, fromHHMM, subtract, toHHMM } from '../domain/schedule'
import type { Activity, Plan, Profile, Session } from '../domain/types'
import { isTriathlon } from './key'

const MODEL = 'claude-opus-5-5'
const WEEKDAY = ['segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado', 'domingo']

/** Tudo o que o treinador precisa de saber sobre a semana, em texto simples */
export function weekContext(profile: Profile, plan: Plan, activities: Activity[], monday: string, today: string) {
  const days = Array.from({ length: 7 }, (_, i) => addDaysIso(monday, i)).filter((d) => d >= today && d < profile.raceDate)
  const week = plan.weeks.find((w) => w.start === monday)
  const movable = plan.sessions.filter((s) => days.includes(s.date) && !s.skipped && isTriathlon(s) && s.kind !== 'race')
  const fixed = plan.sessions.filter((s) => days.includes(s.date) && !s.skipped && s.kind === 'fixed')
  const series = loadSeries(activities, plan, addDaysIso(today, -60), today, today)
  const now = series.at(-1)
  const a = profile.athlete
  const injuries = a.injuries.map((i) => {
    const d = a.injuryDetails?.[i]
    return `${i}${d?.when ? ` (${d.when})` : ''}${d?.notes ? `: ${d.notes}` : ''}`
  })
  const lastWeek = plan.sessions.filter((s) => s.date >= addDaysIso(monday, -7) && s.date < monday && isTriathlon(s))
  const done = new Set(activities.filter((x) => x.date >= addDaysIso(monday, -7) && x.date < monday).map((x) => `${x.date}|${x.sport}`))
  const missed = lastWeek.filter((s) => !s.skipped && !done.has(`${s.date}|${s.sport}`) && !(s.sport === 'brick' && done.has(`${s.date}|bike`)))

  const context = {
    hoje: today,
    prova: { nome: profile.raceName, data: profile.raceDate },
    semana: week && { fase: week.phase, descarga: week.recovery, minutos_alvo: week.targetMinutes },
    atleta: {
      idade: a.age, objetivo: a.goal === 'time' ? `tempo de ${a.targetHours} h` : 'terminar',
      nivel: a.level, horas_por_semana: a.availableHours, lesoes: injuries,
      prefere: a.preferredTime === 'morning' ? 'manhã' : 'fim do dia',
      dias_piscina: a.poolDays.map((d) => WEEKDAY[d]), treinos_por_dia_max: a.maxSessionsPerDay,
      dia_treino_longo_bicicleta: WEEKDAY[a.longDay],
    },
    carga: now && { forma_ctl: Math.round(now.ctl), fadiga_atl: Math.round(now.atl), frescura_tsb: Math.round(now.tsb) },
    falhados_semana_passada: missed.map((s) => `${s.title} (${s.date})`),
    dias: days.map((d) => ({
      data: d,
      dia: WEEKDAY[weekdayOf(d)],
      livre: freeSlots(profile, d, plan.dayOverrides[d]).map((w) => `${toHHMM(w.start)}-${toHHMM(w.end)}`),
      fixos: fixed.filter((s) => s.date === d).map((s) => `${s.title} ${toHHMM(s.start ?? 0)} ${s.minutes} min`),
    })),
    treinos: movable.map((s) => ({
      id: s.id, modalidade: s.sport, tipo: s.kind, titulo: s.title, chave: s.key, minutos: s.minutes,
      data_atual: s.date, hora_atual: s.start !== undefined ? toHHMM(s.start) : null,
      blocos: s.steps.map((x) => `${x.minutes} min ${x.label} Z${x.zone}`).join('; '),
    })),
  }
  return { context, movable, days }
}

const Proposal = z.object({
  resumo: z.string().describe('2 a 4 frases para o atleta: a ideia da semana e porquê'),
  treinos: z.array(z.object({
    id: z.string(),
    data: z.string().describe('yyyy-MM-dd'),
    hora: z.string().describe('HH:MM'),
    minutos: z.number(),
    porque: z.string().describe('uma frase curta sobre o porquê deste dia e hora'),
  })),
  retirados: z.array(z.object({ id: z.string(), porque: z.string() })),
})
export type AiProposal = z.infer<typeof Proposal>

const SYSTEM = `És um treinador de triatlo experiente a preparar um atleta para o primeiro Ironman. Escreves em português de Portugal, de forma simples e direta.

Recebes uma semana de treinos já calculada por regras de periodização (volume, fases, semanas de descarga) e o tempo livre real do atleta, dia a dia, entre aulas e outros eventos. O teu trabalho é distribuir estes treinos de triatlo pela semana da forma mais eficiente e inteligente:
- Põe cada treino num dia e hora dentro do tempo livre ("livre"), sem chocar com os treinos fixos (ginásio, futebol).
- Separa os treinos chave (intervalos, tempo, longos) com pelo menos um dia mais leve entre eles, e deixa pelo menos um dia de descanso.
- Evita corrida dura no dia a seguir ao futebol e treinos intensos logo depois do ginásio de pernas.
- Natação só nos dias com piscina. Respeita o máximo de treinos por dia.
- Tem em conta as lesões descritas: se uma lesão for recente ou na perna, reduz o impacto (menos corrida seguida, mais bicicleta) e explica.
- Se houver fadiga alta (frescura muito negativa) ou treinos falhados, podes encurtar ou retirar treinos secundários. Nunca acrescentes volume: a duração de cada treino pode variar entre 80% e 110% da original.
- Prefere a hora que o atleta indicou (manhã ou fim do dia). Ao fim de semana, os treinos longos começam de manhã.
Usa só os ids e as datas que recebes. Todos os treinos que não retirares têm de aparecer em "treinos".`

export class CoachError extends Error {}

/** Pede ao Claude uma distribuição da semana. A chave é a do atleta e fica no browser dele. */
export async function askCoach(key: string, context: unknown): Promise<AiProposal> {
  const client = new Anthropic({ apiKey: key, dangerouslyAllowBrowser: true })
  try {
    const res = await client.beta.messages.parse({
      model: MODEL,
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'medium', format: betaZodOutputFormat(Proposal) },
      system: SYSTEM,
      messages: [{ role: 'user', content: `Distribui os treinos desta semana.\n\n${JSON.stringify(context, null, 2)}` }],
    })
    if (res.stop_reason === 'refusal') throw new CoachError('O treinador não conseguiu responder a este pedido. Tenta de novo mais tarde.')
    if (res.stop_reason === 'max_tokens' || !res.parsed_output) throw new CoachError('A resposta do treinador veio incompleta. Tenta de novo.')
    return res.parsed_output
  } catch (e) {
    if (e instanceof CoachError) throw e
    if (e instanceof Anthropic.AuthenticationError) throw new CoachError('A chave não é válida. Confirma-a em Mais, Treinador IA.')
    if (e instanceof Anthropic.PermissionDeniedError) throw new CoachError('Esta chave não tem acesso ao modelo. Confirma a conta na Anthropic.')
    if (e instanceof Anthropic.RateLimitError) throw new CoachError('Muitos pedidos seguidos ou sem crédito na conta. Espera um pouco ou confirma o saldo.')
    if (e instanceof Anthropic.APIConnectionError) throw new CoachError('Sem ligação ao treinador. Verifica a internet.')
    if (e instanceof Anthropic.APIError) throw new CoachError(`O treinador respondeu com um erro (${e.status}). Tenta de novo.`)
    throw new CoachError('Não foi possível falar com o treinador.')
  }
}

const label = (d: string) => new Date(d + 'T12:00:00').toLocaleDateString('pt-PT', { weekday: 'long', day: 'numeric', month: 'short' })

/**
 * Confere a proposta com as regras (tempo livre, piscina, futebol, máximo por
 * dia, duração) e transforma-a num plano novo e em frases para mostrar.
 * Um treino que não cumpra as regras fica onde estava.
 */
export function applyProposal(plan: Plan, profile: Profile, movable: Session[], days: string[], p: AiProposal) {
  const byId = new Map(movable.map((s) => [s.id, s]))
  const changes: string[] = []
  const kept: string[] = []
  const notes = new Map<string, string>()
  const others = plan.sessions.filter((s) => !byId.has(s.id))
  const placed: Session[] = []
  const free = new Map(days.map((d) => [d, freeSlots(profile, d, plan.dayOverrides[d])]))
  // Os treinos que não mudam (ainda por ver ou recusados) contam no sítio onde estão; os aceites, no sítio novo
  const done = new Set<string>()
  const current = (self: string) => [
    ...others, ...placed,
    ...movable.filter((x) => x.id !== self && !placed.some((y) => y.id === x.id) && !dropped.has(x.id)),
  ].filter((x) => !x.skipped)
  const busy = (d: string, self: string) => current(self)
    .filter((x) => x.date === d && x.kind !== 'fixed' && x.start !== undefined).map((x) => ({ start: x.start!, end: x.start! + x.minutes }))

  const dropped: Set<string> = new Set(p.retirados.map((r) => r.id).filter((id) => byId.has(id) && !byId.get(id)!.key))
  for (const r of p.retirados) if (dropped.has(r.id)) changes.push(`"${byId.get(r.id)!.title}" sai esta semana: ${r.porque}`)

  for (const t of p.treinos) {
    const s = byId.get(t.id)
    if (!s || dropped.has(s.id) || done.has(s.id)) continue
    const minutes = Math.round(Math.min(s.minutes * 1.1, Math.max(s.minutes * 0.8, t.minutos)) / 5) * 5
    const start = /^\d{2}:\d{2}$/.test(t.hora) ? fromHHMM(t.hora) : NaN
    const sameDay = current(s.id).filter((x) => x.date === t.data)
    const slots = days.includes(t.data) ? subtract(free.get(t.data)!, busy(t.data, s.id)) : []
    done.add(s.id)
    const fits = Number.isFinite(start) && slots.some((w) => w.start <= start && w.end >= start + minutes)
    if (!fits || !allowedOn(profile, s, t.data, sameDay)) {
      kept.push(s.title)
      continue
    }
    const steps = scale(s, minutes)
    const next: Session = { ...s, date: t.data, start, minutes, steps, plannedTss: estimateTss(steps, s.sport), why: t.porque }
    placed.push(next)
    notes.set(s.id, t.porque)
    if (next.date !== s.date || next.start !== s.start || next.minutes !== s.minutes) {
      const moved = next.date !== s.date ? `passa para ${label(next.date)} às ${toHHMM(start)}` : next.start !== s.start ? `passa para as ${toHHMM(start)}` : 'fica no mesmo dia'
      changes.push(`"${s.title}" ${moved}${minutes !== s.minutes ? ` (${minutes} min)` : ''}: ${t.porque}`)
    }
  }
  // O que a IA não mencionou (ou não cumpria as regras) fica como estava
  const untouched = movable.filter((s) => !dropped.has(s.id) && !placed.some((x) => x.id === s.id))
  const sessions = [
    ...others,
    ...placed,
    ...untouched,
    ...movable.filter((s) => dropped.has(s.id)).map((s) => ({ ...s, skipped: true })),
  ].sort((a, b) => a.date.localeCompare(b.date) || (a.start ?? 0) - (b.start ?? 0))
  if (kept.length) changes.push(`Ficam como estavam, porque a sugestão não cabia no teu tempo livre ou nas regras: ${kept.join(', ')}.`)
  return { plan: { ...plan, sessions }, changes, summary: p.resumo }
}

function scale(s: Session, minutes: number) {
  const total = s.steps.reduce((a, x) => a + x.minutes, 0) || 1
  return s.steps.map((x) => ({ ...x, minutes: Math.max(0.5, Math.round(((x.minutes * minutes) / total) * 2) / 2) }))
}
