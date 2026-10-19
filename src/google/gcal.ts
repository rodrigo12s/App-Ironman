import { addDaysIso, mondayOf } from '../domain/dates'
import { guessKind } from '../domain/ics'
import { toHHMM } from '../domain/schedule'
import type { Commitment, CommitmentEdit, CommitmentKind, GoogleSettings, Session, Sport } from '../domain/types'

/** Identificador público da app no Google Cloud (não é secreto) */
export const CLIENT_ID = '929584667361-liek6tlvgdk2old9pq2hvcj0rchd2l0g.apps.googleusercontent.com'
const SCOPE_READ = 'https://www.googleapis.com/auth/calendar.readonly'
const SCOPE_WRITE = 'https://www.googleapis.com/auth/calendar.app.created'
const BASE = 'https://www.googleapis.com/calendar/v3'
export const TRAINING_CALENDAR = 'Treinos Ironman'
const TOKEN_KEY = 'ironman-google-token'

/** Só os endereços registados no Google Cloud conseguem abrir a janela de login */
export const ALLOWED_HOSTS = ['rodrigo12s.github.io', 'localhost', '127.0.0.1']
export const APP_URL = 'https://rodrigo12s.github.io/App-Ironman/'

export const timeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Lisbon'

// ---------- Login (Google Identity Services) ----------

interface TokenResponse { access_token?: string; expires_in?: number; error?: string; scope?: string }
interface Gis {
  accounts: {
    oauth2: {
      initTokenClient(cfg: {
        client_id: string
        scope: string
        callback: (r: TokenResponse) => void
        error_callback?: (e: { type: string }) => void
      }): { requestAccessToken(o?: { prompt?: string }): void }
      hasGrantedAllScopes(r: TokenResponse, ...scopes: string[]): boolean
      revoke(token: string, done?: () => void): void
    }
  }
}
declare global { interface Window { google?: Gis } }

let gisLoading: Promise<void> | null = null

/** Carrega o script de login do Google. Convém chamar antes do clique, para a janela não ser bloqueada. */
export function loadGis(): Promise<void> {
  if (window.google?.accounts?.oauth2) return Promise.resolve()
  gisLoading ??= new Promise((resolve, reject) => {
    const s = document.createElement('script')
    s.src = 'https://accounts.google.com/gsi/client'
    s.async = true
    s.onload = () => resolve()
    s.onerror = () => { gisLoading = null; reject(new Error('Não foi possível contactar o Google. Verifica a ligação à internet.')) }
    document.head.appendChild(s)
  })
  return gisLoading
}

let memToken: { value: string; exp: number; canWrite: boolean } | null = null

function stored() {
  if (memToken) return memToken
  try {
    const raw = sessionStorage.getItem(TOKEN_KEY)
    memToken = raw ? JSON.parse(raw) : null
  } catch { memToken = null }
  return memToken
}

/** Token ainda válido (dura cerca de 1 hora), ou null */
export function currentToken(): { value: string; canWrite: boolean } | null {
  const t = stored()
  return t && t.exp > Date.now() + 60_000 ? t : null
}

export function forgetToken() {
  memToken = null
  try { sessionStorage.removeItem(TOKEN_KEY) } catch { /* sem armazenamento */ }
}

/** Abre a janela do Google para dar acesso. Tem de ser chamado a partir de um clique. */
export async function requestToken(firstTime: boolean): Promise<{ value: string; canWrite: boolean }> {
  const valid = currentToken()
  if (valid) return valid
  await loadGis()
  const gis = window.google!.accounts.oauth2
  return new Promise((resolve, reject) => {
    const client = gis.initTokenClient({
      client_id: CLIENT_ID,
      scope: `${SCOPE_READ} ${SCOPE_WRITE}`,
      callback: (r) => {
        if (r.error || !r.access_token) return reject(new Error('O Google não deu acesso ao calendário.'))
        if (!gis.hasGrantedAllScopes(r, SCOPE_READ)) return reject(new Error('Sem autorização para ver o calendário. Liga de novo e deixa a opção de ver os eventos marcada.'))
        const t = { value: r.access_token, exp: Date.now() + (r.expires_in ?? 3600) * 1000, canWrite: gis.hasGrantedAllScopes(r, SCOPE_WRITE) }
        memToken = t
        try { sessionStorage.setItem(TOKEN_KEY, JSON.stringify(t)) } catch { /* fica só em memória */ }
        resolve(t)
      },
      error_callback: (e) => reject(new Error(e.type === 'popup_closed' ? 'Fechaste a janela do Google antes de terminar.' : 'O browser bloqueou a janela do Google. Permite pop-ups para este site e tenta de novo.')),
    })
    client.requestAccessToken({ prompt: firstTime ? 'consent' : '' })
  })
}

