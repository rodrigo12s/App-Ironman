import { useEffect, useMemo, useRef, useState } from 'react'
import { addDaysIso, mondayOf } from '../domain/dates'
import { matchSessions, type SessionMatch } from '../domain/compliance'
import { commitmentsOn, toHHMM } from '../domain/schedule'
import type { Activity, Commitment, Plan, Profile, Session } from '../domain/types'
import { KIND_LABEL } from './ScheduleGrid'
import { SessionDetail, STATUS } from './WeekView'
import { SPORT_ICON, SPORT_LABEL, WEEKDAYS, fmtDay, fmtMinutes } from './format'

interface Props {
  profile: Profile
  plan: Plan
  activities: Activity[]
  today: string
  onSkip: (id: string) => void
  onUnskip: (id: string) => void
  onDone: (s: Session) => void
}

export type CalEvent =
  | { type: 'session'; id: string; date: string; start: number; end: number; m: SessionMatch }
  | { type: 'commitment'; id: string; date: string; start: number; end: number; c: Commitment }
  | { type: 'activity'; id: string; date: string; start: number; end: number; a: Activity }

const DEFAULT_FROM = 6 * 60
const DEFAULT_TO = 23 * 60
const HOUR_PX = 44

function eventsFor(profile: Profile, plan: Plan, activities: Activity[], from: string, to: string, today: string): CalEvent[] {
  const sessions = plan.sessions.filter((s) => s.date >= from && s.date <= to)
  const acts = activities.filter((a) => a.date >= from && a.date <= to)
  const { matches, unplanned } = matchSessions(sessions, acts, today)
  const out: CalEvent[] = matches.map((m) => {
    const start = m.session.start ?? 7 * 60
    return { type: 'session', id: m.session.id, date: m.session.date, start, end: start + Math.min(m.session.minutes, 24 * 60 - start), m }
  })
  for (let d = from; d <= to; d = addDaysIso(d, 1)) {
    for (const c of commitmentsOn(profile.schedule, d)) {
      // Ginásio e futebol já aparecem como sessões fixas do plano
      if (c.kind === 'gym' || c.kind === 'football') continue
      out.push({ type: 'commitment', id: `${d}-${c.id}`, date: d, start: c.start, end: c.end, c })
    }
  }
  for (const a of unplanned) {
    const t = new Date(a.startTime)
    const start = a.source === 'fit' ? t.getHours() * 60 + t.getMinutes() : 12 * 60
    out.push({ type: 'activity', id: a.id, date: a.date, start, end: start + Math.max(15, Math.round(a.durationSec / 60)), a })
  }
  return out.sort((x, y) => x.date.localeCompare(y.date) || x.start - y.start)
}

const titleOf = (e: CalEvent) => (e.type === 'session' ? e.m.session.title : e.type === 'commitment' ? e.c.title : e.a.name || SPORT_LABEL[e.a.sport])
const iconOf = (e: CalEvent) => (e.type === 'session' ? SPORT_ICON[e.m.session.sport] : e.type === 'activity' ? SPORT_ICON[e.a.sport] : '')
const classOf = (e: CalEvent) => {
  if (e.type === 'commitment') return `ev ev-c ev-${e.c.kind}`
  if (e.type === 'activity') return `ev ev-${e.a.sport} ev-done`
  const s = e.m.session
  return `ev ev-${s.kind === 'race' ? 'race' : s.sport} ${s.skipped ? 'ev-skipped' : ''} ${e.m.status === 'done' ? 'ev-done' : ''} ${e.m.status === 'missed' ? 'ev-missed' : ''} ${s.key ? 'ev-key' : ''}`
}

