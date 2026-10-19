import { useMemo, useState } from 'react'
import { addDaysIso, daysBetween, mondayOf } from '../domain/dates'
import { matchSessions, type SessionMatch } from '../domain/compliance'
import { loadAlerts, loadSeries } from '../domain/load'
import { toHHMM } from '../domain/schedule'
import type { Activity, Plan, Profile, Session } from '../domain/types'
import { DetailSheet } from './CalendarView'
import { PHASE_LABEL, SPORT_ICON, fmtDay, fmtMinutes } from './format'

interface Props {
  profile: Profile
  plan: Plan
  activities: Activity[]
  today: string
  onSkip: (id: string) => void
  onUnskip: (id: string) => void
  onDone: (s: Session) => void
  onOpenWeek: () => void
  onOpenProgress: () => void
}

/** Uma frase simples sobre o objetivo da sessão */
export function purpose(s: Session): string {
  switch (s.kind) {
    case 'long': return 'Ganhar resistência a um ritmo confortável, em que consegues falar.'
    case 'intervals': return 'Séries para melhorar o ritmo. Respeita as pausas.'
    case 'tempo': return 'Ritmo controlado, um pouco desconfortável mas sustentável.'
    case 'recovery': return 'Recuperar. Muito leve, sem pressa.'
    case 'test': return 'Medir o teu nível para acertar as zonas. Vai a fundo.'
    case 'brick': return 'Habituar as pernas a correr logo a seguir à bicicleta.'
    case 'strength': return 'Prevenir lesões e ganhar força para aguentar o volume.'
    case 'fixed': return 'Do teu horário. Conta como carga no plano.'
    case 'race': return 'É hoje. Começa devagar e segue o plano de nutrição.'
    default: return 'Treino fácil para construir a base aeróbia.'
  }
}

/** Intensidade principal da sessão, em palavras */
export function effort(s: Session): string {
  if (s.kind === 'fixed' || s.kind === 'race') return ''
  // Pelo tempo passado em cada zona: umas acelerações curtas não tornam a sessão intensa
  const share = (z: number) => s.steps.filter((x) => x.zone >= z).reduce((a, x) => a + x.minutes, 0) / s.minutes
  if (share(4) >= 0.15) return 'Intenso'
  if (share(3) >= 0.2) return 'Moderado'
  return 'Fácil'
}

