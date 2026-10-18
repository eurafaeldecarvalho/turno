import { useState } from 'react'

// Aliases do `claude --model` (sempre a versao mais nova) e os ids completos atuais.
export const CLAUDE_MODELS = [
  { v: 'fable', l: 'Fable — most capable (alias)' },
  { v: 'opus', l: 'Opus (alias)' },
  { v: 'sonnet', l: 'Sonnet — balanced (alias)' },
  { v: 'haiku', l: 'Haiku — fast and cheap (alias)' },
  { v: 'claude-fable-5-1', l: 'Fable 5.1' },
  { v: 'claude-opus-5-5', l: 'Opus 5.5' },
  { v: 'claude-sonnet-5-5', l: 'Sonnet 5.5' },
  { v: 'claude-haiku-5-5', l: 'Haiku 5.5' },
]

export function ModelSelect({ value, onChange, disabled }: { value: string; onChange: (v: string) => void; disabled?: boolean }) {
  const known = value === '' || CLAUDE_MODELS.some((m) => m.v === value)
  const [custom, setCustom] = useState(!known)
  return (
    <div className="row">
      <select
        aria-label="Model"
        disabled={disabled}
        value={custom ? '__custom' : value}
        onChange={(e) => {
          if (e.target.value === '__custom') return setCustom(true)
          setCustom(false)
          onChange(e.target.value)
        }}
      >
        <option value="">Account default</option>
        {CLAUDE_MODELS.map((m) => (
          <option key={m.v} value={m.v}>{m.l}</option>
        ))}
        <option value="__custom">Other (type it)…</option>
      </select>
      {custom && <input className="mono" value={value} placeholder="claude-…" onChange={(e) => onChange(e.target.value)} />}
    </div>
  )
}
