import { useState } from 'react'

interface Props {
  hasKey: boolean
  onSave: (key: string | null) => void
}

/** Ligar o treinador IA com a chave da Anthropic do próprio atleta */
export function CoachView({ hasKey, onSave }: Props) {
  const [key, setKey] = useState('')
  const valid = /^sk-ant-[\w-]{20,}$/.test(key.trim())
  return (
    <div className="stack">
      <section className="card">
        <h2>Treinador IA</h2>
        <p>O treinador (Claude, da Anthropic) olha para a tua semana, as tuas aulas, as lesões que descreveste e o cansaço acumulado, e propõe a melhor distribuição dos treinos de triatlo. Nada muda sem aceitares.</p>
        {hasKey ? (
          <>
            <p className="small"><span className="dot ok" aria-hidden /> Ligado. Usa o botão "Distribuir esta semana com IA" no separador Triatlo.</p>
            <button className="link small danger" onClick={() => onSave(null)}>Remover a chave deste telemóvel</button>
          </>
        ) : (
          <>
            <ol className="small steps-list">
              <li>Abre <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noreferrer">console.anthropic.com</a> e cria uma conta.</li>
              <li>Em Billing, põe algum crédito (5 € chegam para muitos meses).</li>
              <li>Em API Keys, cria uma chave e copia-a para aqui.</li>
            </ol>
            <label>A tua chave<input id="ai-key" type="password" autoComplete="off" value={key} placeholder="sk-ant-…" onChange={(e) => setKey(e.target.value)} /></label>
            <button className="primary wide" disabled={!valid} onClick={() => { onSave(key.trim()); setKey('') }}>Guardar</button>
          </>
        )}
        <p className="muted small">A chave fica só neste browser e não entra nas cópias de segurança. Cada pedido custa alguns cêntimos e é cobrado na tua conta da Anthropic.</p>
      </section>
    </div>
  )
}