export function revoke() {
  const t = stored()
  forgetToken()
  if (t && window.google?.accounts?.oauth2) window.google.accounts.oauth2.revoke(t.value)
}

// ---------- Pedidos à API ----------

export class GoogleAuthError extends Error {}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function api<T>(token: string, path: string, init: RequestInit = {}, attempt = 0): Promise<T> {
  const res = await fetch(BASE + path, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...init.headers },
  })
  if (res.status === 401) {
    forgetToken()
    throw new GoogleAuthError('A sessão do Google expirou. Volta a sincronizar.')
  }
  if ((res.status === 429 || res.status === 403 || res.status >= 500) && attempt < 4) {
    const text = await res.clone().text()
    if (res.status !== 403 || /rateLimit|userRateLimit/i.test(text)) {
      await sleep(500 * 2 ** attempt)
      return api(token, path, init, attempt + 1)
    }
  }
  if (!res.ok) {
    const err = new Error(`Google Calendar respondeu ${res.status}.`) as Error & { status: number }
    err.status = res.status
    throw err
  }
  return (res.status === 204 ? undefined : await res.json()) as T
}

const q = (params: Record<string, string | undefined>) =>
  '?' + Object.entries(params).filter(([, v]) => v !== undefined).map(([k, v]) => `${k}=${encodeURIComponent(v!)}`).join('&')

/** Meia-noite local do dia, no formato que a API pede */
const rfc = (date: string) => new Date(date + 'T00:00:00').toISOString()

export interface CalendarInfo { id: string; name: string; primary?: boolean; owner: boolean }

export async function listCalendars(token: string): Promise<CalendarInfo[]> {
  const out: CalendarInfo[] = []
  let pageToken: string | undefined
  do {
    const r = await api<{ items: { id: string; summary: string; summaryOverride?: string; primary?: boolean; accessRole: string }[]; nextPageToken?: string }>(
      token, `/users/me/calendarList${q({ pageToken, maxResults: '250' })}`)
    out.push(...r.items.map((c) => ({ id: c.id, name: c.summaryOverride || c.summary, primary: c.primary, owner: c.accessRole === 'owner' })))
    pageToken = r.nextPageToken
  } while (pageToken)
  return out
}

