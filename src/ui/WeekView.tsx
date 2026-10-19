import { useMemo, useState } from 'react'
import { addDaysIso, daysBetween, mondayOf } from '../domain/dates'
import { complianceRate, matchSessions, type SessionMatch } from '../domain/compliance'
import { dayCapacity } from '../domain/plan'
import { commitmentsOn, toHHMM } from '../domain/schedule'
import type { Activity, Plan, Profile, Session, Step } from '../domain/types'
import { cssPer100, formatPace, ftp, hrZones, paceZones, powerZones, runThresholdPace } from '../domain/zones'
import { PHASE_LABEL, SPORT_ICON, SPORT_LABEL, fmtDay, fmtMinutes } from './format'

interface Props {
  profile: Profile
  plan: Plan
  activities: Activity[]
  today: string
  onSkip: (id: string) => void
  onDayMinutes: (date: string, minutes: number) => void
  onUnskip: (id: string) => void
}

export const STATUS: Record<SessionMatch['status'], { label: string; cls: string }> = {
  planned: { label: 'Planeada', cls: 'st-planned' },
  today: { label: 'Hoje', cls: 'st-today' },
  done: { label: 'Cumprida', cls: 'st-done' },
  partial: { label: 'Parcial', cls: 'st-partial' },
  off: { label: 'Muito diferente', cls: 'st-off' },
  missed: { label: 'Por fazer', cls: 'st-missed' },
  skipped: { label: 'Fora do plano', cls: 'st-skipped' },
}

export function WeekView({ profile, plan, activities, today, onSkip, onDayMinutes, onUnskip }: Props) {
  const [weekStart, setWeekStart] = useState(() => {
    const m = mondayOf(today)
    const first = plan.weeks[0].start
    const last = plan.weeks.at(-1)!.start
    return m < first ? first : m > last ? last : m
  })
  const [editingDay, setEditingDay] = useState<string | null>(null)
  const [dayMinutes, setDayMinutes] = useState(0)

  const week = plan.weeks.find((w) => w.start === weekStart)
  const days = Array.from({ length: 7 }, (_, i) => addDaysIso(weekStart, i))
  const weekSessions = plan.sessions.filter((s) => s.date >= weekStart && s.date <= days[6])
  const weekActs = activities.filter((a) => a.date >= weekStart && a.date <= days[6])
  const { matches, unplanned } = useMemo(() => matchSessions(weekSessions, weekActs, today), [weekSessions, weekActs, today])
  const rate = complianceRate(matches)
  const plannedMin = weekSessions.filter((s) => !s.skipped && s.kind !== 'race').reduce((a, s) => a + s.minutes, 0)
  const doneMin = weekActs.reduce((a, x) => a + x.durationSec / 60, 0)
  const toRace = daysBetween(today, profile.raceDate)

  const move = (n: number) => {
    const next = addDaysIso(weekStart, n * 7)
    if (plan.weeks.some((w) => w.start === next)) setWeekStart(next)
  }

  return (
    <div className="stack">
      <section className="card week-head">
        <div className="week-nav">
          <button onClick={() => move(-1)} aria-label="Semana anterior">‹</button>
          <div>
            <h2>Semana {week ? week.index + 1 : '–'} de {plan.weeks.length}</h2>
            <p className="muted">{fmtDay(weekStart, { day: 'numeric', month: 'short' })} a {fmtDay(days[6], { day: 'numeric', month: 'short' })}</p>
          </div>
          <button onClick={() => move(1)} aria-label="Semana seguinte">›</button>
        </div>
        <div className="chips">
          {week && <span className={`chip phase-${week.phase}`}>{PHASE_LABEL[week.phase]}{week.recovery ? ' · descarga' : ''}</span>}
          <span className="chip">Planeado {fmtMinutes(plannedMin)}</span>
          <span className="chip">Feito {fmtMinutes(doneMin)}</span>
          {rate !== null && <span className="chip">Cumprimento {Math.round(rate * 100)}%</span>}
          {toRace >= 0 && <span className="chip race-chip">Faltam {toRace} dias</span>}
        </div>
        {mondayOf(today) !== weekStart && plan.weeks.some((w) => w.start === mondayOf(today)) && (
          <button className="link" onClick={() => setWeekStart(mondayOf(today))}>Voltar a esta semana</button>
        )}
      </section>

      {days.map((d) => {
        const ms = matches.filter((m) => m.session.date === d)
        const classes = commitmentsOn(profile.schedule, d).filter((c) => c.kind !== 'gym' && c.kind !== 'football')
        const extra = unplanned.filter((a) => a.date === d)
        const cap = dayCapacity(profile, plan, d)
        const overridden = plan.dayOverrides[d] !== undefined
        const editable = d >= today && d < profile.raceDate
        return (
          <section key={d} className={`day ${d === today ? 'is-today' : ''}`}>
            <header>
              <h3>{fmtDay(d, { weekday: 'long', day: 'numeric', month: 'short' })}</h3>
              <span className="muted small">{cap ? `${fmtMinutes(cap)} disponíveis${overridden ? ' (alterado)' : ''}` : 'Descanso'}</span>
              {editable && editingDay !== d && (
                <button className="link small" onClick={() => { setEditingDay(d); setDayMinutes(cap) }}>Mudar tempo</button>
              )}
            </header>
            {editingDay === d && (
              <form className="inline-form" onSubmit={(e) => { e.preventDefault(); onDayMinutes(d, dayMinutes); setEditingDay(null) }}>
                <label>Neste dia só tenho
                  <input type="number" min={0} step={5} value={dayMinutes} onChange={(e) => setDayMinutes(Number(e.target.value) || 0)} autoFocus /> min
                </label>
                <button className="primary small" type="submit">Reorganizar</button>
                <button type="button" className="small" onClick={() => setEditingDay(null)}>Cancelar</button>
              </form>
            )}
            {classes.length > 0 && (
              <p className="muted small day-commitments">{classes.map((c) => `${c.title} ${toHHMM(c.start)}–${toHHMM(c.end)}`).join(' · ')}</p>
            )}
            {ms.length === 0 && extra.length === 0 && <p className="muted small">Sem treino. Descansa bem.</p>}
            {ms.map((m) => (
              <SessionCard key={m.session.id} m={m} profile={profile} today={today} onSkip={onSkip} onUnskip={onUnskip} />
            ))}
            {extra.map((a) => (
              <div key={a.id} className="session extra">
                <div className="s-main">
                  <span className="icon">{SPORT_ICON[a.sport]}</span>
                  <div><b>{a.name || SPORT_LABEL[a.sport]}</b><div className="muted small">Fora do plano · {fmtMinutes(a.durationSec / 60)} · {a.tss} TSS</div></div>
                </div>
              </div>
            ))}
          </section>
        )
      })}
    </div>
  )
}

