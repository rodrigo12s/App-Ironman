import { useState } from 'react'
import { setDayAvailability, skipSession } from './domain/adapt'
import { today as todayIso } from './domain/dates'
import { computeTss } from './domain/load'
import { generatePlan } from './domain/plan'
import type { Plan, Profile } from './domain/types'
import { useAppState } from './store'
import { ActivitiesView } from './ui/ActivitiesView'
import { ProfileView } from './ui/ProfileView'
import { ProgressView } from './ui/ProgressView'
import { WeekView } from './ui/WeekView'

type Tab = 'week' | 'progress' | 'activities' | 'profile'

const TABS: { id: Tab; label: string }[] = [
  { id: 'week', label: 'Semana' },
  { id: 'progress', label: 'Progresso' },
  { id: 'activities', label: 'Treinos' },
  { id: 'profile', label: 'Perfil' },
]

export default function App() {
  const { state, update, replace, saveFailed } = useAppState()
  const [tab, setTab] = useState<Tab>(state.plan ? 'week' : 'profile')
  const [notice, setNotice] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const today = todayIso()
  const { profile, plan } = state

  function saveProfile(p: Profile, regenerate: boolean) {
    try {
      let nextPlan: Plan | null = plan
      if (regenerate || !plan) {
        const overrides = Object.fromEntries(Object.entries(plan?.dayOverrides ?? {}).filter(([d]) => d >= today))
        const fresh = generatePlan(p, overrides)
        // Mantém o histórico do plano anterior; o novo plano manda a partir de hoje
        const past = plan ? plan.sessions.filter((s) => s.date < today && s.date >= p.planStart) : []
        nextPlan = { ...fresh, sessions: [...past, ...fresh.sessions.filter((s) => s.date >= today || !plan)] }
      }
      update((s) => ({
        ...s,
        legacy: undefined,
        profile: p,
        plan: nextPlan,
        activities: s.activities.map((a) => ({ ...a, ...computeTss(a, p) })),
      }))
      setError(null)
      setNotice([regenerate || !plan ? 'Plano gerado. Começa pela semana atual.' : 'Testes e zonas guardados.'])
      if (regenerate || !plan) setTab('week')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Não foi possível gerar o plano.')
    }
  }

  function applyPlan(fn: (plan: Plan, profile: Profile) => { plan: Plan; changes: string[] }) {
    if (!plan || !profile) return
    const res = fn(plan, profile)
    update((s) => ({ ...s, plan: res.plan }))
    setNotice(res.changes)
  }

  return (
    <div className="app">
      <header className="top">
        <div className="brand">
          <span className="logo" aria-hidden>Ⅿ</span>
          <div>
            <h1>{profile?.raceName || 'O meu Ironman'}</h1>
            {profile && <p className="muted small">{new Date(profile.raceDate + 'T12:00:00').toLocaleDateString('pt-PT', { day: 'numeric', month: 'long', year: 'numeric' })}</p>}
          </div>
        </div>
        <nav className="tabs" role="tablist">
          {TABS.map((t) => (
            <button key={t.id} role="tab" aria-selected={tab === t.id} className={tab === t.id ? 'active' : ''}
              disabled={t.id !== 'profile' && t.id !== 'activities' && !plan} onClick={() => setTab(t.id)}>{t.label}</button>
          ))}
        </nav>
      </header>

      <main>
        {saveFailed && <div className="alert alert-danger"><b>Não foi possível guardar neste browser.</b><p>Exporta uma cópia de segurança em Treinos para não perderes os dados.</p></div>}
        {error && <div className="alert alert-danger"><b>{error}</b></div>}
        {notice.length > 0 && (
          <div className="alert alert-info notice">
            <div>{notice.map((n, i) => <p key={i}>{n}</p>)}</div>
            <button className="link" onClick={() => setNotice([])} aria-label="Fechar">✕</button>
          </div>
        )}

        {tab === 'profile' && !profile && state.legacy && (
          <div className="alert alert-info notice"><div><p><b>A app agora começa por um questionário.</b> Guardámos a tua prova, os testes e os treinos. Responde às perguntas para o plano se adaptar ao teu horário.</p></div></div>
        )}
        {tab === 'profile' && <ProfileView profile={profile} legacy={state.legacy} hasPlan={!!plan} onSave={saveProfile} />}
        {tab === 'week' && plan && profile && (
          <WeekView profile={profile} plan={plan} activities={state.activities} today={today}
            onSkip={(id) => applyPlan((pl, pr) => skipSession(pl, pr, id, today))}
            onUnskip={(id) => applyPlan((pl) => ({ plan: { ...pl, sessions: pl.sessions.map((s) => (s.id === id ? { ...s, skipped: false } : s)) }, changes: ['Sessão reposta no plano.'] }))}
            onDayMinutes={(d, m) => applyPlan((pl, pr) => setDayAvailability(pl, pr, d, m, today))} />
        )}
        {tab === 'progress' && plan && profile && <ProgressView profile={profile} plan={plan} activities={state.activities} today={today} />}
        {tab === 'activities' && (
          <ActivitiesView state={state}
            onAdd={(acts) => { update((s) => ({ ...s, activities: [...s.activities, ...acts] })) }}
            onDelete={(id) => update((s) => ({ ...s, activities: s.activities.filter((a) => a.id !== id) }))}
            onRestore={(s) => { replace(s); setTab(s.plan ? 'week' : 'profile') }} />
        )}
      </main>
    </div>
  )
}