/** Distribui eventos sobrepostos em colunas, para não ficarem uns por cima dos outros */
function lanes(events: CalEvent[]): Map<string, { lane: number; of: number }> {
  const out = new Map<string, { lane: number; of: number }>()
  const sorted = [...events].sort((a, b) => a.start - b.start || b.end - a.end)
  let group: CalEvent[] = []
  let groupEnd = -1
  const flush = () => {
    const ends: number[] = []
    const assigned = group.map((e) => {
      let lane = ends.findIndex((end) => end <= e.start)
      if (lane < 0) { lane = ends.length; ends.push(e.end) } else ends[lane] = e.end
      return { e, lane }
    })
    assigned.forEach(({ e, lane }) => out.set(e.id, { lane, of: ends.length }))
    group = []
  }
  for (const e of sorted) {
    if (group.length && e.start >= groupEnd) flush()
    group.push(e)
    groupEnd = Math.max(groupEnd, e.end)
  }
  if (group.length) flush()
  return out
}

export function CalendarView({ profile, plan, activities, today, onSkip, onUnskip, onDone }: Props) {
  const [mode, setMode] = useState<'week' | 'month'>(() => {
    try { return (localStorage.getItem('ironman-cal-mode') as 'week' | 'month') || 'week' } catch { return 'week' }
  })
  const [anchor, setAnchor] = useState(today)
  const [selected, setSelected] = useState<string | null>(null)
  useEffect(() => { try { localStorage.setItem('ironman-cal-mode', mode) } catch { /* sem armazenamento */ } }, [mode])

  const range = useMemo(() => {
    if (mode === 'week') { const from = mondayOf(anchor); return { from, to: addDaysIso(from, 6) } }
    const first = anchor.slice(0, 8) + '01'
    const from = mondayOf(first)
    return { from, to: addDaysIso(from, 41) }
  }, [mode, anchor])
  const events = useMemo(() => eventsFor(profile, plan, activities, range.from, range.to, today), [profile, plan, activities, range, today])
  const sel = events.find((e) => e.id === selected) ?? null

  const move = (n: number) => {
    if (mode === 'week') setAnchor(addDaysIso(anchor, 7 * n))
    else { const d = new Date(anchor + 'T12:00:00'); d.setMonth(d.getMonth() + n, 1); setAnchor(d.toISOString().slice(0, 10)) }
  }
  const heading = mode === 'week'
    ? `${fmtDay(range.from, { day: 'numeric', month: 'short' })} a ${fmtDay(range.to, { day: 'numeric', month: 'short', year: 'numeric' })}`
    : fmtDay(anchor, { month: 'long', year: 'numeric' })

  return (
    <div className="stack">
      <section className="card cal-head">
        <div className="cal-toolbar">
          <div className="seg" role="group" aria-label="Vista">
            <button className={mode === 'week' ? 'on' : ''} onClick={() => setMode('week')}>Semana</button>
            <button className={mode === 'month' ? 'on' : ''} onClick={() => setMode('month')}>Mês</button>
          </div>
          <div className="cal-nav">
            <button onClick={() => move(-1)} aria-label="Anterior">‹</button>
            <b>{heading}</b>
            <button onClick={() => move(1)} aria-label="Seguinte">›</button>
          </div>
          <button className="small" onClick={() => setAnchor(today)}>Hoje</button>
        </div>
        <div className="cal-legend small muted">
          <span><i className="ev ev-swim" /> Natação</span><span><i className="ev ev-bike" /> Bicicleta</span><span><i className="ev ev-run" /> Corrida</span>
          <span><i className="ev ev-brick" /> Brick</span><span><i className="ev ev-strength" /> Força e ginásio</span><span><i className="ev ev-football" /> Futebol</span>
          <span><i className="ev ev-c ev-class" /> Aulas e outros</span>
        </div>
      </section>

      {mode === 'week'
        ? <WeekGrid from={range.from} events={events} today={today} onSelect={setSelected} />
        : <MonthGrid from={range.from} month={anchor.slice(0, 7)} events={events} today={today} onSelect={setSelected}
            onDay={(d) => { setAnchor(d); setMode('week') }} />}

      {sel && <DetailSheet e={sel} profile={profile} today={today} onClose={() => setSelected(null)}
        onSkip={(id) => { onSkip(id); setSelected(null) }} onUnskip={(id) => { onUnskip(id); setSelected(null) }} onDone={onDone} />}
    </div>
  )
}

