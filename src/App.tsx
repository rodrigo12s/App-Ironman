import { useEffect, useRef, useState } from 'react'
import { reflowConflicts, setDayAvailability, skipSession, syncFixed } from './domain/adapt'
import { today as todayIso } from './domain/dates'
import { computeTss } from './domain/load'
import { generatePlan } from './domain/plan'
import type { Activity, AppState, Commitment, CommitmentEdit, Plan, Profile, Session } from './domain/types'
import { currentToken, ensureTrainingCalendar, fetchCommitments, importSummary, requestToken, revoke, syncTrainings } from './google/gcal'
import { getKey, setKey } from './ai/key'
import { useAppState } from './store'
import { ActivitiesView } from './ui/ActivitiesView'
import { CalendarView } from './ui/CalendarView'
import { CoachView } from './ui/CoachView'
import { GoogleView } from './ui/GoogleView'
import { TriathlonView } from './ui/TriathlonView'
import { ProfileView } from './ui/ProfileView'
import { ProgressView } from './ui/ProgressView'
import { TodayView } from './ui/TodayView'
import { WeekView } from './ui/WeekView'

type Tab = 'today' | 'triathlon' | 'calendar' | 'progress' | 'more'
type Page = null | 'week' | 'activities' | 'profile' | 'tests' | 'backup' | 'google' | 'coach'

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: 'today', label: 'Hoje', icon: '◉' },
  { id: 'triathlon', label: 'Triatlo', icon: '⚑' },
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
  google: 'Google Calendar',
  coach: 'Treinador IA',
}