function SessionCard({ m, profile, today, onSkip, onUnskip }: { m: SessionMatch; profile: Profile; today: string; onSkip: (id: string) => void; onUnskip: (id: string) => void }) {
  const [open, setOpen] = useState(false)
  const s = m.session
  const st = STATUS[m.status]
  return (
    <div className={`session ${s.skipped ? 'is-skipped' : ''} ${s.kind === 'race' ? 'is-race' : ''} ${s.kind === 'fixed' ? 'is-fixed' : ''}`}>
      <button className="s-main" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className="icon">{SPORT_ICON[s.sport]}</span>
        <div className="s-text">
          <b>{s.title}</b>{s.key && <span className="key" title="Sessão-chave">chave</span>}
          <div className="muted small">
            {s.start !== undefined && `${toHHMM(s.start)} · `}{s.kind === 'fixed' ? 'Do teu horário' : SPORT_LABEL[s.sport]} · {fmtMinutes(s.minutes)} · {s.plannedTss} TSS
            {s.movedFrom && ` · movida de ${fmtDay(s.movedFrom)}`}
          </div>
        </div>
        <span className={`status ${st.cls}`}>{st.label}{m.ratio !== null && ` ${Math.round(m.ratio * 100)}%`}</span>
      </button>
      {open && <div className="s-detail"><SessionDetail m={m} profile={profile} today={today} onSkip={onSkip} onUnskip={onUnskip} /></div>}
    </div>
  )
}

/** Passos com alvos, o que foi feito e as ações de uma sessão */
export function SessionDetail({ m, profile, today, onSkip, onUnskip }: { m: SessionMatch; profile: Profile; today: string; onSkip: (id: string) => void; onUnskip: (id: string) => void }) {
  const s = m.session
  const canSkip = !s.skipped && m.activities.length === 0 && s.kind !== 'race' && s.kind !== 'fixed' && s.date >= addDaysIso(today, -6)
  return (
    <>
      <ol className="steps">
        {s.steps.map((step, i) => (
          <li key={i}><span className={`z z${step.zone}`}>Z{step.zone}</span> {step.label} <span className="muted">· {fmtMinutes(step.minutes)}</span>
            <span className="target">{target(step, s, profile)}</span></li>
        ))}
      </ol>
      {m.activities.map((a) => (
        <p key={a.id} className="small">Feito: {SPORT_LABEL[a.sport]} {fmtMinutes(a.durationSec / 60)}{a.distanceM ? ` · ${(a.distanceM / 1000).toFixed(1)} km` : ''} · {a.tss} TSS</p>
      ))}
      <div className="actions">
        {canSkip && <button className="small" onClick={() => onSkip(s.id)}>Não consegui fazer</button>}
        {s.skipped && !s.movedFrom && <button className="small" onClick={() => onUnskip(s.id)}>Repor no plano</button>}
      </div>
    </>
  )
}

/** Alvo concreto (W, ritmo ou FC) para a zona de um passo */
function target(step: Step, s: Session, profile: Profile): string {
  const t = profile.tests
  const label = step.label.toLowerCase()
  const sport = s.sport === 'brick' ? (label.startsWith('bicicleta') ? 'bike' : 'run') : s.sport
  const z = step.zone - 1
  if (sport === 'bike') {
    const f = ftp(t)
    if (f) { const zone = powerZones(f)[z]; return zone.high ? `${zone.low}–${zone.high} W` : `> ${zone.low} W` }
    if (t.bikeLthr) { const zone = hrZones(t.bikeLthr, 'bike')[z]; return zone.high ? `${zone.low}–${zone.high} bpm` : `> ${zone.low} bpm` }
  }
  if (sport === 'run') {
    const thr = runThresholdPace(t)
    if (thr) { const zone = paceZones(thr, 'run')[z]; return paceRange(zone.low, zone.high, '/km') }
    if (t.runLthr) { const zone = hrZones(t.runLthr, 'run')[z]; return zone.high ? `${zone.low}–${zone.high} bpm` : `> ${zone.low} bpm` }
  }
  if (sport === 'swim') {
    const css = cssPer100(t)
    if (css) { const zone = paceZones(css, 'swim')[z]; return paceRange(zone.low, zone.high, '/100 m') }
  }
  return ''
}

const paceRange = (low: number, high: number | null, unit: string) =>
  high === null ? `mais lento que ${formatPace(low)}${unit}` : low === 0 ? `mais rápido que ${formatPace(high)}${unit}` : `${formatPace(low)}–${formatPace(high)}${unit}`