function WeekGrid({ from, events, today, onSelect }: { from: string; events: CalEvent[]; today: string; onSelect: (id: string) => void }) {
  const days = Array.from({ length: 7 }, (_, i) => addDaysIso(from, i))
  const startMin = Math.min(DEFAULT_FROM, ...events.map((e) => Math.floor(e.start / 60) * 60))
  const endMin = Math.max(DEFAULT_TO, ...events.map((e) => Math.ceil(e.end / 60) * 60))
  const hours = Array.from({ length: (endMin - startMin) / 60 }, (_, i) => startMin / 60 + i)
  const height = ((endMin - startMin) / 60) * HOUR_PX
  const scroller = useRef<HTMLDivElement>(null)
  // No telemóvel, começa a mostrar o dia de hoje
  useEffect(() => {
    const idx = days.indexOf(today)
    if (scroller.current && idx > 0) scroller.current.scrollLeft = Math.max(0, idx - 1) * 110
  }, [from])

  return (
    <div className="card cal-week-wrap" ref={scroller}>
      <div className="cal-week">
        <div className="cal-corner" />
        {days.map((d, i) => (
          <div key={d} className={`cal-dayhead ${d === today ? 'is-today' : ''}`}>
            <span>{WEEKDAYS[i].slice(0, 3)}</span><b>{Number(d.slice(8))}</b>
          </div>
        ))}
        <div className="cal-hours" style={{ height }}>
          {hours.map((h) => <span key={h} style={{ top: (h * 60 - startMin) / 60 * HOUR_PX }}>{String(h).padStart(2, '0')}:00</span>)}
        </div>
        {days.map((d) => {
          const dayEvents = events.filter((e) => e.date === d)
          const lane = lanes(dayEvents)
          return (
            <div key={d} className={`cal-col ${d === today ? 'is-today' : ''}`} style={{ height }}>
              {hours.map((h) => <span key={h} className="cal-line" style={{ top: (h * 60 - startMin) / 60 * HOUR_PX }} />)}
              {dayEvents.map((e) => {
                const l = lane.get(e.id)!
                const top = ((e.start - startMin) / 60) * HOUR_PX
                const h = Math.max(18, ((e.end - e.start) / 60) * HOUR_PX - 2)
                return (
                  <button key={e.id} className={`${classOf(e)} ${h < 36 ? 'ev-short' : ''}`} onClick={() => onSelect(e.id)}
                    style={{ top, height: h, left: `calc(${(l.lane / l.of) * 100}% + 2px)`, width: `calc(${100 / l.of}% - 4px)` }}
                    aria-label={`${titleOf(e)}, ${toHHMM(e.start)} a ${toHHMM(e.end)}`}>
                    <span className="ev-time">{toHHMM(e.start)}</span>
                    <span className="ev-title">{iconOf(e)} {titleOf(e)}</span>
                  </button>
                )
              })}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function MonthGrid({ from, month, events, today, onSelect, onDay }: { from: string; month: string; events: CalEvent[]; today: string; onSelect: (id: string) => void; onDay: (d: string) => void }) {
  const days = Array.from({ length: 42 }, (_, i) => addDaysIso(from, i))
  const weeks = days.slice(35).some((d) => d.startsWith(month)) ? 6 : 5
  return (
    <div className="card cal-month">
      {WEEKDAYS.map((w) => <div key={w} className="cal-mhead">{w.slice(0, 3)}</div>)}
      {days.slice(0, weeks * 7).map((d) => {
        const list = events.filter((e) => e.date === d && !(e.type === 'session' && e.m.session.skipped))
        const training = list.filter((e) => e.type !== 'commitment')
        const others = list.length - training.length
        return (
          <div key={d} className={`cal-cell ${d.startsWith(month) ? '' : 'other'} ${d === today ? 'is-today' : ''}`}>
            <button className="cal-date" onClick={() => onDay(d)} aria-label={`Ver a semana de ${fmtDay(d)}`}>{Number(d.slice(8))}</button>
            {training.slice(0, 3).map((e) => (
              <button key={e.id} className={`${classOf(e)} chip-ev`} onClick={() => onSelect(e.id)} title={titleOf(e)}>
                <span className="ev-title">{iconOf(e)} {titleOf(e)}</span>
              </button>
            ))}
            {training.length > 3 && <button className="link tiny" onClick={() => onDay(d)}>+{training.length - 3}</button>}
            {others > 0 && <span className="tiny muted cal-others"><span className="txt">{others} {others === 1 ? 'compromisso' : 'compromissos'}</span></span>}
          </div>
        )
      })}
    </div>
  )
}

export function DetailSheet({ e, profile, today, onClose, onSkip, onUnskip, onDone }: { e: CalEvent; profile: Profile; today: string; onClose: () => void; onSkip: (id: string) => void; onUnskip: (id: string) => void; onDone?: (s: Session) => void }) {
  const closeRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    closeRef.current?.focus()
    const onKey = (ev: KeyboardEvent) => ev.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  const when = `${fmtDay(e.date, { weekday: 'long', day: 'numeric', month: 'long' })} · ${toHHMM(e.start)}–${toHHMM(e.end)}`
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" aria-labelledby="sheet-title" onClick={(ev) => ev.stopPropagation()}>
        <header>
          <div>
            <h2 id="sheet-title">{iconOf(e)} {titleOf(e)}</h2>
            <p className="muted small">{when}</p>
          </div>
          <button ref={closeRef} className="link" onClick={onClose} aria-label="Fechar">✕</button>
        </header>
        {e.type === 'session' && (
          <>
            <div className="chips left">
              <span className={`status ${STATUS[e.m.status].cls}`}>{STATUS[e.m.status].label}{e.m.ratio !== null && ` ${Math.round(e.m.ratio * 100)}%`}</span>
              {e.m.session.key && <span className="key">chave</span>}
              <span className="chip">{e.m.session.kind === 'fixed' ? 'Do teu horário' : SPORT_LABEL[e.m.session.sport]}</span>
              <span className="chip">{fmtMinutes(e.m.session.minutes)}</span>
              <span className="chip">{e.m.session.plannedTss} TSS</span>
            </div>
            {e.m.session.movedFrom && <p className="small muted">Movida de {fmtDay(e.m.session.movedFrom)}.</p>}
            <SessionDetail m={e.m} profile={profile} today={today} onSkip={onSkip} onUnskip={onUnskip} onDone={onDone && ((s) => { onDone(s); onClose() })} />
          </>
        )}
        {e.type === 'commitment' && (
          <>
            <div className="chips left"><span className="chip">{KIND_LABEL[e.c.kind]}</span><span className="chip">{e.c.source === 'ics' ? 'Do calendário importado' : 'Adicionado por ti'}</span></div>
            <p className="small">
              {e.c.weekday !== undefined
                ? `Todas as ${WEEKDAYS[e.c.weekday].toLowerCase()}s${e.c.from ? ` desde ${fmtDay(e.c.from, { day: 'numeric', month: 'short' })}` : ''}${e.c.until ? ` até ${fmtDay(e.c.until, { day: 'numeric', month: 'short' })}` : ''}.`
                : 'Só neste dia.'}
            </p>
            <p className="small muted">Os treinos não são marcados por cima e ficam 15 min de margem antes e depois. Para mudar ou apagar, vai a Perfil, passo Aulas e compromissos.</p>
          </>
        )}
        {e.type === 'activity' && (
          <>
            <div className="chips left"><span className="status st-done">Feito</span><span className="chip">Fora do plano</span></div>
            <p className="small">
              {SPORT_LABEL[e.a.sport]} · {fmtMinutes(e.a.durationSec / 60)}
              {e.a.distanceM ? ` · ${(e.a.distanceM / 1000).toFixed(1)} km` : ''}
              {e.a.avgPower ? ` · ${Math.round(e.a.normalizedPower ?? e.a.avgPower)} W` : ''}
              {e.a.avgHr ? ` · ${Math.round(e.a.avgHr)} bpm` : ''} · {e.a.tss} TSS
            </p>
          </>
        )}
      </div>
    </div>
  )
}
