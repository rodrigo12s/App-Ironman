import type { AppState } from './types'

const KEY = 'ironman-app-v1'

export const emptyState = (): AppState => ({ profile: null, plan: null, activities: [], wellness: [] })

export function loadState(): AppState {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? migrate({ ...emptyState(), ...JSON.parse(raw) }) : emptyState()
  } catch {
    return emptyState()
  }
}

/**
 * A primeira versão guardava só minutos por dia. Sem o questionário não há
 * horário, por isso mantém-se a prova, os testes e os treinos e pede-se o
 * questionário de novo.
 */
function migrate(state: AppState): AppState {
  const p = state.profile as (AppState['profile'] & { availability?: unknown }) | null
  if (p && (!p.athlete || !p.schedule)) {
    return { ...state, profile: null, plan: null, legacy: { raceName: p.raceName, raceDate: p.raceDate, tests: p.tests } }
  }
  return state
}

export function saveState(state: AppState): boolean {
  try {
    localStorage.setItem(KEY, JSON.stringify(state))
    return true
  } catch {
    return false
  }
}

export function exportState(state: AppState): Blob {
  return new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' })
}

export function importState(text: string): AppState {
  const parsed = JSON.parse(text)
  if (typeof parsed !== 'object' || !('activities' in parsed)) throw new Error('Ficheiro de cópia de segurança inválido.')
  return migrate({ ...emptyState(), ...parsed })
}
