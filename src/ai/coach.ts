import Anthropic from '@anthropic-ai/sdk'
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod'
import { z } from 'zod'
import { addDaysIso, weekdayOf } from '../domain/dates'
import { loadSeries } from '../domain/load'
import { allowedOn, estimateTss, scaleSteps } from '../domain/plan'
import { enduranceSpeeds, formatDistance, progressionToRace, raceLabel, raceMinutes, raceOf, sessionDistance } from '../domain/race'
import { freeSlots, fromHHMM, subtract, toHHMM } from '../domain/schedule'
import type { Activity, Plan, Profile, Session, Step } from '../domain/types'
import { cssPer100, formatPace, ftp, runThresholdPace } from '../domain/zones'
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

  const race = raceOf(profile)
  const est = raceMinutes(profile)
  const speeds = enduranceSpeeds(profile)
  const t = profile.tests
  const css = cssPer100(t), power = ftp(t), thr = runThresholdPace(t)
  const prog = progressionToRace(profile, plan.sessions, plan.weeks)
  const progNow = prog.findIndex((x) => x.start === monday)
  const dist = (s: Session) => formatDistance(sessionDistance(s, profile))
  const describe = (s: Session) => ({
    data: s.date, modalidade: s.sport, titulo: s.title, minutos: s.minutes, distancia: dist(s),
    blocos: s.steps.map((x) => `${x.minutes} min ${x.label} Z${x.zone}`).join('; '),
  })
  // O que foi feito nas últimas 3 semanas, para o treinador continuar a partir daí
  const recent = activities.filter((x) => x.date >= addDaysIso(monday, -21) && x.date < monday && x.sport !== 'other')

  const context = {
    hoje: today,
    prova: {
      nome: profile.raceName, data: profile.raceDate, distancia: raceLabel(race),
      natacao_m: race.swimM, bicicleta_km: race.bikeKm, corrida_km: race.runKm,
      tempo_estimado_min: est,
      semanas_ate_a_prova: Math.max(0, Math.ceil((new Date(profile.raceDate).getTime() - new Date(monday).getTime()) / (7 * 864e5))),
    },
    semana: week && { numero: week.index + 1, de: plan.weeks.length, fase: week.phase, descarga: week.recovery, minutos_alvo: week.targetMinutes },
    ritmos: {
      natacao: css ? `CSS ${formatPace(css)}/100 m (teste)` : `resistência ≈ ${formatPace(speeds.swim)}/100 m (estimado pela experiência, ainda sem teste)`,
      bicicleta: power ? `FTP ${power} W (teste)` : t.bikeLthr ? `FC de limiar ${t.bikeLthr} (teste)` : `resistência ≈ ${speeds.bike} km/h (estimado)`,
      corrida: thr ? `limiar ${formatPace(thr)}/km (teste)` : `resistência ≈ ${formatPace(speeds.run)}/km (estimado)`,
      fc_limiar_corrida: t.runLthr,
    },
    evolucao_rumo_a_prova: prog.slice(Math.max(0, progNow - 3), progNow + 4).map((x) => ({
      semana: x.week, mais_longo: `natação ${x.swimM} m (${x.swim}%), bicicleta ${x.bikeKm} km (${x.bike}%), corrida ${x.runKm} km (${x.run}%)`,
    })),
    semana_passada: lastWeek.filter((s) => !s.skipped).map(describe),
    feito_ultimas_3_semanas: recent.map((x) => ({
      data: x.date, modalidade: x.sport, minutos: Math.round(x.durationSec / 60), km: x.distanceM ? Math.round(x.distanceM / 100) / 10 : null, tss: x.tss,
    })),
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
      distancia_estimada: dist(s),
      conteudo_fixo: s.kind === 'test' ? 'teste: não mudes os blocos' : undefined,
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
    porque: z.string().describe('uma frase curta sobre o porquê deste dia e hora e do conteúdo'),
    titulo: z.string().describe('nome curto do treino, ex.: "Natação: 6 × 200 m ao ritmo CSS"'),
    blocos: z.array(z.object({
      descricao: z.string().describe('o que fazer, com distâncias, repetições, pausas e ritmos ou potência, ex.: "4 × 400 m a 2:05/100 m, 30 s de pausa"'),
      minutos: z.number(),
      zona: z.number().describe('1 a 5'),
    })).describe('do aquecimento ao retorno à calma; os minutos somam a duração do treino. Num brick, começa cada bloco por "Bicicleta:" ou "Corrida:"'),
    distancia: z.object({
      natacao_m: z.number().nullable(),
      bicicleta_km: z.number().nullable(),
      corrida_km: z.number().nullable(),
    }).describe('distância alvo do treino; null nas modalidades que não fazem parte dele'),
  })),
  retirados: z.array(z.object({ id: z.string(), porque: z.string() })),
})
export type AiProposal = z.infer<typeof Proposal>

