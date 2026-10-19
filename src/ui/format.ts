import type { Phase, Sport } from '../domain/types'

export const SPORT_LABEL: Record<Sport | 'other', string> = {
  swim: 'Natação',
  bike: 'Bicicleta',
  run: 'Corrida',
  strength: 'Força',
  brick: 'Brick',
  other: 'Outro',
}

export const SPORT_ICON: Record<Sport | 'other', string> = {
  swim: '🏊',
  bike: '🚴',
  run: '🏃',
  strength: '🏋️',
  brick: '🔁',
  other: '•',
}

export const PHASE_LABEL: Record<Phase, string> = {
  base: 'Base',
  build: 'Construção',
  peak: 'Pico',
  taper: 'Taper',
  race: 'Prova',
}

export const WEEKDAYS = ['Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado', 'Domingo']

export const fmtMinutes = (m: number) => {
  const h = Math.floor(m / 60)
  const r = Math.round(m % 60)
  return h ? `${h}h${r ? String(r).padStart(2, '0') : ''}` : `${r} min`
}

export const fmtDay = (d: string, opts: Intl.DateTimeFormatOptions = { weekday: 'short', day: 'numeric', month: 'short' }) => {
  const text = new Date(d + 'T12:00:00').toLocaleDateString('pt-PT', opts)
  return text.charAt(0).toUpperCase() + text.slice(1)
}
