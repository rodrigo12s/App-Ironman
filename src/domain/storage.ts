import type { AppState } from './types'

const KEY = 'ironman-app-v1'

export const emptyState = (): AppState => ({ profile: null, plan: null, activities: [], wellness: [] })

export function loadState(): AppState {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? { ...emptyState(), ...JSON.parse(raw) } : emptyState()
  } catch {
    return emptyState()
  }
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
  return { ...emptyState(), ...parsed }
}
