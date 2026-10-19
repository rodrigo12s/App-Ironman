import { useEffect, useRef, useState } from 'react'
import { addDaysIso, mondayOf, today } from '../domain/dates'
import { parseIcs } from '../domain/ics'
import { peakTarget } from '../domain/plan'
import { fromHHMM, toHHMM, typicalWeek } from '../domain/schedule'
import type { Athlete, Commitment, CommitmentKind, Injury, Level, Profile, TestResults, TimeWindow, Weekday } from '../domain/types'
import { cssPer100, formatPace, ftp, hrZones, paceZones, parsePace, powerZones, runThresholdPace, type Zone } from '../domain/zones'
import { WEEKDAYS, fmtMinutes } from './format'
import { KIND_LABEL, ScheduleGrid } from './ScheduleGrid'

const W = (a: string, b: string): TimeWindow => ({ start: fromHHMM(a), end: fromHHMM(b) })

export const defaultAthlete = (): Athlete => ({
  goal: 'finish',
  level: { swim: 'beginner', bike: 'beginner', run: 'intermediate' },
  currentWeeklyHours: 5,
  longestRideMin: 90,
  longestRunMin: 60,
  longestSwimMin: 30,
  injuries: [],
  hasPowerMeter: false,
  hasHrMonitor: true,
  hasSmartTrainer: false,
  poolDays: [0, 1, 2, 3, 4, 5],
  maxSessionsPerDay: 2,
  longDay: 5,
})

export const defaultProfile = (): Profile => ({
  name: '',
  raceName: '',
  raceDate: addDaysIso(today(), 7 * 36),
  planStart: today(),
  athlete: defaultAthlete(),
  schedule: {
    windows: [
      [W('06:30', '08:00'), W('18:00', '21:00')],
      [W('06:30', '08:00'), W('18:00', '21:00')],
      [W('06:30', '08:00'), W('18:00', '21:00')],
      [W('06:30', '08:00'), W('18:00', '21:00')],
      [W('06:30', '08:00'), W('18:00', '20:00')],
      [W('08:00', '14:00')],
      [W('08:00', '12:00')],
    ],
    commitments: [],
  },
  tests: {},
})

const STEPS = ['A prova', 'Experiência', 'Saúde e material', 'Quando treinas', 'Aulas e compromissos', 'Testes'] as const

const LEVELS: { id: Level; label: string; hint: Record<'swim' | 'bike' | 'run', string> }[] = [
  { id: 'none', label: 'Nunca fiz', hint: { swim: 'Não nado crawl seguido', bike: 'Só ando de bicicleta a passear', run: 'Não corro' } },
  { id: 'beginner', label: 'Iniciante', hint: { swim: 'Nado 200 a 400 m com pausas', bike: 'Até 1h30 seguida', run: 'Até 5 a 10 km' } },
  { id: 'intermediate', label: 'Intermédio', hint: { swim: 'Nado 1500 m seguidos', bike: '3 h ou mais, já fiz 90 km', run: 'Já fiz meia maratona' } },
  { id: 'advanced', label: 'Experiente', hint: { swim: 'Nado 3 km ou mais', bike: 'Faço 120 km ou mais', run: 'Já fiz maratona' } },
]

const INJURIES: { id: Injury; label: string }[] = [
  { id: 'knee', label: 'Joelho' },
  { id: 'shin', label: 'Canelites' },
  { id: 'achilles', label: 'Tendão de Aquiles' },
  { id: 'plantar', label: 'Fascite plantar' },
  { id: 'hip', label: 'Anca' },
  { id: 'back', label: 'Costas' },
  { id: 'other', label: 'Outra' },
]

const DRAFT_KEY = 'ironman-profile-draft'

interface Props {
  profile: Profile | null
  legacy?: Pick<Profile, 'raceName' | 'raceDate' | 'tests'>
  hasPlan: boolean
  initialStep?: number
  onSave: (p: Profile, regenerate: boolean) => void
}

