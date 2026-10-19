import { useRef, useState } from 'react'
import { today as todayIso } from '../domain/dates'
import { parseFit } from '../domain/fit'
import { computeTss } from '../domain/load'
import { exportState, importState } from '../domain/storage'
import type { Activity, AppState, Profile } from '../domain/types'
import { SPORT_ICON, SPORT_LABEL, fmtDay, fmtMinutes } from './format'

interface Props {
  state: AppState
  onAdd: (a: Activity[]) => void
  onDelete: (id: string) => void
  onRestore: (s: AppState) => void
}

const METHOD: Record<Activity['tssMethod'], string> = { power: 'potência', pace: 'ritmo', hr: 'FC', estimate: 'estimativa' }

export function ActivitiesView({ state, onAdd, onDelete, onRestore }: Props) {
  const [messages, setMessages] = useState<string[]>([])
  const [dragging, setDragging] = useState(false)
  const [backupText, setBackupText] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const backupRef = useRef<HTMLInputElement>(null)

  async function handleFiles(files: FileList | File[]) {
    const out: string[] = []
    const added: Activity[] = []
    for (const file of Array.from(files)) {
      try {
        const acts = await parseFit(await file.arrayBuffer(), state.profile, file.name)
        const fresh = acts.filter((a) => !state.activities.some((x) => x.id === a.id) && !added.some((x) => x.id === a.id))
        added.push(...fresh)
        out.push(fresh.length ? `${file.name}: ${fresh.map((a) => `${SPORT_LABEL[a.sport]} ${fmtMinutes(a.durationSec / 60)}`).join(', ')}` : `${file.name}: já estava importado.`)
      } catch (e) {
        out.push(`${file.name}: não foi possível ler (${e instanceof Error ? e.message : 'erro'}).`)
      }
    }
    if (added.length) onAdd(added)
    setMessages(out)
  }

  return (
    <div className="stack">
      <section className="card">
        <h2>Importar treinos</h2>
        <div
          className={`dropzone ${dragging ? 'dragging' : ''}`}
          onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => { e.preventDefault(); setDragging(false); handleFiles(e.dataTransfer.files) }}
          onClick={() => fileRef.current?.click()}
          role="button"
          tabIndex={0}
        >
          <b>Arrasta para aqui ficheiros .FIT</b>
          <span className="muted small">ou toca para escolher. Funciona com Garmin, Wahoo, Coros, Suunto e Zwift.</span>
          <input ref={fileRef} type="file" accept=".fit" multiple hidden onChange={(e) => e.target.files && handleFiles(e.target.files)} />
        </div>
        <details className="muted small">
          <summary>Onde encontro os ficheiros .FIT?</summary>
          <p><b>Garmin Connect:</b> abre a atividade, menu ⚙ e "Exportar original". <b>Strava:</b> na atividade, menu "…" e "Exportar original". <b>Zwift:</b> na pasta Documentos/Zwift/Activities.</p>
        </details>
        {messages.length > 0 && <ul className="small import-log">{messages.map((m, i) => <li key={i}>{m}</li>)}</ul>}
      </section>

      <ManualForm profile={state.profile} onAdd={(a) => onAdd([a])} />

      <section className="card">
        <h2>Atividades ({state.activities.length})</h2>
        {state.activities.length === 0 && <p className="muted">Ainda não há atividades.</p>}
        <ul className="act-list">
          {[...state.activities].sort((a, b) => b.startTime.localeCompare(a.startTime)).slice(0, 60).map((a) => (
            <li key={a.id}>
              <span className="icon">{SPORT_ICON[a.sport]}</span>
              <div>
                <b>{a.name || SPORT_LABEL[a.sport]}</b>
                <div className="muted small">
                  {fmtDay(a.date)} · {fmtMinutes(a.durationSec / 60)}
                  {a.distanceM ? ` · ${(a.distanceM / 1000).toFixed(1)} km` : ''}
                  {a.avgPower ? ` · ${Math.round(a.normalizedPower ?? a.avgPower)} W` : ''}
                  {a.avgHr ? ` · ${Math.round(a.avgHr)} bpm` : ''}
                  {` · ${a.tss} TSS (${METHOD[a.tssMethod]})`}
                </div>
              </div>
              <button className="link small danger" onClick={() => onDelete(a.id)} aria-label="Apagar atividade">Apagar</button>
            </li>
          ))}
        </ul>
      </section>

      <section className="card">
        <h2>Cópia de segurança</h2>
        <p className="muted small">Os dados ficam guardados só neste browser. Guarda uma cópia de vez em quando para não os perderes: exporta um ficheiro ou copia o texto e guarda-o numa nota.</p>
        <div className="actions">
          <button onClick={() => {
            const url = URL.createObjectURL(exportState(state))
            const a = document.createElement('a')
            a.href = url
            a.download = `ironman-backup-${todayIso()}.json`
            a.click()
            URL.revokeObjectURL(url)
          }}>Exportar cópia</button>
          <button onClick={() => backupRef.current?.click()}>Restaurar de ficheiro</button>
          <button onClick={async () => {
            try { await navigator.clipboard.writeText(JSON.stringify(state)); setMessages(['Cópia copiada. Cola-a numa nota ou num email para ti.']) }
            catch { setBackupText(JSON.stringify(state)); setMessages(['Não foi possível copiar automaticamente. Seleciona o texto abaixo e copia-o.']) }
          }}>Copiar como texto</button>
          <button onClick={() => setBackupText(backupText === null ? '' : null)}>Colar cópia</button>
          <input ref={backupRef} type="file" accept=".json,application/json" hidden onChange={async (e) => {
            const f = e.target.files?.[0]
            if (!f) return
            try { onRestore(importState(await f.text())); setMessages(['Cópia restaurada.']) } catch (err) { setMessages([err instanceof Error ? err.message : 'Erro ao restaurar.']) }
          }} />
        </div>
        {backupText !== null && (
          <div>
            <textarea id="backup-text" className="backup-text" value={backupText} onChange={(e) => setBackupText(e.target.value)} placeholder="Cola aqui o texto da cópia" />
            <div className="actions">
              <button className="primary small" disabled={!backupText} onClick={() => {
                try { onRestore(importState(backupText)); setBackupText(null); setMessages(['Cópia restaurada.']) } catch (err) { setMessages([err instanceof Error ? err.message : 'Texto inválido.']) }
              }}>Restaurar este texto</button>
            </div>
          </div>
        )}
      </section>
    </div>
  )
}