/** Calendários que fazem sentido importar por defeito (sem feriados nem aniversários) */
export const defaultImport = (cals: CalendarInfo[], trainingId?: string) =>
  cals.filter((c) => c.id !== trainingId && c.name !== TRAINING_CALENDAR && !/#holiday@|#contacts@|#weeknum@/.test(c.id)).map((c) => c.id)

export interface GEvent {
  id: string
  status?: string
  summary?: string
  description?: string
  colorId?: string
  transparency?: string
  start: { dateTime?: string; date?: string; timeZone?: string }
  end: { dateTime?: string; date?: string; timeZone?: string }
  attendees?: { self?: boolean; responseStatus?: string }[]
  extendedProperties?: { private?: Record<string, string> }
}

async function listEvents(token: string, calendarId: string, from: string, to: string): Promise<GEvent[]> {
  const out: GEvent[] = []
  let pageToken: string | undefined
  do {
    const r = await api<{ items: GEvent[]; nextPageToken?: string }>(token, `/calendars/${encodeURIComponent(calendarId)}/events${q({
      timeMin: rfc(from), timeMax: rfc(to), singleEvents: 'true', orderBy: 'startTime', maxResults: '2500', timeZone: timeZone(), pageToken,
    })}`)
    out.push(...r.items)
    pageToken = r.nextPageToken
  } while (pageToken)
  return out
}

// ---------- Importar eventos como compromissos ----------

/** "2026-10-20T09:30:00+01:00" → minutos desde a meia-noite, na hora do próprio texto */
const clock = (dt: string) => Number(dt.slice(11, 13)) * 60 + Number(dt.slice(14, 16))

/**
 * Converte eventos do Google em compromissos, um a um, tal como estão no
 * calendário. Só ficam de fora os cancelados e os que recusaste. Um evento com
 * hora que dura vários dias ocupa cada um desses dias. Os de dia inteiro
 * entram, mas só ocupam horas se os marcares assim na app.
 * O tipo que escolheste à mão para um evento (pelo nome) mantém-se.
 */
export function eventsToCommitments(events: GEvent[], keepKinds: Map<string, CommitmentKind> = new Map()): Commitment[] {
  const out: Commitment[] = []
  const seen = new Set<string>()
  const push = (e: GEvent, title: string, date: string, start: number, end: number, part: number, allDay = false) => {
    const key = `${date}|${start}|${end}|${title}|${allDay}`
    if (seen.has(key) || end - start < 1) return
    seen.add(key)
    out.push({
      id: part ? `g-${e.id}-${part}` : `g-${e.id}`, title, kind: keepKinds.get(title) ?? guessKind(title), start, end, date, source: 'google',
      ...(allDay ? { allDay: true } : {}),
    })
  }
  for (const e of events) {
    if (e.status === 'cancelled') continue
    if (e.attendees?.some((a) => a.self && a.responseStatus === 'declined')) continue
    const title = e.summary?.trim() || 'Ocupado'
    if (!e.start.dateTime || !e.end.dateTime) {
      // Dia inteiro: a data de fim do Google é o dia a seguir ao último
      const first = e.start.date
      if (!first) continue
      const last = e.end.date && e.end.date > first ? addDaysIso(e.end.date, -1) : first
      let part = 0
      for (let d = first; d <= last && part < 31; d = addDaysIso(d, 1), part++) push(e, title, d, 0, 24 * 60, part, true)
      continue
    }
    const first = e.start.dateTime.slice(0, 10)
    const last = e.end.dateTime.slice(0, 10)
    const start = clock(e.start.dateTime)
    if (last <= first) {
      push(e, title, first, start, Math.max(start + 15, clock(e.end.dateTime)), 0)
      continue
    }
    // Vários dias: do início até à meia-noite, dias inteiros pelo meio, e da meia-noite até ao fim
    let part = 0
    for (let d = first; d <= last && part < 31; d = addDaysIso(d, 1), part++) {
      const from = d === first ? start : 0
      const to = d === last ? clock(e.end.dateTime) : 24 * 60
      push(e, title, d, from, to, part)
    }
  }
  return out.sort((a, b) => a.date!.localeCompare(b.date!) || a.start - b.start)
}

/** Aplica as mudanças que fizeste na app aos eventos acabados de ler do Google */
export function applyEdits(list: Commitment[], edits: Record<string, CommitmentEdit> = {}): Commitment[] {
  return list.flatMap((c) => {
    const e = edits[c.id]
    if (!e) return [c]
    if (e.deleted) return []
    const { deleted: _d, ...patch } = e
    return [{ ...c, ...patch }]
  })
}

export interface ImportStats { name: string; events: number; allDay: number; failed?: boolean }

export async function importEvents(token: string, calendars: { id: string; name: string }[], from: string, to: string, keepKinds?: Map<string, CommitmentKind>) {
  const all: GEvent[] = []
  const stats: ImportStats[] = []
  for (const c of calendars) {
    try {
      const events = (await listEvents(token, c.id, from, to)).filter((e) => e.status !== 'cancelled')
      all.push(...events)
      stats.push({ name: c.name, events: events.filter((e) => e.start.dateTime).length, allDay: events.filter((e) => !e.start.dateTime).length })
    } catch (e) {
      // Um calendário que deixou de existir ou que só mostra "ocupado" não deve parar o resto
      if (e instanceof GoogleAuthError) throw e
      stats.push({ name: c.name, events: 0, allDay: 0, failed: true })
    }
  }
  return { stats, commitments: eventsToCommitments(all, keepKinds) }
}

/** Até onde se leem os eventos: a prova ou meio ano, o que vier primeiro */
export const importUntil = (from: string, raceDate: string) => {
  const half = addDaysIso(from, 182)
  return half < raceDate ? half : addDaysIso(raceDate, 1)
}

/**
 * Lê os calendários e os eventos e devolve os compromissos que vêm do Google.
 * Na primeira vez escolhe os calendários a ler (todos menos feriados e aniversários).
 */
export async function fetchCommitments(token: string, settings: GoogleSettings | undefined, old: Commitment[], from: string, raceDate: string) {
  const cals = await listCalendars(token)
  let next: GoogleSettings = settings ?? { importCalendars: [], writeTrainings: true, calendars: [] }
  // Calendários novos (que ainda não conhecíamos) entram logo, como na primeira vez
  const known = new Set(settings?.calendars.map((c) => c.id) ?? [])
  const fresh = defaultImport(cals.filter((c) => !known.has(c.id)), next.trainingCalendarId)
  next = { ...next, importCalendars: [...new Set([...next.importCalendars, ...fresh])], calendars: cals.map(({ id, name, primary }) => ({ id, name, primary })) }
  const keepKinds = new Map<string, CommitmentKind>(old.filter((c) => c.source === 'google').map((c) => [c.title, c.kind]))
  const chosen = cals.filter((c) => next.importCalendars.includes(c.id) && c.id !== next.trainingCalendarId && c.name !== TRAINING_CALENDAR)
  // Desde segunda-feira desta semana, para a semana atual aparecer completa
  const read = await importEvents(token, chosen, mondayOf(from), importUntil(from, raceDate), keepKinds)
  const commitments = applyEdits(read.commitments, next.edits)
  const stats = read.stats
  next = { ...next, lastImport: stats }
  const events = stats.reduce((a, x) => a + x.events, 0)
  return { settings: next, commitments: [...old.filter((c) => c.source !== 'google'), ...commitments], imported: commitments.length, events, stats }
}

/** Frase curta sobre o que foi lido do Google */
export function importSummary(stats: ImportStats[]): string {
  const events = stats.reduce((a, x) => a + x.events, 0)
  const allDay = stats.reduce((a, x) => a + x.allDay, 0)
  const failed = stats.filter((x) => x.failed).map((x) => x.name)
  return [
    `Li ${events + allDay} eventos de ${stats.length} ${stats.length === 1 ? 'calendário' : 'calendários'}.`,
    allDay ? `${allDay} são de dia inteiro: aparecem no calendário mas não ocupam horas, a não ser que os marques assim.` : '',
    failed.length ? `Não consegui ler: ${failed.join(', ')}.` : '',
  ].filter(Boolean).join(' ')
}

// ---------- Escrever os treinos ----------

const COLOR: Record<Sport, string> = { swim: '7', bike: '10', run: '6', strength: '3', brick: '4', football: '8' }
const ICON: Record<Sport, string> = { swim: '🏊', bike: '🚴', run: '🏃', strength: '🏋️', brick: '🔁', football: '⚽' }

export interface EventBody {
  summary: string
  description: string
  colorId: string
  start: { dateTime: string; timeZone: string }
  end: { dateTime: string; timeZone: string }
  extendedProperties: { private: { ironmanId: string } }
  reminders: { useDefault: boolean }
}

const at = (date: string, minutes: number) => {
  const d = addDaysIso(date, Math.floor(minutes / 1440))
  return `${d}T${toHHMM(minutes % 1440)}:00`
}

export function sessionToEvent(s: Session, tz: string): EventBody {
  const start = s.start ?? 7 * 60
  const zones = s.steps.map((x) => `• ${x.minutes} min ${x.label}${x.zone ? ` (Z${x.zone})` : ''}`).join('\n')
  return {
    summary: `${ICON[s.sport]} ${s.title}`,
    description: `${zones}\n\nCriado pela app O meu Ironman. As alterações feitas aqui são substituídas na próxima sincronização.`,
    colorId: s.kind === 'race' ? '11' : COLOR[s.sport],
    start: { dateTime: at(s.date, start), timeZone: tz },
    end: { dateTime: at(s.date, start + s.minutes), timeZone: tz },
    extendedProperties: { private: { ironmanId: s.id } },
    reminders: { useDefault: false },
  }
}

/** Treinos do plano que vão para o calendário: os teus, sem o ginásio e o futebol que já lá estão */
export const sessionsToWrite = (sessions: Session[], from: string, to: string) =>
  sessions.filter((s) => !s.skipped && s.kind !== 'fixed' && s.date >= from && s.date < to)

const same = (e: GEvent, b: EventBody) =>
  e.summary === b.summary && (e.description ?? '') === b.description && e.colorId === b.colorId &&
  e.start.dateTime?.slice(0, 16) === b.start.dateTime.slice(0, 16) && e.end.dateTime?.slice(0, 16) === b.end.dateTime.slice(0, 16)

/** O que é preciso criar, alterar e apagar para o calendário ficar igual ao plano */
export function diffEvents(existing: GEvent[], desired: EventBody[]) {
  const byId = new Map<string, GEvent>()
  const remove: string[] = []
  for (const e of existing) {
    const id = e.extendedProperties?.private?.ironmanId
    if (!id || e.status === 'cancelled') continue // eventos que criaste à mão ficam como estão
    if (byId.has(id)) remove.push(e.id)
    else byId.set(id, e)
  }
  const create: EventBody[] = []
  const update: { eventId: string; body: EventBody }[] = []
  for (const b of desired) {
    const e = byId.get(b.extendedProperties.private.ironmanId)
    byId.delete(b.extendedProperties.private.ironmanId)
    if (!e) create.push(b)
    else if (!same(e, b)) update.push({ eventId: e.id, body: b })
  }
  remove.push(...[...byId.values()].map((e) => e.id))
  return { create, update, remove }
}

/** Usa o calendário "Treinos Ironman" já criado pela app, ou cria um novo */
export async function ensureTrainingCalendar(token: string, knownId?: string): Promise<string> {
  if (knownId) {
    try {
      await api(token, `/calendars/${encodeURIComponent(knownId)}`)
      return knownId
    } catch (e) {
      if (e instanceof GoogleAuthError) throw e
    }
  }
  const existing = (await listCalendars(token)).find((c) => c.name === TRAINING_CALENDAR && c.owner)
  if (existing) return existing.id
  const created = await api<{ id: string }>(token, '/calendars', {
    method: 'POST',
    body: JSON.stringify({ summary: TRAINING_CALENDAR, description: 'Treinos do plano, escritos pela app O meu Ironman.', timeZone: timeZone() }),
  })
  return created.id
}

async function pool<T>(items: T[], size: number, fn: (x: T) => Promise<unknown>) {
  let i = 0
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => {
    while (i < items.length) await fn(items[i++])
  }))
}