export function ProfileView({ profile, legacy, hasPlan, initialStep, onSave }: Props) {
  const [p, setP] = useState<Profile>(() => {
    if (profile) return profile
    try {
      const raw = localStorage.getItem(DRAFT_KEY)
      if (raw) return { ...defaultProfile(), ...JSON.parse(raw) }
    } catch { /* sem rascunho */ }
    return { ...defaultProfile(), ...(legacy ?? {}) }
  })
  const [step, setStep] = useState(initialStep ?? 0)
  useEffect(() => {
    if (profile) return
    try { localStorage.setItem(DRAFT_KEY, JSON.stringify(p)) } catch { /* sem armazenamento */ }
  }, [p, profile])

  const setA = (patch: Partial<Athlete>) => setP((x) => ({ ...x, athlete: { ...x.athlete, ...patch } }))
  const weeksToRace = Math.floor((new Date(p.raceDate).getTime() - new Date(p.planStart).getTime()) / (7 * 864e5))
  const free = typicalWeek(p, mondayOf(p.planStart))
  const freeTotal = free.reduce((a, b) => a + b, 0)
  const last = step === STEPS.length - 1

  function save(regenerate: boolean) {
    try { localStorage.removeItem(DRAFT_KEY) } catch { /* nada */ }
    onSave({ ...p, tests: { ...p.tests, testedOn: p.tests.testedOn ?? today() } }, regenerate)
  }

  return (
    <div className="stack">
      <nav className="wizard-steps" aria-label="Passos do questionário">
        {STEPS.map((s, i) => (
          <button key={s} className={i === step ? 'active' : i < step || profile ? 'done' : ''} onClick={() => setStep(i)} aria-current={i === step ? 'step' : undefined}>
            <span className="n">{i + 1}</span> {s}
          </button>
        ))}
      </nav>

      {step === 0 && (
        <section className="card">
          <h2>A tua prova</h2>
          <div className="grid2">
            <label>O teu nome<input id="q-name" value={p.name} onChange={(e) => setP({ ...p, name: e.target.value })} /></label>
            <label>Prova<input id="q-race" value={p.raceName} placeholder="Ironman Cascais" onChange={(e) => setP({ ...p, raceName: e.target.value })} /></label>
            <label>Data da prova<input id="q-race-date" type="date" value={p.raceDate} onChange={(e) => setP({ ...p, raceDate: e.target.value })} /></label>
            <label>Início do plano<input id="q-start" type="date" value={p.planStart} onChange={(e) => setP({ ...p, planStart: e.target.value })} /></label>
            <label>Idade<input id="q-age" type="number" min={14} max={90} value={p.athlete.age ?? ''} onChange={(e) => setA({ age: e.target.value ? Number(e.target.value) : undefined })} /></label>
          </div>
          <p className="muted">{weeksToRace > 0 ? `${weeksToRace} semanas de preparação.` : 'A data da prova tem de ser depois do início.'}
            {weeksToRace > 0 && weeksToRace < 24 && ' Para um primeiro Ironman, o ideal são 24 semanas ou mais.'}</p>
          <fieldset className="choice">
            <legend>Qual é o objetivo?</legend>
            <Radio name="goal" checked={p.athlete.goal === 'finish'} onChange={() => setA({ goal: 'finish' })} label="Terminar bem" hint="Chegar à meta inteiro e a desfrutar" />
            <Radio name="goal" checked={p.athlete.goal === 'time'} onChange={() => setA({ goal: 'time' })} label="Fazer um tempo" hint="Tenho uma meta de horas" />
            {p.athlete.goal === 'time' && (
              <label>Tempo-alvo (horas)<input id="q-target" type="number" min={8} max={17} step={0.5} value={p.athlete.targetHours ?? 13} onChange={(e) => setA({ targetHours: Number(e.target.value) })} /></label>
            )}
          </fieldset>
        </section>
      )}

      {step === 1 && (
        <section className="card">
          <h2>A tua experiência</h2>
          {(['swim', 'bike', 'run'] as const).map((sport) => (
            <fieldset key={sport} className="choice">
              <legend>{sport === 'swim' ? '🏊 Natação' : sport === 'bike' ? '🚴 Bicicleta' : '🏃 Corrida'}</legend>
              <div className="choice-row">
                {LEVELS.map((l) => (
                  <Radio key={l.id} name={`lvl-${sport}`} checked={p.athlete.level[sport] === l.id}
                    onChange={() => setA({ level: { ...p.athlete.level, [sport]: l.id } })} label={l.label} hint={l.hint[sport]} />
                ))}
              </div>
            </fieldset>
          ))}
          <div className="grid2">
            <label>Horas por semana de natação, bicicleta e corrida (últimas 4 semanas)
              <input id="q-hours" type="number" min={0} step={0.5} value={p.athlete.currentWeeklyHours} onChange={(e) => setA({ currentWeeklyHours: Number(e.target.value) || 0 })} /></label>
            <label>Bicicleta mais longa recente (min)
              <input id="q-ride" type="number" min={0} step={15} value={p.athlete.longestRideMin} onChange={(e) => setA({ longestRideMin: Number(e.target.value) || 0 })} /></label>
            <label>Corrida mais longa recente (min)
              <input id="q-run" type="number" min={0} step={5} value={p.athlete.longestRunMin} onChange={(e) => setA({ longestRunMin: Number(e.target.value) || 0 })} /></label>
            <label>Natação mais longa recente (min)
              <input id="q-swim" type="number" min={0} step={5} value={p.athlete.longestSwimMin} onChange={(e) => setA({ longestSwimMin: Number(e.target.value) || 0 })} /></label>
          </div>
          <p className="muted small">O plano começa a partir daqui e sobe aos poucos: as sessões longas crescem cerca de 15 min por semana na bicicleta e 5 min na corrida. A modalidade mais fraca recebe mais tempo.</p>
        </section>
      )}

      {step === 2 && (
        <section className="card">
          <h2>Saúde e material</h2>
          <fieldset className="choice">
            <legend>Lesões nos últimos 12 meses</legend>
            <div className="check-row">
              {INJURIES.map((i) => (
                <label key={i.id} className="check">
                  <input type="checkbox" checked={p.athlete.injuries.includes(i.id)}
                    onChange={(e) => setA({ injuries: e.target.checked ? [...p.athlete.injuries, i.id] : p.athlete.injuries.filter((x) => x !== i.id) })} />
                  {i.label}
                </label>
              ))}
            </div>
            <p className="muted small">Com lesões nas pernas, a corrida longa fica limitada a 2 h e parte do volume de corrida passa para a bicicleta.</p>
          </fieldset>
          <fieldset className="choice">
            <legend>O que tens</legend>
            <div className="check-row">
              <label className="check"><input type="checkbox" checked={p.athlete.hasHrMonitor} onChange={(e) => setA({ hasHrMonitor: e.target.checked })} /> Relógio ou cinta de FC</label>
              <label className="check"><input type="checkbox" checked={p.athlete.hasPowerMeter} onChange={(e) => setA({ hasPowerMeter: e.target.checked })} /> Medidor de potência</label>
              <label className="check"><input type="checkbox" checked={p.athlete.hasSmartTrainer} onChange={(e) => setA({ hasSmartTrainer: e.target.checked })} /> Rolo de treino</label>
            </div>
          </fieldset>
        </section>
      )}

      {step === 3 && (
        <section className="card">
          <h2>Quando podes treinar</h2>
          <p className="muted small">Indica as janelas em que costumas estar livre. Aulas, ginásio e futebol entram no passo seguinte e são descontados daqui automaticamente.</p>
          <div className="windows">
            {WEEKDAYS.map((d, i) => (
              <WindowsEditor key={d} day={d} windows={p.schedule.windows[i] ?? []}
                onChange={(w) => {
                  const windows = p.schedule.windows.map((x, j) => (j === i ? w : x))
                  setP({ ...p, schedule: { ...p.schedule, windows } })
                }} />
            ))}
          </div>
          <fieldset className="choice">
            <legend>Dias com acesso a piscina</legend>
            <div className="check-row">
              {WEEKDAYS.map((d, i) => (
                <label key={d} className="check">
                  <input type="checkbox" checked={p.athlete.poolDays.includes(i as Weekday)}
                    onChange={(e) => setA({ poolDays: e.target.checked ? [...p.athlete.poolDays, i as Weekday].sort() : p.athlete.poolDays.filter((x) => x !== i) })} />
                  {d.slice(0, 3)}
                </label>
              ))}
            </div>
          </fieldset>
          <div className="grid2">
            <label>Treinos por dia, no máximo
              <select id="q-max" value={p.athlete.maxSessionsPerDay} onChange={(e) => setA({ maxSessionsPerDay: Number(e.target.value) as 1 | 2 })}>
                <option value={1}>1 treino</option><option value={2}>2 treinos</option>
              </select></label>
            <label>Dia do treino longo de bicicleta
              <select id="q-long" value={p.athlete.longDay} onChange={(e) => setA({ longDay: Number(e.target.value) as Weekday })}>
                {WEEKDAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}
              </select></label>
          </div>
          <p className="muted small">A corrida longa fica no dia a seguir ao da bicicleta longa.</p>
        </section>
      )}

      {step === 4 && <CommitmentsStep profile={p} onChange={(commitments) => setP({ ...p, schedule: { ...p.schedule, commitments } })} />}

      {step === 5 && <TestsStep tests={p.tests} athlete={p.athlete} onChange={(tests) => setP({ ...p, tests })} />}

      {(step === 3 || step === 4) && <section className="card summary">
        <h2>A tua semana</h2>
        <ScheduleGrid schedule={p.schedule} week={mondayOf(p.planStart)} />
        <p className={freeTotal < 600 ? 'warn-text small' : 'muted small'}>
          Tens {fmtMinutes(freeTotal)} livres por semana para natação, bicicleta e corrida. No pico o plano vai usar até {fmtMinutes(peakTarget(p))}.
          {freeTotal < 600 && ' Com menos de 10 h livres o Ironman fica muito apertado. Tenta ter um dia de fim de semana com 5 a 6 h.'}
          {!free.some((m) => m >= 240) && ' Não há nenhum dia com 4 h seguidas para a bicicleta longa.'}
        </p>
      </section>}

      <div className="actions wizard-actions">
        {step > 0 && <button onClick={() => setStep(step - 1)}>Anterior</button>}
        {!last && <button className="primary" onClick={() => setStep(step + 1)}>Seguinte</button>}
        {(last || hasPlan) && (
          <button className={last ? 'primary' : ''} disabled={weeksToRace < 4} onClick={() => save(true)}>
            {hasPlan ? 'Guardar e gerar novo plano' : 'Criar o meu plano'}
          </button>
        )}
        {hasPlan && <button onClick={() => save(false)}>Guardar sem mudar o plano</button>}
      </div>
      {hasPlan && <p className="muted small">Gerar um novo plano substitui as sessões a partir de hoje. As atividades importadas mantêm-se.</p>}
    </div>
  )
}