export function TodayView({ profile, plan, activities, today, onSkip, onUnskip, onDone, onOpenWeek, onOpenProgress }: Props) {
  const [selected, setSelected] = useState<SessionMatch | null>(null)
  const monday = mondayOf(today)
  const sunday = addDaysIso(monday, 6)
  const horizon = addDaysIso(today, 4)

  const { week, upcoming, todays } = useMemo(() => {
    const range = plan.sessions.filter((s) => s.date >= monday && s.date <= (horizon > sunday ? horizon : sunday))
    const { matches } = matchSessions(range, activities.filter((a) => a.date >= monday), today)
    return {
      week: matches.filter((m) => m.session.date <= sunday && !m.session.skipped && m.session.kind !== 'race'),
      todays: matches.filter((m) => m.session.date === today && !m.session.skipped),
      upcoming: matches.filter((m) => m.session.date > today && m.session.date <= horizon && !m.session.skipped),
    }
  }, [plan, activities, today, monday, sunday, horizon])

  const alerts = useMemo(() => {
    const from = addDaysIso(today, -60)
    return loadAlerts(loadSeries(activities, plan, from, today, today), activities, today)
  }, [activities, plan, today])

  const currentWeek = plan.weeks.find((w) => w.start === monday)
  const done = week.filter((m) => m.status === 'done' || m.status === 'partial').length
  const due = week.length
  const toRace = daysBetween(today, profile.raceDate)
  const missedKey = week.find((m) => m.status === 'missed' && m.session.key)
  const nextSession = todays.every((m) => m.session.kind === 'fixed') ? upcoming.find((m) => m.session.kind !== 'fixed') : undefined

  return (
    <div className="today">
      <header className="hello">
        <div>
          <p className="muted">{fmtDay(today, { weekday: 'long', day: 'numeric', month: 'long' })}</p>
          <h1>{profile.name ? `Olá, ${profile.name.split(' ')[0]}` : 'Olá'}</h1>
        </div>
        {toRace >= 0 && (
          <div className="countdown" title={profile.raceName}>
            <b>{toRace}</b><span>dias até à prova</span>
          </div>
        )}
      </header>

      <section className="hero-block" aria-label="Treino de hoje">
        <h2 className="eyebrow">Hoje</h2>
        {todays.every((m) => m.session.kind === 'fixed') && (
          <div className="hero rest">
            <p className="hero-title">Dia de descanso</p>
            <p>Descansar também é treino. Dorme bem e come com calma.</p>
            {nextSession && (
              <button className="next-link" onClick={() => setSelected(nextSession)}>
                Próximo: {SPORT_ICON[nextSession.session.sport]} {nextSession.session.title}, {fmtDay(nextSession.session.date, { weekday: 'long' }).toLowerCase()}
              </button>
            )}
          </div>
        )}
        {todays.filter((m) => m.session.kind !== 'fixed').map((m) => (
          <HeroCard key={m.session.id} m={m} today={today} onOpen={() => setSelected(m)} onDone={onDone} />
        ))}
        {todays.filter((m) => m.session.kind === 'fixed').map((m) => (
          <button key={m.session.id} className="fixed-line" onClick={() => setSelected(m)}>
            <span aria-hidden>{SPORT_ICON[m.session.sport]}</span>
            <span><b>{m.session.title}</b> <span className="muted">{m.session.start !== undefined && `${toHHMM(m.session.start)} · `}{fmtMinutes(m.session.minutes)}</span></span>
            <span className="muted small">do teu horário</span>
          </button>
        ))}
      </section>

      {missedKey && (
        <button className="nudge" onClick={() => setSelected(missedKey)}>
          <b>Falhaste "{missedKey.session.title}"?</b>
          <span>Toca para a mudar para outro dia desta semana.</span>
        </button>
      )}
      {alerts.length > 0 && (
        <button className={`nudge nudge-${alerts[0].level}`} onClick={onOpenProgress}>
          <b>{alerts[0].title}</b>
          <span>Ver detalhes no Progresso.</span>
        </button>
      )}

      <section className="week-sum" aria-label="Esta semana">
        <div className="week-sum-top">
          <h2 className="eyebrow">Esta semana</h2>
          {currentWeek && <span className="muted small">{PHASE_LABEL[currentWeek.phase]}{currentWeek.recovery ? ', semana leve' : ''}</span>}
        </div>
        <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={due} aria-valuenow={done}>
          <span style={{ width: `${due ? (done / due) * 100 : 0}%` }} />
        </div>
        <p className="small"><b>{done} de {due}</b> treinos feitos</p>
      </section>

      {upcoming.length > 0 && (
        <section aria-label="Próximos dias">
          <h2 className="eyebrow">Próximos dias</h2>
          <ul className="upcoming">
            {upcoming.map((m) => (
              <li key={m.session.id}>
                <button onClick={() => setSelected(m)}>
                  <span className="up-day">{fmtDay(m.session.date, { weekday: 'short' }).replace('.', '')}</span>
                  <span className="up-icon" aria-hidden>{SPORT_ICON[m.session.sport]}</span>
                  <span className="up-title">{m.session.title}</span>
                  <span className="up-meta">{fmtMinutes(m.session.minutes)}</span>
                  <span className="chev" aria-hidden>›</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <button className="row-link" onClick={onOpenWeek}>Ver a semana completa <span className="chev" aria-hidden>›</span></button>

      {selected && (
        <DetailSheet
          e={{ type: 'session', id: selected.session.id, date: selected.session.date, start: selected.session.start ?? 420, end: (selected.session.start ?? 420) + selected.session.minutes, m: selected }}
          profile={profile} today={today} onClose={() => setSelected(null)}
          onSkip={(id) => { onSkip(id); setSelected(null) }} onUnskip={(id) => { onUnskip(id); setSelected(null) }} onDone={onDone} />
      )}
    </div>
  )
}

function HeroCard({ m, today, onOpen, onDone }: { m: SessionMatch; today: string; onOpen: () => void; onDone: (s: Session) => void }) {
  const s = m.session
  const isDone = m.status === 'done' || m.status === 'partial' || m.status === 'off'
  const level = effort(s)
  return (
    <div className={`hero ${isDone ? 'is-done' : ''} ${s.kind === 'fixed' ? 'is-fixed' : ''}`}>
      <button className="hero-main" onClick={onOpen}>
        <span className="hero-icon" aria-hidden>{SPORT_ICON[s.sport]}</span>
        <span className="hero-text">
          <span className="hero-title">{s.title}</span>
          <span className="hero-meta">
            {s.start !== undefined && `${toHHMM(s.start)} · `}{fmtMinutes(s.minutes)}{level && ` · ${level}`}
          </span>
          <span className="hero-purpose">{purpose(s)}</span>
        </span>
      </button>
      <div className="hero-actions">
        {isDone
          ? <span className="done-badge">✓ Feito</span>
          : <>
              <button className="hero-btn" onClick={onOpen}>Ver treino</button>
              {s.kind !== 'fixed' && s.kind !== 'race' && s.date <= today && <button className="hero-btn ghost" onClick={() => onDone(s)}>Já fiz</button>}
            </>}
      </div>
    </div>
  )
}
