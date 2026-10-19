import { addDaysIso, mondayOf, today } from '../domain/dates'
import { BUFFER, commitmentsOn, subtract, toHHMM } from '../domain/schedule'
import type { Schedule } from '../domain/types'
import { WEEKDAYS, fmtMinutes } from './format'

const FROM = 5 * 60
const TO = 24 * 60
const pct = (m: number) => `${((Math.min(Math.max(m, FROM), TO) - FROM) / (TO - FROM)) * 100}%`

const KIND_LABEL = { class: 'Aulas', gym: 'Ginásio', football: 'Futebol', work: 'Trabalho', other: 'Outro' } as const

/** Semana típica: janelas de treino, compromissos e o tempo livre que sobra */
export function ScheduleGrid({ schedule, week = mondayOf(today()) }: { schedule: Schedule; week?: string }) {
  const days = Array.from({ length: 7 }, (_, i) => addDaysIso(week, i))
  return (
    <div className="sched" role="img" aria-label="Semana típica com janelas de treino e compromissos">
      <div className="sched-hours" aria-hidden>
        {[6, 9, 12, 15, 18, 21].map((h) => <span key={h} style={{ left: pct(h * 60) }}>{h}h</span>)}
      </div>
      {days.map((d, i) => {
        const commitments = commitmentsOn(schedule, d)
        const free = subtract(schedule.windows[i] ?? [], commitments, BUFFER)
        const freeMin = free.reduce((a, w) => a + w.end - w.start, 0)
        return (
          <div className="sched-row" key={d}>
            <span className="sched-day">{WEEKDAYS[i].slice(0, 3)}</span>
            <div className="sched-track">
              {(schedule.windows[i] ?? []).map((w, j) => (
                <span key={`w${j}`} className="blk win" style={{ left: pct(w.start), width: `calc(${pct(w.end)} - ${pct(w.start)})` }} />
              ))}
              {free.map((w, j) => (
                <span key={`f${j}`} className="blk free" title={`Livre ${toHHMM(w.start)}–${toHHMM(w.end)}`} style={{ left: pct(w.start), width: `calc(${pct(w.end)} - ${pct(w.start)})` }} />
              ))}
              {commitments.map((c) => (
                <span key={c.id} className={`blk c-${c.kind}`} title={`${c.title} ${toHHMM(c.start)}–${toHHMM(c.end)}`} style={{ left: pct(c.start), width: `calc(${pct(c.end)} - ${pct(c.start)})` }} />
              ))}
            </div>
            <span className="sched-total">{freeMin ? fmtMinutes(freeMin) : '–'}</span>
          </div>
        )
      })}
      <div className="sched-legend small muted">
        <span><i className="blk free" /> Livre para treinar</span>
        <span><i className="blk win" /> Janela ocupada</span>
        {(['class', 'gym', 'football', 'work'] as const).map((k) => <span key={k}><i className={`blk c-${k}`} /> {KIND_LABEL[k]}</span>)}
      </div>
    </div>
  )
}

export { KIND_LABEL }
