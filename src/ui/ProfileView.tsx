import { useState } from 'react'
import { addDaysIso, today } from '../domain/dates'
import type { Profile, TestResults } from '../domain/types'
import { cssPer100, formatPace, ftp, hrZones, paceZones, parsePace, powerZones, runThresholdPace, type Zone } from '../domain/zones'
import { WEEKDAYS } from './format'

const defaultProfile = (): Profile => ({
  name: '',
  raceName: '',
  raceDate: addDaysIso(today(), 7 * 30),
  planStart: today(),
  availability: [60, 75, 60, 75, 45, 300, 150],
  tests: {},
})

interface Props {
  profile: Profile | null
  hasPlan: boolean
  onSave: (p: Profile, regenerate: boolean) => void
}

export function ProfileView({ profile, hasPlan, onSave }: Props) {
  const [p, setP] = useState<Profile>(profile ?? defaultProfile())
  const [paceText, setPaceText] = useState({
    swim400: p.tests.swim400Sec ? formatPace(p.tests.swim400Sec) : '',
    swim200: p.tests.swim200Sec ? formatPace(p.tests.swim200Sec) : '',
    run30: p.tests.run30minPaceSecPerKm ? formatPace(p.tests.run30minPaceSecPerKm) : '',
  })
  const setTest = (patch: Partial<TestResults>) => setP((x) => ({ ...x, tests: { ...x.tests, ...patch } }))
  const num = (v: string) => (v === '' ? undefined : Number(v))

  const weekly = p.availability.reduce((a, b) => a + b, 0)
  const weeksToRace = Math.floor((new Date(p.raceDate).getTime() - new Date(p.planStart).getTime()) / (7 * 864e5))
  const css = cssPer100(p.tests)
  const f = ftp(p.tests)
  const thr = runThresholdPace(p.tests)

  return (
    <div className="stack">
      <section className="card">
        <h2>A tua prova</h2>
        <div className="grid2">
          <label>Prova<input value={p.raceName} placeholder="Ironman Cascais" onChange={(e) => setP({ ...p, raceName: e.target.value })} /></label>
          <label>Data da prova<input type="date" value={p.raceDate} onChange={(e) => setP({ ...p, raceDate: e.target.value })} /></label>
          <label>Início do plano<input type="date" value={p.planStart} onChange={(e) => setP({ ...p, planStart: e.target.value })} /></label>
        </div>
        <p className="muted">{weeksToRace > 0 ? `${weeksToRace} semanas de preparação.` : 'A data da prova tem de ser depois do início.'}
          {weeksToRace > 0 && weeksToRace < 20 && ' Para um primeiro Ironman, o ideal são 24 semanas ou mais.'}</p>
      </section>

      <section className="card">
        <h2>Tempo disponível por dia</h2>
        <p className="muted">O plano nunca marca mais do que isto. Põe o máximo realista, não o ideal.</p>
        <div className="avail">
          {WEEKDAYS.map((d, i) => (
            <label key={d}>{d}
              <span className="with-unit">
                <input type="number" min={0} step={15} value={p.availability[i]}
                  onChange={(e) => {
                    const a = [...p.availability] as Profile['availability']
                    a[i] = Number(e.target.value) || 0
                    setP({ ...p, availability: a })
                  }} />
                <small>min</small>
              </span>
            </label>
          ))}
        </div>
        <p className={weekly < 600 ? 'warn-text' : 'muted'}>
          Total: {Math.floor(weekly / 60)}h{String(weekly % 60).padStart(2, '0')} por semana.
          {weekly < 600 && ' Menos de 10 h por semana no pico torna o Ironman muito difícil. Tenta ter um dia de fim de semana com 5 a 6 h.'}
        </p>
      </section>

      <section className="card">
        <h2>Testes e zonas</h2>
        <p className="muted">Se ainda não fizeste os testes, deixa em branco: o plano começa com uma semana de testes.</p>
        <div className="grid3">
          <fieldset>
            <legend>🏊 Natação (CSS)</legend>
            <label>Tempo 400 m (mm:ss)<input value={paceText.swim400} placeholder="7:20"
              onChange={(e) => { setPaceText({ ...paceText, swim400: e.target.value }); setTest({ swim400Sec: parsePace(e.target.value) }) }} /></label>
            <label>Tempo 200 m (mm:ss)<input value={paceText.swim200} placeholder="3:25"
              onChange={(e) => { setPaceText({ ...paceText, swim200: e.target.value }); setTest({ swim200Sec: parsePace(e.target.value) }) }} /></label>
            {css && <p className="result">CSS: <b>{formatPace(css)}/100 m</b></p>}
          </fieldset>
          <fieldset>
            <legend>🚴 Bicicleta</legend>
            <label>Potência média 20 min (W)<input type="number" value={p.tests.bike20minWatts ?? ''} onChange={(e) => setTest({ bike20minWatts: num(e.target.value) })} /></label>
            <label>FC de limiar (bpm)<input type="number" value={p.tests.bikeLthr ?? ''} onChange={(e) => setTest({ bikeLthr: num(e.target.value) })} /></label>
            {f && <p className="result">FTP: <b>{f} W</b></p>}
          </fieldset>
          <fieldset>
            <legend>🏃 Corrida</legend>
            <label>Ritmo médio 30 min (min/km)<input value={paceText.run30} placeholder="4:50"
              onChange={(e) => { setPaceText({ ...paceText, run30: e.target.value }); setTest({ run30minPaceSecPerKm: parsePace(e.target.value) }) }} /></label>
            <label>FC de limiar (bpm)<input type="number" value={p.tests.runLthr ?? ''} onChange={(e) => setTest({ runLthr: num(e.target.value) })} /></label>
            {thr && <p className="result">Limiar: <b>{formatPace(thr)}/km</b></p>}
          </fieldset>
        </div>
        <div className="zones">
          {f && <ZoneTable title="Potência (W)" zones={powerZones(f)} />}
          {p.tests.bikeLthr && <ZoneTable title="FC bicicleta (bpm)" zones={hrZones(p.tests.bikeLthr, 'bike')} />}
          {thr && <ZoneTable title="Ritmo corrida (/km)" zones={paceZones(thr, 'run')} pace />}
          {p.tests.runLthr && <ZoneTable title="FC corrida (bpm)" zones={hrZones(p.tests.runLthr, 'run')} />}
          {css && <ZoneTable title="Ritmo natação (/100 m)" zones={paceZones(css, 'swim')} pace />}
        </div>
      </section>

      <div className="actions">
        <button className="primary" disabled={weeksToRace < 4}
          onClick={() => onSave({ ...p, tests: { ...p.tests, testedOn: p.tests.testedOn ?? today() } }, true)}>
          {hasPlan ? 'Guardar e gerar novo plano' : 'Gerar o meu plano'}
        </button>
        {hasPlan && <button onClick={() => onSave(p, false)}>Guardar só os testes e zonas</button>}
      </div>
      {hasPlan && <p className="muted">Gerar um novo plano substitui as sessões futuras. As atividades importadas mantêm-se.</p>}
    </div>
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