const SYSTEM = `És um treinador de triatlo experiente a preparar um atleta para a prova indicada em "prova" (distâncias em "prova"). Escreves em português de Portugal, de forma simples e direta.

Recebes uma semana de treinos já calculada por regras de periodização (volume, fases, semanas de descarga) e o tempo livre real do atleta, dia a dia, entre aulas e outros eventos. Tens dois trabalhos.

1. Escrever cada treino em concreto, com evolução de semana para semana:
- Para cada treino, dá um título e os blocos do aquecimento ao retorno à calma, com distâncias, repetições, pausas e o alvo de ritmo, potência ou FC (usa "ritmos"; se forem estimados, dá o alvo também por sensação, ex.: "consegues falar frases curtas").
- Parte do que o atleta fez ("semana_passada" e "feito_ultimas_3_semanas") e avança um pequeno passo: mais uma repetição, blocos um pouco mais longos ou um ritmo um pouco mais perto do de prova. Em semana de descarga, mantém ou recua. Se falhou treinos ou a fadiga é alta, não avances.
- As sessões longas aproximam-se das distâncias da prova ao longo das semanas ("evolucao_rumo_a_prova"); diz no "porquê" quanto falta.
- Respeita o tipo de treino: um treino fácil ou de recuperação fica quase todo em zona 1 e 2; intervalos e tempo têm o trabalho principal em zona 3 a 5. Num teste, mantém os blocos como estão.
- Os minutos dos blocos somam a duração do treino. Dá a distância alvo coerente com os blocos e os ritmos.

2. Distribuir estes treinos pela semana da forma mais eficiente e inteligente:
- Põe cada treino num dia e hora dentro do tempo livre ("livre"), sem chocar com os treinos fixos (ginásio, futebol).
- Separa os treinos chave (intervalos, tempo, longos) com pelo menos um dia mais leve entre eles, e deixa pelo menos um dia de descanso.
- Evita corrida dura no dia a seguir ao futebol e treinos intensos logo depois do ginásio de pernas.
- Natação só nos dias com piscina. Respeita o máximo de treinos por dia.
- Tem em conta as lesões descritas: se uma lesão for recente ou na perna, reduz o impacto (menos corrida seguida, mais bicicleta) e explica.
- Se houver fadiga alta (frescura muito negativa) ou treinos falhados, podes encurtar ou retirar treinos secundários. Nunca acrescentes volume: a duração de cada treino pode variar entre 80% e 110% da original.
- Prefere a hora que o atleta indicou (manhã ou fim do dia). Ao fim de semana, os treinos longos começam de manhã.
Usa só os ids e as datas que recebes. Todos os treinos que não retirares têm de aparecer em "treinos". No "resumo", diz em que ponto está a preparação e o que esta semana acrescenta.`

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
    const content = s.kind === 'test' ? null : designed(s, t, minutes)
    const steps = content?.steps ?? scale(s, minutes)
    const target = content ? plausibleTarget({ ...s, steps, minutes, target: undefined }, profile, t.distancia) : s.target
    const next: Session = { ...s, date: t.data, start, minutes, steps, plannedTss: estimateTss(steps, s.sport), why: t.porque,
      ...(content ? { title: content.title } : {}), ...(target ? { target } : {}) }
    placed.push(next)
    notes.set(s.id, t.porque)
    const where = next.date !== s.date ? `${label(next.date)} às ${toHHMM(start)}` : next.start !== s.start ? `às ${toHHMM(start)}` : 'no mesmo dia e hora'
    const d = formatDistance(sessionDistance(next, profile))
    if (where !== 'no mesmo dia e hora' || minutes !== s.minutes || content) changes.push(`"${next.title}" ${where}, ${minutes} min${d ? `, ≈ ${d}` : ''}: ${t.porque}`)
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

const SPORT_OK = { swim: /./, bike: /./, run: /./, brick: /^(bicicleta|corrida|transição)/i } as Record<string, RegExp>

/**
 * Os blocos que a IA escreveu, se forem coerentes com o tipo de treino: zonas
 * de 1 a 5, minutos que somam perto da duração e, num treino fácil, pouca
 * intensidade. Se não forem, ficam os blocos do plano.
 */
function designed(s: Session, t: AiProposal['treinos'][number], minutes: number): { steps: Step[]; title: string } | null {
  const blocks = t.blocos ?? []
  if (!blocks.length || blocks.length > 40) return null
  if (blocks.some((b) => !Number.isFinite(b.minutos) || b.minutos <= 0 || !b.descricao?.trim())) return null
  if (s.sport === 'brick' && !blocks.every((b) => SPORT_OK.brick.test(b.descricao.trim()))) return null
  const sum = blocks.reduce((a, b) => a + b.minutos, 0)
  if (sum < minutes * 0.85 || sum > minutes * 1.15) return null
  const steps = scaleSteps(blocks.map((b) => ({ label: b.descricao.trim().slice(0, 140), minutes: b.minutos, zone: Math.min(5, Math.max(1, Math.round(b.zona))) })), minutes)
  const hard = steps.filter((x) => x.zone >= 4).reduce((a, x) => a + x.minutes, 0) / minutes
  const easy = s.kind === 'recovery' || s.kind === 'endurance' || s.kind === 'long'
  if (s.kind === 'recovery' && steps.some((x) => x.zone >= 3)) return null
  if (easy && hard > 0.15) return null
  if (hard > 0.6) return null
  const title = t.titulo?.trim().slice(0, 70) || s.title
  return { steps, title }
}

/** A distância alvo da IA, se não estiver muito longe do que os blocos e os teus ritmos dão */
function plausibleTarget(s: Session, profile: Profile, d: AiProposal['treinos'][number]['distancia'] | undefined): Session['target'] {
  if (!d) return undefined
  const est = sessionDistance(s, profile)
  const near = (a: number | null | undefined, b: number | undefined) => !a || !b ? undefined : a >= b * 0.7 && a <= b * 1.35 ? a : undefined
  const target = { swimM: near(d.natacao_m, est.swimM), bikeKm: near(d.bicicleta_km, est.bikeKm), runKm: near(d.corrida_km, est.runKm) }
  const clean = Object.fromEntries(Object.entries(target).filter(([, v]) => v !== undefined)) as Session['target']
  return clean && Object.keys(clean).length ? clean : undefined
}

function scale(s: Session, minutes: number) {
  const total = s.steps.reduce((a, x) => a + x.minutes, 0) || 1
  return s.steps.map((x) => ({ ...x, minutes: Math.max(0.5, Math.round(((x.minutes * minutes) / total) * 2) / 2) }))
}