export default function App() {
  const { state, update, replace, saveFailed } = useAppState()
  const [tab, setTab] = useState<Tab>('today')
  const [page, setPage] = useState<Page>(null)
  const [toast, setToast] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const [gBusy, setGBusy] = useState(false)
  const [pending, setPending] = useState<{ plan: Plan; changes: string[]; summary?: string } | null>(null)
  const [aiKey, setAiKey] = useState(() => getKey())
  const [aiBusy, setAiBusy] = useState(false)
  const [aiError, setAiError] = useState<string | null>(null)
  const [gError, setGError] = useState<string | null>(null)
  const today = todayIso()
  const { profile, plan } = state
  const syncing = useRef(false)

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

  /** O treinador IA propõe a distribuição da semana; só muda depois de aceitares */
  async function askAi(monday: string) {
    if (!profile || !plan || !aiKey) return
    setAiBusy(true)
    setAiError(null)
    try {
      // O SDK da Anthropic só é carregado quando se usa o treinador
      const { applyProposal, askCoach, weekContext } = await import('./ai/coach')
      const { context, movable, days } = weekContext(profile, plan, state.activities, monday, today)
      if (movable.length === 0) { setAiError('Não há treinos por fazer nesta semana.'); return }
      const proposal = await askCoach(aiKey, context)
      const r = applyProposal(plan, profile, movable, days, proposal)
      setPending({ plan: r.plan, changes: r.changes.length ? r.changes : ['A semana já estava bem distribuída: fica tudo igual.'], summary: r.summary })
    } catch (e) {
      setAiError(e instanceof Error ? e.message : 'Não foi possível falar com o treinador.')
    } finally {
      setAiBusy(false)
    }
  }

  /**
   * Os teus eventos mudaram: se algum treino ficou por cima de um evento,
   * mostra os novos horários propostos. Nada muda sem aceitares.
   */
  function propose(pl: Plan, pr: Profile): boolean {
    // O ginásio e o futebol acompanham logo os eventos; os outros treinos esperam pela tua resposta
    const base = syncFixed(pl, pr, today)
    if (base !== pl) update((s) => ({ ...s, plan: base }))
    const r = reflowConflicts(base, pr, today)
    if (r.changes.length) setPending(r)
    return r.changes.length > 0
  }

  function changeCommitments(fn: (list: Commitment[]) => Commitment[], edit?: { id: string; e: CommitmentEdit }) {
    if (!profile || !plan) return
    const nextProfile: Profile = { ...profile, schedule: { ...profile.schedule, commitments: fn(profile.schedule.commitments) } }
    update((s) => ({
      ...s,
      profile: nextProfile,
      google: edit && s.google ? { ...s.google, edits: { ...s.google.edits, [edit.id]: { ...s.google.edits?.[edit.id], ...edit.e } } } : s.google,
    }))
    if (!propose(plan, nextProfile)) setToast(['Guardado. Os treinos não precisam de mudar.'])
  }

  /** Muda ou apaga (patch null) um evento. Os do Google só mudam na app. */
  function editCommitment(c: Commitment, patch: Partial<Commitment> | null) {
    const google = c.source === 'google'
    if (!patch) {
      changeCommitments((list) => list.filter((x) => x.id !== c.id), google ? { id: c.id, e: { deleted: true } } : undefined)
      return
    }
    const { title, kind, date, start, end, blocksDay } = patch
    const e: CommitmentEdit = Object.fromEntries(Object.entries({ title, kind, date, start, end, blocksDay }).filter(([, v]) => v !== undefined))
    changeCommitments((list) => list.map((x) => (x.id === c.id ? { ...x, ...patch } : x)), google ? { id: c.id, e } : undefined)
  }

  /**
   * Lê os eventos do Google e escreve o plano no calendário "Treinos Ironman".
   * Se algum treino ficar por cima de um evento, propõe novos horários.
   */
  async function syncGoogle(first: boolean) {
    if (!profile || !plan || syncing.current) return
    syncing.current = true
    setGBusy(true)
    setGError(null)
    try {
      const token = await requestToken(first)
      const res = await fetchCommitments(token.value, first ? undefined : state.google, profile.schedule.commitments, today, profile.raceDate)
      let settings = res.settings
      if (settings.writeTrainings && token.canWrite) {
        settings = { ...settings, trainingCalendarId: await ensureTrainingCalendar(token.value, settings.trainingCalendarId) }
      }
      const nextProfile: Profile = { ...profile, schedule: { ...profile.schedule, commitments: res.commitments } }

      const notes = [importSummary(res.stats)]
      if (settings.writeTrainings && !token.canWrite) notes.push('Não deste autorização para escrever no calendário, por isso os treinos não foram escritos.')
      if (settings.writeTrainings && token.canWrite && settings.trainingCalendarId) {
        const r = await syncTrainings(token.value, settings.trainingCalendarId, plan.sessions, today, profile.raceDate)
        if (r.created + r.updated + r.removed > 0) notes.push(`Calendário "Treinos Ironman" atualizado: ${r.created} novos, ${r.updated} alterados, ${r.removed} apagados.`)
      }
      settings = { ...settings, lastSync: new Date().toISOString() }
      update((s) => ({ ...s, profile: nextProfile, google: settings }))
      setToast(notes)
      propose(plan, nextProfile)
    } catch (e) {
      setGError(e instanceof Error ? e.message : 'Não foi possível sincronizar com o Google.')
    } finally {
      syncing.current = false
      setGBusy(false)
    }
  }

  function disconnectGoogle() {
    revoke()
    update((s): AppState => ({
      ...s,
      google: undefined,
      profile: s.profile && { ...s.profile, schedule: { ...s.profile.schedule, commitments: s.profile.schedule.commitments.filter((c) => c.source !== 'google') } },
    }))
    setToast(['Desligado do Google. Os eventos do Google saíram do horário; o calendário "Treinos Ironman" fica na tua conta e podes apagá-lo lá.'])
  }

  // Com a sessão do Google ainda aberta, as mudanças no plano vão logo para o calendário
  useEffect(() => {
    const g = state.google
    if (!plan || !profile || !g?.writeTrainings) return
    const t = setTimeout(async () => {
      const token = currentToken()
      if (!token?.canWrite || syncing.current) return
      syncing.current = true
      try {
        // Ligaste o Google no questionário: o calendário dos treinos é criado agora, com o plano pronto
        const calId = g.trainingCalendarId ?? await ensureTrainingCalendar(token.value)
        if (!g.trainingCalendarId) update((s) => ({ ...s, google: s.google && { ...s.google, trainingCalendarId: calId, lastSync: new Date().toISOString() } }))
        await syncTrainings(token.value, calId, plan.sessions, today, profile.raceDate)
      } catch { /* fica para a próxima sincronização */ } finally { syncing.current = false }
    }, 3000)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan])

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
        <ProfileView profile={profile} legacy={state.legacy} hasPlan={false} google={state.google} onGoogle={(g) => update((s) => ({ ...s, google: g }))} onSave={saveProfile} />
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
        {page === 'profile' && <ProfileView profile={profile} hasPlan initialStep={0} google={state.google} onGoogle={(g) => update((s) => ({ ...s, google: g }))} onSave={saveProfile} />}
        {page === 'tests' && <ProfileView profile={profile} hasPlan initialStep={5} onSave={saveProfile} />}
        {page === 'google' && (
          <GoogleView settings={state.google} imported={profile.schedule.commitments.filter((c) => c.source === 'google').length}
            busy={gBusy} error={gError} onConnect={() => syncGoogle(true)} onSync={() => syncGoogle(false)}
            onChange={(g) => update((s) => ({ ...s, google: g }))} onDisconnect={disconnectGoogle} />
        )}

        {!page && tab === 'today' && (
          <TodayView profile={profile} plan={plan} activities={state.activities} today={today}
            onSkip={skip} onUnskip={unskip} onDone={markDone} onOpenWeek={() => setPage('week')} onOpenProgress={() => setTab('progress')} />
        )}
        {!page && tab === 'triathlon' && (
          <TriathlonView profile={profile} plan={plan} activities={state.activities} today={today} hasKey={!!aiKey} busy={aiBusy} error={aiError}
            onAsk={askAi} onSetupAi={() => setPage('coach')} onSkip={skip} onUnskip={unskip} onDone={markDone} />
        )}
        {page === 'coach' && <CoachView hasKey={!!aiKey} onSave={(k) => { setKey(k); setAiKey(k); setToast([k ? 'Treinador IA ligado.' : 'Chave removida.']) }} />}
        {!page && tab === 'calendar' && (
          <CalendarView profile={profile} plan={plan} activities={state.activities} today={today} onSkip={skip} onUnskip={unskip} onDone={markDone}
            onEditCommitment={editCommitment} onAddCommitment={(c) => changeCommitments((list) => [...list, c])} />
        )}
        {!page && tab === 'progress' && <ProgressView profile={profile} plan={plan} activities={state.activities} today={today} />}
        {!page && tab === 'more' && (
          <div className="stack">
            <h1 className="screen-title">Mais</h1>
            <ul className="menu">
              <MenuItem icon="✨" title="Treinador IA" hint={aiKey ? 'Ligado' : 'Distribuir os treinos com inteligência artificial'} onClick={() => setPage('coach')} />
              <MenuItem icon="📅" title="Google Calendar" hint={state.google ? 'Ligado · sincronizar eventos e treinos' : 'Juntar aulas, eventos e treinos num só calendário'} onClick={() => setPage('google')} />
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
      {pending && (
        <ProposalSheet changes={pending.changes} summary={pending.summary}
          onAccept={() => { update((s) => ({ ...s, plan: pending.plan })); setPending(null); setToast(['Novos horários aceites.']) }}
          onKeep={() => { setPending(null); setToast(['Os treinos ficam como estavam, mesmo por cima dos eventos.']) }} />
      )}

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

function ProposalSheet({ changes, summary, onAccept, onKeep }: { changes: string[]; summary?: string; onAccept: () => void; onKeep: () => void }) {
  return (
    <div className="sheet-backdrop">
      <div className="sheet" role="dialog" aria-modal="true" aria-labelledby="proposal-title">
        <header><div>
          <h2 id="proposal-title">{summary ? '✨ Proposta do treinador' : 'Novos horários para os treinos'}</h2>
          <p className={summary ? 'small' : 'muted small'}>{summary ?? `O teu calendário mudou e ${changes.length === 1 ? 'um treino ficou' : 'alguns treinos ficaram'} por cima de eventos. Proponho isto:`}</p>
        </div></header>
        <ul className="proposal">{changes.map((c, i) => <li key={i}>{c}</li>)}</ul>
        <div className="actions">
          <button className="primary" onClick={onAccept}>Aceitar</button>
          <button onClick={onKeep}>Manter como está</button>
        </div>
      </div>
    </div>
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
