import { useEffect, useState } from 'react'
import { setDayAvailability, skipSession } from './domain/adapt'
import { today as todayIso } from './domain/dates'
import { computeTss } from './domain/load'
import { generatePlan } from './domain/plan'
import type { Activity, Plan, Profile, Session } from './domain/types'
import { useAppState } from './store'
import { ActivitiesView } from './ui/ActivitiesView'
import { CalendarView } from './ui/CalendarView'
import { ProfileView } from './ui/ProfileView'
import { ProgressView } from './ui/ProgressView'
import { TodayView } from './ui/TodayView'
import { WeekView } from './ui/WeekView'

type Tab = 'today' | 'calendar' | 'progress' | 'more'
type Page = null | 'week' | 'activities' | 'profile' | 'tests' | 'backup'

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: 'today', label: 'Hoje', icon: '◉' },
  { id: 'calendar', label: 'Calendário', icon: '▦' },
  { id: 'progress', label: 'Progresso', icon: '↗' },
  { id: 'more', label: 'Mais', icon: '≡' },
]

const PAGE_TITLE: Record<Exclude<Page, null>, string> = {
  week: 'Semana',
  activities: 'Treinos importados',
  profile: 'Perfil e horário',
  tests: 'Testes e zonas',
  backup: 'Cópia de segurança',
}

