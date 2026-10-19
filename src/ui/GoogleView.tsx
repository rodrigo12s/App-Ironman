import { useEffect } from 'react'
import { ALLOWED_HOSTS, APP_URL, TRAINING_CALENDAR, WRITE_WEEKS, loadGis } from '../google/gcal'
import type { GoogleSettings } from '../domain/types'

interface Props {
  settings?: GoogleSettings
  imported: number
  busy: boolean
  error: string | null
  onConnect: () => void
  onSync: () => void
  onChange: (s: GoogleSettings) => void
  onDisconnect: () => void
}

export function GoogleView({ settings, imported, busy, error, onConnect, onSync, onChange, onDisconnect }: Props) {
  const allowed = ALLOWED_HOSTS.includes(location.hostname)
  // Carregar já o login do Google, para a janela abrir logo ao tocar no botão
  useEffect(() => { if (allowed) loadGis().catch(() => {}) }, [allowed])

  if (!allowed) {
    return (
      <div className="stack">
        <div className="alert alert-info">
          <b>O Google Calendar só funciona na app publicada.</b>
          <p>Abre <a href={APP_URL} target="_blank" rel="noreferrer">{APP_URL.replace('https://', '')}</a> e liga lá a tua conta.</p>
        </div>
      </div>
    )
  }

  if (!settings) {
    return (
      <div className="stack">
        <section className="card">
          <h2>Juntar tudo num só calendário</h2>
          <p>A app lê os teus eventos (aulas, ginásio, futebol, exames) e não marca treinos por cima. Os treinos aparecem no calendário "{TRAINING_CALENDAR}", ao lado do resto.</p>
          <button className="primary wide" disabled={busy} onClick={onConnect}>{busy ? 'A ligar…' : 'Ligar ao Google Calendar'}</button>
          {error && <p className="small danger">{error}</p>}
          <p className="muted small">A app só lê os teus calendários e só escreve no calendário que ela própria cria. Os dados ficam neste dispositivo.</p>
        </section>
      </div>
    )
  }

  const last = settings.lastSync
    ? new Date(settings.lastSync).toLocaleString('pt-PT', { weekday: 'long', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
    : 'ainda não'
  const choices = settings.calendars.filter((c) => c.id !== settings.trainingCalendarId && c.name !== TRAINING_CALENDAR)

  return (
    <div className="stack">
      <section className="card">
        <div className="g-status"><span className="dot ok" aria-hidden /> <b>Ligado ao Google Calendar</b></div>
        <p className="small">Última sincronização: {last}. {imported > 0 && `${imported} compromissos vindos do Google.`}</p>
        <button className="primary wide" disabled={busy} onClick={onSync}>{busy ? 'A sincronizar…' : 'Sincronizar agora'}</button>
        {error && <p className="small danger">{error}</p>}
        <p className="muted small">Sincroniza quando mudares o horário no Google. Enquanto a app estiver aberta, as mudanças no plano vão logo para o calendário.</p>
      </section>

      <details className="card more">
        <summary>Calendários e opções</summary>
        <fieldset className="g-cals">
          <legend>Ler eventos de</legend>
          {choices.map((c) => (
            <label key={c.id} className="check">
              <input type="checkbox" checked={settings.importCalendars.includes(c.id)}
                onChange={(e) => onChange({ ...settings, importCalendars: e.target.checked ? [...settings.importCalendars, c.id] : settings.importCalendars.filter((x) => x !== c.id) })} />
              {c.name}{c.primary && <span className="muted small"> (principal)</span>}
            </label>
          ))}
        </fieldset>
        <label className="check">
          <input type="checkbox" checked={settings.writeTrainings} onChange={(e) => onChange({ ...settings, writeTrainings: e.target.checked })} />
          Escrever os treinos no calendário "{TRAINING_CALENDAR}"
        </label>
        <p className="muted small">Ficam escritas as próximas {WRITE_WEEKS} semanas, atualizadas a cada sincronização. Toca num treino no Google Calendar para ver os blocos e as zonas.</p>
        <button className="link small danger" disabled={busy} onClick={onDisconnect}>Desligar do Google</button>
      </details>
    </div>
  )
}