function Radio({ name, checked, onChange, label, hint }: { name: string; checked: boolean; onChange: () => void; label: string; hint?: string }) {
  return (
    <label className={`radio ${checked ? 'on' : ''}`}>
      <input type="radio" name={name} checked={checked} onChange={onChange} />
      <span><b>{label}</b>{hint && <small>{hint}</small>}</span>
    </label>
  )
}

function WindowsEditor({ day, windows, onChange }: { day: string; windows: TimeWindow[]; onChange: (w: TimeWindow[]) => void }) {
  return (
    <div className="win-day">
      <b>{day}</b>
      <div className="win-list">
        {windows.length === 0 && <span className="muted small">Sem treino</span>}
        {windows.map((w, i) => (
          <span key={i} className="win-item">
            <input type="time" aria-label={`${day}: início`} value={toHHMM(w.start)} onChange={(e) => onChange(windows.map((x, j) => (j === i ? { ...x, start: fromHHMM(e.target.value) } : x)))} />
            <span>–</span>
            <input type="time" aria-label={`${day}: fim`} value={toHHMM(w.end)} onChange={(e) => onChange(windows.map((x, j) => (j === i ? { ...x, end: fromHHMM(e.target.value) } : x)))} />
            <button className="link small danger" aria-label="Remover janela" onClick={() => onChange(windows.filter((_, j) => j !== i))}>✕</button>
          </span>
        ))}
        <button className="link small" onClick={() => onChange([...windows, windows.length ? W('18:00', '20:00') : W('07:00', '08:00')])}>+ janela</button>
      </div>
    </div>
  )
}