function ManualForm({ profile, onAdd }: { profile: Profile | null; onAdd: (a: Activity) => void }) {
  const [f, setF] = useState({ date: todayIso(), sport: 'run' as Activity['sport'], minutes: 60, km: '', hr: '', watts: '' })
  return (
    <section className="card">
      <h2>Registar à mão</h2>
      <form className="manual" onSubmit={(e) => {
        e.preventDefault()
        const durationSec = f.minutes * 60
        const distanceM = f.km ? Number(f.km.replace(',', '.')) * 1000 : undefined
        const base = {
          id: `manual-${Date.now()}`,
          date: f.date,
          startTime: `${f.date}T12:00:00.000Z`,
          sport: f.sport,
          durationSec,
          distanceM,
          avgHr: f.hr ? Number(f.hr) : undefined,
          avgPower: f.watts ? Number(f.watts) : undefined,
          avgSpeed: distanceM ? distanceM / durationSec : undefined,
          source: 'manual' as const,
        }
        onAdd({ ...base, ...computeTss(base, profile) })
        setF({ ...f, km: '', hr: '', watts: '' })
      }}>
        <label>Data<input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></label>
        <label>Modalidade
          <select value={f.sport} onChange={(e) => setF({ ...f, sport: e.target.value as Activity['sport'] })}>
            <option value="swim">Natação</option><option value="bike">Bicicleta</option><option value="run">Corrida</option><option value="strength">Força</option>
          </select>
        </label>
        <label>Duração (min)<input type="number" min={1} value={f.minutes} onChange={(e) => setF({ ...f, minutes: Number(e.target.value) || 0 })} /></label>
        <label>Distância (km)<input inputMode="decimal" value={f.km} onChange={(e) => setF({ ...f, km: e.target.value })} /></label>
        <label>FC média<input type="number" value={f.hr} onChange={(e) => setF({ ...f, hr: e.target.value })} /></label>
        {f.sport === 'bike' && <label>Potência média (W)<input type="number" value={f.watts} onChange={(e) => setF({ ...f, watts: e.target.value })} /></label>}
        <button className="primary" type="submit">Adicionar</button>
      </form>
    </section>
  )
}
