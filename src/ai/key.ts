import type { Session } from '../domain/types'

const KEY = 'ironman-anthropic-key'

/** A chave fica só neste browser, fora do estado da app (não vai nas cópias de segurança) */
export function getKey(): string | null {
  try { return localStorage.getItem(KEY) } catch { return null }
}
export function setKey(key: string | null) {
  try { key ? localStorage.setItem(KEY, key.trim()) : localStorage.removeItem(KEY) } catch { /* sem armazenamento */ }
}

/** Treinos de triatlo: sem ginásio, futebol nem a força do plano */
export const isTriathlon = (s: Session) => s.sport === 'swim' || s.sport === 'bike' || s.sport === 'run' || s.sport === 'brick'
