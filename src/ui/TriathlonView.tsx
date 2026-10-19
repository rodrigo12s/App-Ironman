import { useMemo, useState } from 'react'
import { isTriathlon } from '../ai/key'
import { matchSessions, type SessionMatch } from '../domain/compliance'
import { addDaysIso, mondayOf } from '../domain/dates'
import { toHHMM } from '../domain/schedule'
import type { Activity, Plan, Profile, Session } from '../domain/types'
import { DetailSheet } from './CalendarView'
import { STATUS } from './WeekView'
import { PHASE_LABEL, SPORT_ICON, fmtDay, fmtMinutes } from './format'

interface Props {
  profile: Profile
  plan: Plan
  activities: Activity[]
  today: string
  hasKey: boolean
  busy: boolean
  error: string | null
  onAsk: (monday: string) => void
  onSetupAi: () => void
  onSkip: (id: string) => void
  onUnskip: (id: string) => void
  onDone: (s: Session) => void
}

/** Só os treinos de natação, bicicleta, corrida e brick, semana a semana */
export function TriathlonView({ profile, plan, activities, today, hasKey, busy, error, onAsk, onSetupAi, onSkip, onUnskip, onDone }: Props) {
  const [monday, setMonday] = useState(() => {
    const m = mondayOf(today)
    const first = plan.weeks[0].start
    return m < first ? first : m
  })
  const [selected, setSelected] = useState<SessionMatch | null>(null)
  const sunday = addDaysIso(monday, 6)
  const week = plan.weeks.find((w) => w.start === monday)
  const { matches } = useMemo(() => {
    const sessions = plan.sessions.filter((s) => s.date >= monday && s.date <= sunday && (isTriathlon(s) || s.kind === 'race'))
    return matchSessions(sessions, activities.filter((a) => a.date >= monday && a.date <= sunday), today)
  }, [plan, activities, monday, sunday, today])
  const active = matches.filter((m) => !m.session.skipped)
  const per = (sport: Session['sport']) => active.filter((m) => m.session.sport === sport).reduce((a, m) => a + m.session.minutes, 0)
  const total = active.reduce((a, m) => a + m.session.minutes, 0)
  const move = (n: number) => {
    const next = addDaysIso(monday, n * 7)
    if (plan.weeks.some((w) => w.start === next)) setMonday(next)
  }
  const canAsk = sunday >= today

  return (
    <div className="stack">
      <h1 className="screen-title">Triatlo</h1>
      <section className="card">
        <div className="week-nav">
          <button onClick={() => move(-1)} aria-label="Semana anterior">‹</button>
          <div>
            <h2>Semana {week ? week.index + 1 : '–'} de {plan.weeks.length}</h2>
            <p className="muted small">{fmtDay(monday, { day: 'numeric', month: 'short' })} a {fmtDay(sunday, { day: 'numeric', month: 'short' })}{week && ` · ${PHASE_LABEL[week.phase]}${week.recovery ? ', semana leve' : ''}`}</p>
          </div>
          <button onClick={() => move(1)} aria-label="Semana seguinte">›</button>
        </div>
        <div className="chips">
          <span className="chip"><b>{fmtMinutes(total)}</b></span>
          <span className="chip">🏊 {fmtMinutes(per('swim'))}</span>
          <span className="chip">🚴 {fmtMinutes(per('bike') + per('brick') * 0.75)}</span>
          <span className="chip">🏃 {fmtMinutes(per('run') + per('brick') * 0.25)}</span>
        </div>
        {canAsk && (hasKey
          ? <button className="primary wide" disabled={busy} onClick={() => onAsk(monday)}>{busy ? 'O treinador está a pensar…' : '✨ Distribuir esta semana com IA'}</button>
          : <button className="wide" onClick={onSetupAi}>✨ Ligar o treinador IA</button>)}
        {error && <p className="small danger">{error}</p>}
        <p className="muted small">O ginásio e o futebol não aparecem aqui: estão no Calendário e o plano conta com eles.</p>
      </section>

      <ul className="upcoming tri-list">
        {active.length === 0 && <li className="muted small">Sem treinos de triatlo nesta semana.</li>}
        {active.map((m) => (
          <li key={m.session.id}>
            <button onClick={() => setSelected(m)}>
              <span className="up-day">{fmtDay(m.session.date, { weekday: 'short' }).replace('.', '')}<br /><span className="muted tiny">{m.session.start !== undefined ? toHHMM(m.session.start) : ''}</span></span>
              <span className="up-icon" aria-hidden>{SPORT_ICON[m.session.sport]}</span>
              <span className="up-title">{m.session.title}{m.session.key && <span className="key">chave</span>}{m.session.why && <span className="muted tiny tri-why">✨ {m.session.why}</span>}</span>
              <span className="up-meta">{fmtMinutes(m.session.minutes)}<br /><span className={`status ${STATUS[m.status].cls}`}>{STATUS[m.status].label}</span></span>
            </button>
          </li>
        ))}
      </ul>

      {selected && (
        <DetailSheet
          e={{ type: 'session', id: selected.session.id, date: selected.session.date, start: selected.session.start ?? 420, end: (selected.session.start ?? 420) + selected.session.minutes, m: selected }}
          profile={profile} today={today} onClose={() => setSelected(null)}
          onSkip={(id) => { onSkip(id); setSelected(null) }} onUnskip={(id) => { onUnskip(id); setSelected(null) }} onDone={onDone} />
      )}
    </div>
  )
}
