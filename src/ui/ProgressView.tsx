import { useMemo } from 'react'
import { Area, Bar, CartesianGrid, ComposedChart, Legend, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { addDaysIso, mondayOf } from '../domain/dates'
import { loadAlerts, loadSeries } from '../domain/load'
import type { Activity, Plan, Profile } from '../domain/types'
import { PHASE_LABEL, fmtDay, fmtMinutes } from './format'

interface Props {
  profile: Profile
  plan: Plan
  activities: Activity[]
  today: string
}

export function ProgressView({ profile, plan, activities, today }: Props) {
  // Começa 6 semanas antes do plano para a forma inicial refletir o treino anterior
  const earliest = activities.reduce((m, a) => (a.date < m ? a.date : m), plan.weeks[0].start)
  const from = earliest < addDaysIso(plan.weeks[0].start, -42) ? addDaysIso(plan.weeks[0].start, -42) : earliest
  const series = useMemo(() => loadSeries(activities, plan, from, profile.raceDate, today), [activities, plan, from, profile.raceDate, today])
  const alerts = useMemo(() => loadAlerts(series, activities, today), [series, activities, today])
  const now = series.find((p) => p.date === today)
  const idxToday = series.findIndex((p) => p.date === today)
  const weekAgo = idxToday >= 7 ? series[idxToday - 7] : undefined
  const delta = now && weekAgo ? now.ctl - weekAgo.ctl : 0
  const trendText = !now || activities.length === 0
    ? 'Ainda sem treinos registados.'
    : delta > 7 ? `Subiste ${delta.toFixed(0)} pontos esta semana. É demais: abranda um pouco.`
    : delta > 1 ? `Subiste ${delta.toFixed(0)} pontos esta semana. Estás no bom caminho.`
    : delta < -3 ? `Desceste ${Math.abs(delta).toFixed(0)} pontos esta semana. Normal numa semana leve.`
    : 'Estável esta semana.'
  const race = series.at(-1)

  const chartData = series
    .filter((p) => p.date >= plan.weeks[0].start)
    .map((p) => ({
      date: p.date,
      Forma: p.projected ? undefined : p.ctl,
      Fadiga: p.projected ? undefined : p.atl,
      Frescura: p.projected ? undefined : p.tsb,
      'Forma prevista': p.projected || p.date === today ? p.ctl : undefined,
      'Frescura prevista': p.projected || p.date === today ? p.tsb : undefined,
    }))

  const weekly = plan.weeks.map((w) => {
    const end = addDaysIso(w.start, 6)
    const planned = plan.sessions.filter((s) => !s.skipped && s.kind !== 'race' && s.date >= w.start && s.date <= end).reduce((a, s) => a + s.minutes, 0)
    const done = activities.filter((a) => a.date >= w.start && a.date <= end).reduce((a, x) => a + x.durationSec / 60, 0)
    return { week: `S${w.index + 1}`, start: w.start, phase: w.phase, Planeado: Math.round(planned / 6) / 10, Feito: w.start <= today ? Math.round(done / 6) / 10 : undefined }
  })

  const phases = plan.weeks.reduce<{ phase: string; weeks: number }[]>((acc, w) => {
    const last = acc.at(-1)
    if (last && last.phase === w.phase) last.weeks++
    else acc.push({ phase: w.phase, weeks: 1 })
    return acc
  }, [])
  const currentWeek = plan.weeks.find((w) => w.start === mondayOf(today))

  return (
    <div className="stack">
      <h1 className="screen-title">Progresso</h1>
      <section className="card fitness">
        <h2 className="eyebrow">A tua forma</h2>
        <div className="fitness-main">
          <b className="big-num">{now ? now.ctl.toFixed(0) : '–'}</b>
          <div>
            <p>{trendText}</p>
            <p className="muted small">{race ? `Se cumprires o plano, chegas à prova com forma ${race.ctl.toFixed(0)} e frescura ${race.tsb >= 0 ? '+' : ''}${race.tsb.toFixed(0)}.` : ''}</p>
          </div>
        </div>
        {activities.length === 0 && <p className="muted small">Importa os teus treinos para veres a tua forma real.</p>}
      </section>

      {alerts.length > 0 && (
        <section className="stack">
          {alerts.map((a) => (
            <div key={a.title} className={`alert alert-${a.level}`}><b>{a.title}</b><p>{a.detail}</p></div>
          ))}
        </section>
      )}

      <details className="card more">
        <summary>Ver gráficos e detalhes</summary>
        <div className="kpis">
          <Kpi label="Forma (CTL)" value={now?.ctl.toFixed(0) ?? '–'} hint="Média da carga dos últimos 42 dias" />
          <Kpi label="Fadiga (ATL)" value={now?.atl.toFixed(0) ?? '–'} hint="Média dos últimos 7 dias" />
          <Kpi label="Frescura (TSB)" value={now?.tsb.toFixed(0) ?? '–'} hint="Forma menos fadiga" />
          <Kpi label="No dia da prova" value={race ? `${race.ctl.toFixed(0)} / ${race.tsb >= 0 ? '+' : ''}${race.tsb.toFixed(0)}` : '–'} hint="Forma / frescura previstas" />
        </div>
      <section className="sub-section">
        <h2>Forma, fadiga e frescura</h2>
        <div className="chart">
          <ResponsiveContainer width="100%" height={280}>
            <ComposedChart data={chartData} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
              <CartesianGrid stroke="var(--grid)" vertical={false} />
              <XAxis dataKey="date" tickFormatter={(d) => fmtDay(d, { month: 'short' })} minTickGap={40} stroke="var(--muted)" fontSize={12} />
              <YAxis stroke="var(--muted)" fontSize={12} />
              <Tooltip labelFormatter={(d) => fmtDay(String(d), { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}
                formatter={(v) => (typeof v === 'number' ? v.toFixed(0) : v)}
                contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8 }} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <ReferenceLine y={0} stroke="var(--muted)" />
              <ReferenceLine x={today} stroke="var(--accent)" strokeDasharray="3 3" label={{ value: 'hoje', fill: 'var(--muted)', fontSize: 11 }} />
              <Area isAnimationActive={false} type="monotone" dataKey="Forma" stroke="var(--c-ctl)" fill="var(--c-ctl)" fillOpacity={0.15} dot={false} strokeWidth={2} />
              <Line isAnimationActive={false} type="monotone" dataKey="Fadiga" stroke="var(--c-atl)" dot={false} strokeWidth={1.5} />
              <Line isAnimationActive={false} type="monotone" dataKey="Frescura" stroke="var(--c-tsb)" dot={false} strokeWidth={1.5} />
              <Line isAnimationActive={false} type="monotone" dataKey="Forma prevista" stroke="var(--c-ctl)" strokeDasharray="5 4" dot={false} strokeWidth={2} />
              <Line isAnimationActive={false} type="monotone" dataKey="Frescura prevista" stroke="var(--c-tsb)" strokeDasharray="5 4" dot={false} strokeWidth={1.5} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        <p className="muted small">A forma deve subir de forma gradual (até 5 a 7 pontos por semana). No taper a fadiga desce e a frescura fica positiva para o dia da prova.</p>
      </section>

      <section className="sub-section">
        <h2>Fases do plano</h2>
        <div className="phase-strip">
          {phases.map((p, i) => (
            <div key={i} className={`phase-seg phase-${p.phase}`} style={{ flex: p.weeks }} title={`${PHASE_LABEL[p.phase as keyof typeof PHASE_LABEL]}: ${p.weeks} semanas`}>
              <span>{PHASE_LABEL[p.phase as keyof typeof PHASE_LABEL]}</span>
            </div>
          ))}
        </div>
        {currentWeek && <p className="muted small">Estás na semana {currentWeek.index + 1} de {plan.weeks.length}, fase de {PHASE_LABEL[currentWeek.phase].toLowerCase()}.</p>}
        <div className="chart">
          <ResponsiveContainer width="100%" height={220}>
            <ComposedChart data={weekly} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
              <CartesianGrid stroke="var(--grid)" vertical={false} />
              <XAxis dataKey="week" stroke="var(--muted)" fontSize={11} minTickGap={8} />
              <YAxis stroke="var(--muted)" fontSize={12} unit="h" />
              <Tooltip formatter={(v) => (typeof v === 'number' ? fmtMinutes(v * 60) : v)}
                contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8 }} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar isAnimationActive={false} dataKey="Planeado" fill="var(--c-plan)" radius={[3, 3, 0, 0]} />
              <Line isAnimationActive={false} dataKey="Feito" stroke="var(--c-done)" strokeWidth={2} dot={{ r: 2 }} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </section>
      </details>
    </div>
  )
}

function Kpi({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="kpi" title={hint}>
      <span className="muted small">{label}</span>
      <b>{value}</b>
      <span className="muted tiny">{hint}</span>
    </div>
  )
}
