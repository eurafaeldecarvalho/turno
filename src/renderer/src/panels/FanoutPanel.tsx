import { useState } from 'react'
import type { IDockviewPanelProps } from 'dockview-react'
import { useSettings } from '../appearance'
import { Conversation } from './RunViewer'
import { IconPlay } from '../icons'
import { askConfirm } from '../ConfirmDialog'

type FanoutRun = { connId: string; runId?: string; error?: string }

// Fan-out: roda o MESMO prompt em varias connections e mostra os resultados lado a lado pra comparar.
// Rascunho: fechar o modal nao perde o prompt nem as conexoes escolhidas.
const draft: { prompt: string; picked: string[] } = { prompt: '', picked: [] }

export function FanoutPanel(_props: IDockviewPanelProps) {
  const conns = useSettings()?.connections ?? []
  const [prompt, setPromptState] = useState(draft.prompt)
  const [picked, setPickedState] = useState<string[]>(draft.picked)
  const setPrompt = (v: string): void => {
    draft.prompt = v
    setPromptState(v)
  }
  const setPicked = (v: string[] | ((p: string[]) => string[])): void =>
    setPickedState((p) => (draft.picked = typeof v === 'function' ? v(p) : v))
  const [runs, setRuns] = useState<FanoutRun[] | null>(null)
  const [starting, setStarting] = useState(false)

  const toggle = (id: string): void => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]))
  const start = async (): Promise<void> => {
    if (!prompt.trim() || !picked.length) return
    // Cada connection vira uma run real (e cobranca). Confirma antes de disparar N de uma vez.
    const ok = await askConfirm({
      title: 'Run fan-out',
      message: `This starts ${picked.length} independent run(s) — one per connection. Each one runs (and bills) on its own. Continue?`,
      confirmLabel: `Run ${picked.length}`,
    })
    if (!ok) return
    setStarting(true)
    try {
      setRuns(await window.turno.run.fanout(prompt, picked))
    } finally {
      setStarting(false)
    }
  }

  if (runs) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        <div className="row" style={{ padding: '6px 10px', borderBottom: '1px solid var(--border)' }}>
          <button className="btn ghost" onClick={() => setRuns(null)}>← New round</button>
        </div>
        <div className="fanout-compare" style={{ display: 'grid', gridTemplateColumns: `repeat(${runs.length}, minmax(0, 1fr))`, gap: 8, flex: 1, minHeight: 0, overflow: 'hidden' }}>
          {runs.map((r) => (
          <div key={r.connId} className="fanout-col" style={{ display: 'flex', flexDirection: 'column', minWidth: 0, borderRight: '1px solid var(--border)' }}>
            <div className="fanout-head" style={{ padding: '6px 10px', borderBottom: '1px solid var(--border)' }}>
              <strong>{conns.find((c) => c.id === r.connId)?.name ?? r.connId}</strong>
            </div>
            {r.runId ? <Conversation runId={r.runId} compact /> : <div className="banner banner-err">{r.error}</div>}
          </div>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="adhoc">
      <div className="adhoc-form">
        <div className="row wrap" role="group" aria-label="Connections to compare">
          <span className="muted small" title="Fan-out runs in Allowed only mode with no tools: each model answers with text only.">Compare on (text only, no tools)</span>
          {conns.map((c) => (
            <label key={c.id} className="row small muted">
              <input type="checkbox" checked={picked.includes(c.id)} onChange={() => toggle(c.id)} /> {c.name}
            </label>
          ))}
        </div>
        <textarea
          className="mono"
          rows={5}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          autoFocus
          placeholder="Prompt to run across the selected connections…"
        />
        <button className="btn primary" disabled={!prompt.trim() || !picked.length || starting} onClick={() => void start()}>
          {starting ? <><span className="spinner sm" /> Running…</> : <><IconPlay /> Run {picked.length || ''}</>}
        </button>
      </div>
      <div className="panel-empty">Pick connections and a prompt, then run. Each one runs independently; results show side by side.</div>
    </div>
  )
}
