import { useState } from 'react'
import { fromHHMM, toHHMM } from '../domain/schedule'
import type { Commitment, CommitmentKind } from '../domain/types'
import { KIND_LABEL } from './ScheduleGrid'
import { WEEKDAYS } from './format'

interface Props {
  /** Evento a editar; sem ele, cria um novo neste dia */
  c?: Commitment
  date: string
  onSave: (patch: Partial<Commitment>) => void
  onDelete?: () => void
  onCancel: () => void
}

/** Mudar ou criar um evento. As mudanças ficam só na app, o Google não é alterado. */
export function EventForm({ c, date, onSave, onDelete, onCancel }: Props) {
  const [title, setTitle] = useState(c?.title ?? '')
  const [kind, setKind] = useState<CommitmentKind>(c?.kind ?? 'class')
  const [day, setDay] = useState(c?.date ?? date)
  const [start, setStart] = useState(c && !c.allDay ? c.start : fromHHMM('09:00'))
  const [end, setEnd] = useState(c && !c.allDay ? c.end : fromHHMM('10:00'))
  const [blocksDay, setBlocksDay] = useState(!!c?.blocksDay)
  const [error, setError] = useState<string | null>(null)
  const weekly = c?.weekday !== undefined

  function save() {
    if (c?.allDay) return onSave({ title: title || c.title, kind, blocksDay })
    if (end <= start) return setError('A hora de fim tem de ser depois da hora de início.')
    onSave({ title: title || KIND_LABEL[kind], kind, start, end, ...(weekly ? {} : { date: day }) })
  }

  return (
    <form className="event-form" onSubmit={(e) => { e.preventDefault(); save() }}>
      <label>Nome<input id="ev-title" value={title} placeholder={KIND_LABEL[kind]} onChange={(e) => setTitle(e.target.value)} /></label>
      <label>Tipo
        <select id="ev-kind" value={kind} onChange={(e) => setKind(e.target.value as CommitmentKind)}>
          {Object.entries(KIND_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select></label>
      {c?.allDay
        ? <label className="check"><input type="checkbox" checked={blocksDay} onChange={(e) => setBlocksDay(e.target.checked)} /> Ocupa o dia todo (sem treinos neste dia)</label>
        : <div className="event-times">
            {weekly
              ? <p className="small muted">Repete às {WEEKDAYS[c!.weekday!].toLowerCase()}s: a mudança vale para todas as semanas.</p>
              : <label>Dia<input id="ev-date" type="date" value={day} onChange={(e) => setDay(e.target.value)} /></label>}
            <label>Início<input id="ev-start" type="time" value={toHHMM(start)} onChange={(e) => setStart(fromHHMM(e.target.value))} /></label>
            <label>Fim<input id="ev-end" type="time" value={toHHMM(end)} onChange={(e) => setEnd(fromHHMM(e.target.value))} /></label>
          </div>}
      {error && <p className="small danger">{error}</p>}
      {c?.source === 'google' && <p className="muted small">Muda só na app. O teu Google Calendar fica igual e esta mudança mantém-se quando sincronizares.</p>}
      <div className="actions">
        <button className="primary" type="submit">Guardar</button>
        <button type="button" onClick={onCancel}>Cancelar</button>
        {onDelete && <button type="button" className="link danger" onClick={onDelete}>Apagar evento</button>}
      </div>
    </form>
  )
}
