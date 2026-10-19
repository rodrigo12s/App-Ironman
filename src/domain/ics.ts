import { addDaysIso, iso, weekdayOf } from './dates'
import type { Commitment, CommitmentKind, Weekday } from './types'

const DAYS: Record<string, Weekday> = { MO: 0, TU: 1, WE: 2, TH: 3, FR: 4, SA: 5, SU: 6 }

interface RawEvent {
  summary: string
  start: Date
  end: Date
  allDay: boolean
  rrule?: Record<string, string>
  exdates: string[]
}

/** Lê uma data iCalendar: 20261019T090000Z (UTC), 20261019T090000 (hora local) ou 20261019 (dia inteiro) */
function parseIcsDate(value: string): { date: Date; allDay: boolean } {
  const m = value.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/)
  if (!m) throw new Error(`Data inválida: ${value}`)
  const [, y, mo, d, h, mi, s, z] = m
  if (h === undefined) return { date: new Date(+y, +mo - 1, +d), allDay: true }
  const date = z
    ? new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +(s ?? 0)))
    : new Date(+y, +mo - 1, +d, +h, +mi, +(s ?? 0))
  return { date, allDay: false }
}

function unfold(text: string): string[] {
  return text.replace(/\r\n/g, '\n').replace(/\n[ \t]/g, '').split('\n')
}

function readEvents(text: string): RawEvent[] {
  const events: RawEvent[] = []
  let cur: Partial<RawEvent> & { exdates: string[] } | null = null
  for (const line of unfold(text)) {
    if (line === 'BEGIN:VEVENT') { cur = { exdates: [] }; continue }
    if (line === 'END:VEVENT') {
      if (cur?.start && cur.end) events.push({ summary: cur.summary ?? 'Evento', start: cur.start, end: cur.end, allDay: !!cur.allDay, rrule: cur.rrule, exdates: cur.exdates })
      cur = null
      continue
    }
    if (!cur) continue
    const idx = line.indexOf(':')
    if (idx < 0) continue
    const name = line.slice(0, idx).split(';')[0].toUpperCase()
    const value = line.slice(idx + 1).trim()
    if (name === 'SUMMARY') cur.summary = value.replace(/\\,/g, ',').replace(/\\;/g, ';').replace(/\\n/gi, ' ')
    else if (name === 'DTSTART') { const p = parseIcsDate(value); cur.start = p.date; cur.allDay = p.allDay }
    else if (name === 'DTEND') cur.end = parseIcsDate(value).date
    else if (name === 'RRULE') cur.rrule = Object.fromEntries(value.split(';').map((kv) => kv.split('=') as [string, string]))
    else if (name === 'EXDATE') value.split(',').forEach((v) => cur!.exdates.push(iso(parseIcsDate(v).date)))
  }
  return events
}

/** Adivinha o tipo de compromisso pelo nome do evento */
export function guessKind(title: string): CommitmentKind {
  const t = title.toLowerCase()
  if (/futebol|futsal|football|soccer|jogo/.test(t)) return 'football'
  if (/gin[aá]sio|gym|muscula|crossfit|for[cç]a/.test(t)) return 'gym'
  if (/trabalho|turno|work|est[aá]gio/.test(t)) return 'work'
  // Aulas, exames e o resto do calendário académico
  return 'class'
}

const minutesOf = (d: Date) => d.getHours() * 60 + d.getMinutes()

/**
 * Converte um ficheiro .ics (exportado do portal da universidade, Google
 * Calendar ou Outlook) em compromissos. Eventos semanais tornam-se
 * compromissos recorrentes; os restantes ficam como compromissos de um dia.
 * Só entram eventos entre `from` e `to` (o período do plano).
 */
export function parseIcs(text: string, from: string, to: string): Commitment[] {
  if (!text.includes('BEGIN:VCALENDAR')) throw new Error('Isto não parece um ficheiro de calendário (.ics).')
  const out: Commitment[] = []
  const seen = new Set<string>()
  readEvents(text).forEach((e, i) => {
    if (e.allDay) return // feriados e dias inteiros não ocupam horas de treino
    const start = minutesOf(e.start)
    const end = Math.max(start + 15, minutesOf(e.end) || 24 * 60)
    const day = iso(e.start)
    const base = { title: e.summary, kind: guessKind(e.summary), start, end, source: 'ics' as const }

    if (e.rrule?.FREQ === 'WEEKLY') {
      const byDay = e.rrule.BYDAY ? e.rrule.BYDAY.split(',').map((d) => DAYS[d.slice(-2)]).filter((d) => d !== undefined) : [weekdayOf(day) as Weekday]
      let until = e.rrule.UNTIL ? iso(parseIcsDate(e.rrule.UNTIL).date) : undefined
      if (!until && e.rrule.COUNT) until = addDaysIso(day, Math.ceil(Number(e.rrule.COUNT) / byDay.length) * 7 * Number(e.rrule.INTERVAL ?? 1))
      if (until && until < from) return
      if (day > to) return
      for (const wd of byDay) {
        const key = `w${wd}-${start}-${end}-${e.summary}`
        if (seen.has(key)) continue
        seen.add(key)
        out.push({ ...base, id: `ics-${i}-${wd}`, weekday: wd, from: day, until, except: e.exdates.length ? e.exdates : undefined })
      }
      return
    }
    if (day < from || day > to) return
    const key = `${day}-${start}-${end}-${e.summary}`
    if (seen.has(key)) return
    seen.add(key)
    out.push({ ...base, id: `ics-${i}`, date: day })
  })
  return collapseWeekly(out)
}

/**
 * Muitos portais exportam cada aula como um evento solto. Quando o mesmo
 * evento aparece pelo menos 3 vezes no mesmo dia da semana e hora, junta-o
 * num compromisso semanal, mais fácil de rever.
 */
function collapseWeekly(list: Commitment[]): Commitment[] {
  const singles = list.filter((c) => c.date)
  const groups = new Map<string, Commitment[]>()
  for (const c of singles) {
    const key = `${weekdayOf(c.date!)}|${c.start}|${c.end}|${c.title}`
    groups.set(key, [...(groups.get(key) ?? []), c])
  }
  const out = list.filter((c) => !c.date)
  for (const [key, items] of groups) {
    if (items.length < 3) { out.push(...items); continue }
    const dates = items.map((c) => c.date!).sort()
    const first = dates[0]
    const last = dates.at(-1)!
    const except: string[] = []
    for (let d = first; d <= last; d = addDaysIso(d, 7)) if (!dates.includes(d)) except.push(d)
    const wd = Number(key.split('|')[0]) as Weekday
    out.push({ ...items[0], id: `${items[0].id}-w`, date: undefined, weekday: wd, from: first, until: last, except: except.length ? except : undefined })
  }
  return out
}
