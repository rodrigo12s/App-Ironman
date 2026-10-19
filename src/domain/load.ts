import { addDaysIso } from './dates'
import { cssPer100, ftp, runThresholdPace } from './zones'
import type { Activity, Plan, Profile } from './types'

/** Calcula a carga (TSS) de uma atividade com o melhor dado disponível */
export function computeTss(a: Omit<Activity, 'tss' | 'tssMethod'>, profile: Profile | null): Pick<Activity, 'tss' | 'tssMethod'> {
  const hours = a.durationSec / 3600
  const t = profile?.tests ?? {}
  const f = ftp(t)
  const power = a.normalizedPower ?? a.avgPower
  if (a.sport === 'bike' && power && f) {
    const IF = power / f
    return { tss: Math.round(hours * IF * IF * 100), tssMethod: 'power' }
  }
  if (a.sport === 'run' && a.avgSpeed && runThresholdPace(t)) {
    const IF = a.avgSpeed / (1000 / runThresholdPace(t)!)
    return { tss: Math.round(hours * IF * IF * 100), tssMethod: 'pace' }
  }
  if (a.sport === 'swim' && a.avgSpeed && cssPer100(t)) {
    const IF = a.avgSpeed / (100 / cssPer100(t)!)
    return { tss: Math.round(hours * IF ** 3 * 100), tssMethod: 'pace' }
  }
  const lthr = a.sport === 'run' ? t.runLthr ?? t.bikeLthr : t.bikeLthr ?? t.runLthr
  if (a.avgHr && lthr) {
    const IF = a.avgHr / lthr
    return { tss: Math.round(hours * IF * IF * 100), tssMethod: 'hr' }
  }
  const perHour = a.sport === 'strength' ? 40 : a.sport === 'swim' ? 55 : 60
  return { tss: Math.round(hours * perHour), tssMethod: 'estimate' }
}

export interface LoadPoint {
  date: string
  tss: number
  ctl: number
  atl: number
  tsb: number
  projected: boolean
}

/**
 * Forma física (CTL, 42 dias), fadiga (ATL, 7 dias) e frescura (TSB = CTL - ATL
 * do dia anterior). Depois de hoje, usa a carga planeada para projetar até à prova.
 */
export function loadSeries(activities: Activity[], plan: Plan | null, from: string, to: string, today: string): LoadPoint[] {
  const daily = new Map<string, number>()
  for (const a of activities) daily.set(a.date, (daily.get(a.date) ?? 0) + a.tss)
  const planned = new Map<string, number>()
  for (const s of plan?.sessions ?? []) if (!s.skipped) planned.set(s.date, (planned.get(s.date) ?? 0) + s.plannedTss)

  const points: LoadPoint[] = []
  let ctl = 0
  let atl = 0
  for (let d = from; d <= to; d = addDaysIso(d, 1)) {
    const projected = d > today
    const tss = projected ? planned.get(d) ?? 0 : daily.get(d) ?? 0
    const tsb = ctl - atl
    ctl = ctl + (tss - ctl) / 42
    atl = atl + (tss - atl) / 7
    points.push({ date: d, tss, ctl: round1(ctl), atl: round1(atl), tsb: round1(tsb), projected })
  }
  return points
}

const round1 = (n: number) => Math.round(n * 10) / 10

export interface Alert {
  level: 'warn' | 'danger' | 'info'
  title: string
  detail: string
}

export function loadAlerts(series: LoadPoint[], activities: Activity[], today: string): Alert[] {
  const alerts: Alert[] = []
  const idx = series.findIndex((p) => p.date === today)
  if (idx < 0) return alerts
  const now = series[idx]
  const weekAgo = series[Math.max(0, idx - 7)]
  const ramp = now.ctl - weekAgo.ctl
  if (idx >= 7 && ramp > 7) {
    alerts.push({ level: 'danger', title: 'Carga a subir depressa demais', detail: `A forma subiu ${ramp.toFixed(1)} pontos na última semana. Acima de 5 a 7 por semana o risco de lesão e de sobretreino aumenta.` })
  } else if (idx >= 7 && ramp > 5) {
    alerts.push({ level: 'warn', title: 'Subida de carga no limite', detail: `+${ramp.toFixed(1)} de forma na última semana. Mantém, mas não acrescentes mais.` })
  }
  if (now.tsb < -30) {
    alerts.push({ level: 'danger', title: 'Fadiga muito elevada', detail: `A frescura está em ${now.tsb.toFixed(0)}. Considera trocar a próxima sessão de qualidade por uma fácil.` })
  }
  const lastWeek = series.slice(Math.max(0, idx - 6), idx + 1)
  if (lastWeek.length === 7 && lastWeek.every((p) => p.tsb < -20)) {
    alerts.push({ level: 'warn', title: 'Uma semana inteira cansado', detail: 'A frescura esteve abaixo de -20 nos últimos 7 dias. Confirma que a próxima semana de descarga se mantém.' })
  }

  // Progressão do volume de corrida: últimos 7 dias vs média das 3 semanas anteriores
  const runMin = (fromOffset: number, toOffset: number) =>
    activities
      .filter((a) => a.sport === 'run' && a.date > addDaysIso(today, -toOffset) && a.date <= addDaysIso(today, -fromOffset))
      .reduce((acc, a) => acc + a.durationSec / 60, 0)
  const recent = runMin(0, 7)
  const before = runMin(7, 28) / 3
  if (before >= 30 && recent > before * 1.15) {
    alerts.push({ level: 'warn', title: 'Volume de corrida a subir muito', detail: `Correste ${Math.round(recent)} min esta semana contra uma média de ${Math.round(before)} min. A corrida é onde aparecem mais lesões: sobe no máximo ~10% por semana.` })
  }
  return alerts
}
