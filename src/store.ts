import { useCallback, useEffect, useState } from 'react'
import { loadState, saveState } from './domain/storage'
import type { AppState } from './domain/types'

/** Estado da aplicação guardado no próprio dispositivo */
export function useAppState() {
  const [state, setState] = useState<AppState>(() => loadState())
  const [saveFailed, setSaveFailed] = useState(false)
  useEffect(() => {
    setSaveFailed(!saveState(state))
  }, [state])
  const update = useCallback((fn: (s: AppState) => AppState) => setState((s) => fn(s)), [])
  return { state, update, replace: setState, saveFailed }
}