const emptyCommitment = (): Omit<Commitment, 'id'> => ({ title: '', kind: 'football', weekday: 2, start: fromHHMM('19:00'), end: fromHHMM('20:30'), source: 'manual' })

function CommitmentsStep({ profile, onChange }: { profile: Profile; onChange: (c: Commitment[]) => void }) {
  const [form, setForm] = useState(emptyCommitment())
  const [msg, setMsg] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const list = profile.schedule.commitments

  async function importFile(file: File) {
    try {
      const imported = parseIcs(await file.text(), profile.planStart, profile.raceDate)
      const kept = list.filter((c) => c.source !== 'ics')
      onChange([...kept, ...imported])
      const weekly = imported.filter((c) => c.weekday !== undefined).length
      setMsg(imported.length ? `Importados ${imported.length} compromissos: ${weekly} semanais e ${imported.length - weekly} em datas concretas (exames, eventos). Revê os tipos abaixo.` : 'O calendário não tem eventos com hora no período do plano.')
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Não foi possível ler o calendário.')
    }
  }

  const sorted = [...list].sort((a, b) => (a.weekday ?? 9) - (b.weekday ?? 9) || (a.date ?? '').localeCompare(b.date ?? '') || a.start - b.start)
  const recurring = sorted.filter((c) => c.weekday !== undefined)
  const dated = sorted.filter((c) => c.date)

  return (
    <section className="card">
      <h2>Aulas, ginásio e futebol</h2>
      <p className="muted small">O plano não marca nada por cima destes compromissos e deixa 15 min de margem antes e depois. O ginásio substitui a força do plano e o futebol conta como treino: nesse dia não há corrida e no dia seguinte não há corrida dura.</p>

      <div className="import-box">
        <b>Calendário da universidade</b>
        <p className="muted small">Exporta o horário em formato .ics (no portal académico, ou no Outlook) e escolhe o ficheiro aqui. Os exames também entram. Se usas o Google Calendar, é mais fácil ligá-lo em Mais, Google Calendar.</p>
        <button onClick={() => fileRef.current?.click()}>Importar ficheiro .ics</button>
        <input ref={fileRef} type="file" accept=".ics,text/calendar" hidden onChange={(e) => e.target.files?.[0] && importFile(e.target.files[0])} />
        {msg && <p className="small">{msg}</p>}
      </div>

      <form className="commit-form" onSubmit={(e) => {
        e.preventDefault()
        if (form.end <= form.start) { setMsg('A hora de fim tem de ser depois da hora de início.'); return }
        onChange([...list, { ...form, title: form.title || KIND_LABEL[form.kind], id: `m-${Date.now()}` }])
        setForm({ ...emptyCommitment(), kind: form.kind })
        setMsg(null)
      }}>
        <b>Adicionar à mão</b>
        <div className="commit-fields">
          <label>Tipo
            <select id="c-kind" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as CommitmentKind })}>
              {Object.entries(KIND_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select></label>
          <label>Nome<input id="c-title" value={form.title} placeholder={KIND_LABEL[form.kind]} onChange={(e) => setForm({ ...form, title: e.target.value })} /></label>
          <label>Dia
            <select id="c-day" value={form.weekday} onChange={(e) => setForm({ ...form, weekday: Number(e.target.value) as Weekday })}>
              {WEEKDAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}
            </select></label>
          <label>Início<input id="c-start" type="time" value={toHHMM(form.start)} onChange={(e) => setForm({ ...form, start: fromHHMM(e.target.value) })} /></label>
          <label>Fim<input id="c-end" type="time" value={toHHMM(form.end)} onChange={(e) => setForm({ ...form, end: fromHHMM(e.target.value) })} /></label>
          <button className="primary" type="submit">Adicionar</button>
        </div>
      </form>

      {recurring.length > 0 && (
        <>
          <h3 className="sub">Todas as semanas</h3>
          <ul className="commit-list">
            {recurring.map((c) => <CommitmentRow key={c.id} c={c} onKind={(kind) => onChange(list.map((x) => (x.id === c.id ? { ...x, kind } : x)))} onDelete={() => onChange(list.filter((x) => x.id !== c.id))} />)}
          </ul>
        </>
      )}
      {dated.length > 0 && (
        <details>
          <summary className="small">{dated.length} em datas concretas (exames, eventos)</summary>
          <ul className="commit-list">
            {dated.map((c) => <CommitmentRow key={c.id} c={c} onKind={(kind) => onChange(list.map((x) => (x.id === c.id ? { ...x, kind } : x)))} onDelete={() => onChange(list.filter((x) => x.id !== c.id))} />)}
          </ul>
        </details>
      )}
      {list.length > 0 && <button className="link small danger" onClick={() => onChange([])}>Apagar todos os compromissos</button>}
    </section>
  )
}