/** Semanas de treino que ficam escritas no calendário, a contar de hoje */
export const WRITE_WEEKS = 12

export async function syncTrainings(token: string, calendarId: string, sessions: Session[], today: string, raceDate: string) {
  const end = addDaysIso(today, WRITE_WEEKS * 7)
  const to = end < addDaysIso(raceDate, 1) ? end : addDaysIso(raceDate, 1)
  const tz = timeZone()
  const existing = await listEvents(token, calendarId, today, to)
  const { create, update, remove } = diffEvents(existing, sessionsToWrite(sessions, today, to).map((s) => sessionToEvent(s, tz)))
  const cal = `/calendars/${encodeURIComponent(calendarId)}/events`
  await pool(create, 4, (b) => api(token, cal, { method: 'POST', body: JSON.stringify(b) }))
  await pool(update, 4, (u) => api(token, `${cal}/${encodeURIComponent(u.eventId)}`, { method: 'PUT', body: JSON.stringify(u.body) }))
  await pool(remove, 4, (id) => api(token, `${cal}/${encodeURIComponent(id)}`, { method: 'DELETE' }).catch((e) => {
    if ((e as { status?: number }).status !== 410 && (e as { status?: number }).status !== 404) throw e
  }))
  return { created: create.length, updated: update.length, removed: remove.length }
}