export default function App() {
  const { state, update, replace, saveFailed } = useAppState()
  const [tab, setTab] = useState<Tab>('today')
  const [page, setPage] = useState<Page>(null)
  const [toast, setToast] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const today = todayIso()
  const { profile, plan } = state

  useEffect(() => {
    if (toast.length === 0) return
    const t = setTimeout(() => setToast([]), 7000)
    return () => clearTimeout(t)
  }, [toast])
  useEffect(() => { window.scrollTo(0, 0) }, [tab, page])

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
      update((s) => ({ ...s, legacy: undefined, profile: p, plan: nextPlan, activities: s.activities.map((a) => ({ ...a, ...computeTss(a, p) })) }))
      setError(null)
      setToast([regenerate || !plan ? 'O teu plano está pronto.' : 'Guardado.'])
      setPage(null)
      setTab('today')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Não foi possível criar o plano.')
    }
  }

  function applyPlan(fn: (plan: Plan, profile: Profile) => { plan: Plan; changes: string[] }) {
    if (!plan || !profile) return
    const res = fn(plan, profile)
    update((s) => ({ ...s, plan: res.plan }))
    setToast(res.changes)
  }

  /** "Já fiz": regista a sessão como feita, com a duração e a carga planeadas */
  function markDone(s: Session) {
    const base = { date: s.date, startTime: `${s.date}T12:00:00.000Z`, source: 'manual' as const, tssMethod: 'estimate' as const, name: s.title }
    const acts: Activity[] = []
    if (s.sport === 'brick') {
      const run = s.steps.filter((x) => !x.label.toLowerCase().startsWith('bicicleta')).reduce((a, x) => a + x.minutes, 0)
      const share = run / s.minutes
      acts.push({ ...base, id: `done-${s.id}-b`, sport: 'bike', durationSec: (s.minutes - run) * 60, tss: Math.round(s.plannedTss * (1 - share)) })
      acts.push({ ...base, id: `done-${s.id}-r`, sport: 'run', durationSec: run * 60, tss: Math.round(s.plannedTss * share) })
    } else {
      acts.push({ ...base, id: `done-${s.id}`, sport: s.sport, durationSec: s.minutes * 60, tss: s.plannedTss })
    }
    update((st) => ({ ...st, activities: [...st.activities.filter((a) => !acts.some((x) => x.id === a.id)), ...acts] }))
    setToast([`"${s.title}" registado como feito.`])
  }

  const unskip = (id: string) => applyPlan((pl) => ({ plan: { ...pl, sessions: pl.sessions.map((s) => (s.id === id ? { ...s, skipped: false } : s)) }, changes: ['Sessão reposta no plano.'] }))
  const skip = (id: string) => applyPlan((pl, pr) => skipSession(pl, pr, id, today))

  const banners = (
    <>
      {saveFailed && <div className="alert alert-danger"><b>Não foi possível guardar neste browser.</b><p>Em Mais, Cópia de segurança, guarda uma cópia para não perderes os dados.</p></div>}
      {error && <div className="alert alert-danger"><b>{error}</b></div>}
    </>
  )

  // Sem plano: só o questionário, sem navegação
  if (!plan || !profile) {
    return (
      <div className="app onboarding">
        <header className="ob-head">
          <span className="logo" aria-hidden>Ⅿ</span>
          <div>
            <h1>O meu Ironman</h1>
            <p className="muted small">Responde a umas perguntas e o plano adapta-se a ti.</p>
          </div>
        </header>
        {banners}
        {state.legacy && <div className="alert alert-info"><p>Guardámos a tua prova, os testes e os treinos. Só falta responder ao questionário.</p></div>}
        <ProfileView profile={profile} legacy={state.legacy} hasPlan={false} onSave={saveProfile} />
        <Toast items={toast} onClose={() => setToast([])} />
      </div>
    )
  }

  return (
    <div className="app">
      {page && (
        <header className="page-head">
          <button className="back" onClick={() => setPage(null)} aria-label="Voltar">‹ Voltar</button>
          <h1>{PAGE_TITLE[page]}</h1>
        </header>
      )}
      <main>
        {banners}
        {page === 'week' && (
          <WeekView profile={profile} plan={plan} activities={state.activities} today={today} onSkip={skip} onUnskip={unskip}
            onDayMinutes={(d, m) => applyPlan((pl, pr) => setDayAvailability(pl, pr, d, m, today))} />
        )}
        {page === 'activities' && (
          <ActivitiesView section="activities" state={state}
            onAdd={(acts) => update((s) => ({ ...s, activities: [...s.activities, ...acts] }))}
            onDelete={(id) => update((s) => ({ ...s, activities: s.activities.filter((a) => a.id !== id) }))}
            onRestore={replace} />
        )}
        {page === 'backup' && (
          <ActivitiesView section="backup" state={state} onAdd={() => {}} onDelete={() => {}}
            onRestore={(s) => { replace(s); setPage(null); setTab('today') }} />
        )}
        {page === 'profile' && <ProfileView profile={profile} hasPlan initialStep={0} onSave={saveProfile} />}
        {page === 'tests' && <ProfileView profile={profile} hasPlan initialStep={5} onSave={saveProfile} />}

        {!page && tab === 'today' && (
          <TodayView profile={profile} plan={plan} activities={state.activities} today={today}
            onSkip={skip} onUnskip={unskip} onDone={markDone} onOpenWeek={() => setPage('week')} onOpenProgress={() => setTab('progress')} />
        )}
        {!page && tab === 'calendar' && (
          <CalendarView profile={profile} plan={plan} activities={state.activities} today={today} onSkip={skip} onUnskip={unskip} onDone={markDone} />
        )}
        {!page && tab === 'progress' && <ProgressView profile={profile} plan={plan} activities={state.activities} today={today} />}
        {!page && tab === 'more' && (
          <div className="stack">
            <h1 className="screen-title">Mais</h1>
            <ul className="menu">
              <MenuItem icon="⤓" title="Importar treinos" hint="Ficheiros .FIT do relógio ou registo à mão" onClick={() => setPage('activities')} />
              <MenuItem icon="🗓" title="Perfil e horário" hint="Questionário, aulas, ginásio e futebol" onClick={() => setPage('profile')} />
              <MenuItem icon="♥" title="Testes e zonas" hint="FTP, limiar, CSS e zonas de treino" onClick={() => setPage('tests')} />
              <MenuItem icon="⎘" title="Cópia de segurança" hint="Guardar ou restaurar os teus dados" onClick={() => setPage('backup')} />
            </ul>
            <p className="muted small center">{profile.raceName || 'Ironman'} · {new Date(profile.raceDate + 'T12:00:00').toLocaleDateString('pt-PT', { day: 'numeric', month: 'long', year: 'numeric' })}</p>
          </div>
        )}
      </main>

      <Toast items={toast} onClose={() => setToast([])} />

      <nav className="bottom-nav" aria-label="Navegação principal">
        {TABS.map((t) => (
          <button key={t.id} className={!page && tab === t.id ? 'active' : ''} aria-current={!page && tab === t.id ? 'page' : undefined}
            onClick={() => { setTab(t.id); setPage(null) }}>
            <span className="nav-icon" aria-hidden>{t.icon}</span>
            <span>{t.label}</span>
          </button>
        ))}
      </nav>
    </div>
  )
}

function MenuItem({ icon, title, hint, onClick }: { icon: string; title: string; hint: string; onClick: () => void }) {
  return (
    <li>
      <button onClick={onClick}>
        <span className="menu-icon" aria-hidden>{icon}</span>
        <span className="menu-text"><b>{title}</b><span className="muted small">{hint}</span></span>
        <span className="chev" aria-hidden>›</span>
      </button>
    </li>
  )
}

function Toast({ items, onClose }: { items: string[]; onClose: () => void }) {
  if (items.length === 0) return null
  return (
    <div className="toast" role="status">
      <div>{items.map((n, i) => <p key={i}>{n}</p>)}</div>
      <button className="link" onClick={onClose} aria-label="Fechar">✕</button>
    </div>
  )
}