function CommitmentRow({ c, onKind, onDelete }: { c: Commitment; onKind: (k: CommitmentKind) => void; onDelete: () => void }) {
  const when = c.date
    ? new Date(c.date + 'T12:00:00').toLocaleDateString('pt-PT', { weekday: 'short', day: 'numeric', month: 'short' })
    : `${WEEKDAYS[c.weekday!]}${c.until ? ` até ${new Date(c.until + 'T12:00:00').toLocaleDateString('pt-PT', { day: 'numeric', month: 'short' })}` : ''}`
  return (
    <li>
      <span className={`dot c-${c.kind}`} aria-hidden />
      <div>
        <b>{c.title}</b>
        <div className="muted small">{when} · {toHHMM(c.start)}–{toHHMM(c.end)}</div>
      </div>
      <select aria-label="Tipo" value={c.kind} onChange={(e) => onKind(e.target.value as CommitmentKind)}>
        {Object.entries(KIND_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
      </select>
      <button className="link small danger" onClick={onDelete} aria-label={`Apagar ${c.title}`}>Apagar</button>
    </li>
  )
}

function TestsStep({ tests, athlete, onChange }: { tests: TestResults; athlete: Athlete; onChange: (t: TestResults) => void }) {
  const [paceText, setPaceText] = useState({
    swim400: tests.swim400Sec ? formatPace(tests.swim400Sec) : '',
    swim200: tests.swim200Sec ? formatPace(tests.swim200Sec) : '',
    run30: tests.run30minPaceSecPerKm ? formatPace(tests.run30minPaceSecPerKm) : '',
  })
  const set = (patch: Partial<TestResults>) => onChange({ ...tests, ...patch })
  const num = (v: string) => (v === '' ? undefined : Number(v))
  const css = cssPer100(tests)
  const f = ftp(tests)
  const thr = runThresholdPace(tests)
  return (
    <section className="card">
      <h2>Testes e zonas</h2>
      <p className="muted small">Se ainda não fizeste os testes, deixa em branco: a primeira semana do plano tem os testes e depois voltas aqui para pôr os resultados.</p>
      <div className="grid3">
        <fieldset>
          <legend>🏊 Natação (CSS)</legend>
          <label>Tempo 400 m (mm:ss)<input id="t-400" value={paceText.swim400} placeholder="7:20"
            onChange={(e) => { setPaceText({ ...paceText, swim400: e.target.value }); set({ swim400Sec: parsePace(e.target.value) }) }} /></label>
          <label>Tempo 200 m (mm:ss)<input id="t-200" value={paceText.swim200} placeholder="3:25"
            onChange={(e) => { setPaceText({ ...paceText, swim200: e.target.value }); set({ swim200Sec: parsePace(e.target.value) }) }} /></label>
          {css && <p className="result">CSS: <b>{formatPace(css)}/100 m</b></p>}
        </fieldset>
        <fieldset>
          <legend>🚴 Bicicleta</legend>
          {(athlete.hasPowerMeter || athlete.hasSmartTrainer) && (
            <label>Potência média 20 min (W)<input id="t-ftp" type="number" value={tests.bike20minWatts ?? ''} onChange={(e) => set({ bike20minWatts: num(e.target.value) })} /></label>
          )}
          <label>FC de limiar na bicicleta (bpm)<input id="t-bike-hr" type="number" value={tests.bikeLthr ?? ''} onChange={(e) => set({ bikeLthr: num(e.target.value) })} /></label>
          {f && <p className="result">FTP: <b>{f} W</b></p>}
        </fieldset>
        <fieldset>
          <legend>🏃 Corrida</legend>
          <label>Ritmo médio 30 min (min/km)<input id="t-run" value={paceText.run30} placeholder="4:50"
            onChange={(e) => { setPaceText({ ...paceText, run30: e.target.value }); set({ run30minPaceSecPerKm: parsePace(e.target.value) }) }} /></label>
          <label>FC de limiar na corrida (bpm)<input id="t-run-hr" type="number" value={tests.runLthr ?? ''} onChange={(e) => set({ runLthr: num(e.target.value) })} /></label>
          {thr && <p className="result">Limiar: <b>{formatPace(thr)}/km</b></p>}
        </fieldset>
      </div>
      <div className="zones">
        {f && <ZoneTable title="Potência (W)" zones={powerZones(f)} />}
        {tests.bikeLthr && <ZoneTable title="FC bicicleta (bpm)" zones={hrZones(tests.bikeLthr, 'bike')} />}
        {thr && <ZoneTable title="Ritmo corrida (/km)" zones={paceZones(thr, 'run')} pace />}
        {tests.runLthr && <ZoneTable title="FC corrida (bpm)" zones={hrZones(tests.runLthr, 'run')} />}
        {css && <ZoneTable title="Ritmo natação (/100 m)" zones={paceZones(css, 'swim')} pace />}
      </div>
    </section>
  )
}

function ZoneTable({ title, zones, pace }: { title: string; zones: Zone[]; pace?: boolean }) {
  const show = (z: Zone) => {
    if (pace) {
      if (z.high === null) return `> ${formatPace(z.low)}`
      if (z.low === 0) return `< ${formatPace(z.high)}`
      return `${formatPace(z.low)}–${formatPace(z.high)}`
    }
    return z.high === null ? `> ${z.low}` : `${z.low}–${z.high}`
  }
  return (
    <table className="zone-table">
      <caption>{title}</caption>
      <tbody>
        {zones.map((z) => (
          <tr key={z.zone}><td><span className={`z z${z.zone}`}>Z{z.zone}</span> {z.name}</td><td>{show(z)}</td></tr>
        ))}
      </tbody>
    </table>
  )
}
