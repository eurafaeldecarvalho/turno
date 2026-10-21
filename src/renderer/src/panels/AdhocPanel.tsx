import { useState } from 'react'
import type { IDockviewPanelProps } from 'dockview-react'
import type { Effort, PermissionMode, ProfileId, RunRequest } from '../../../shared/types'
import { Conversation } from './RunViewer'
import { ModelSelect } from '../ModelSelect'
import { IconPlay } from '../icons'
import { useSettings } from '../appearance'

export interface AdhocParams {
  autoStart?: RunRequest
}

// Execucao avulsa: um prompt rapido sem criar rotina (tambem usado pelo modo smoke).
// Rascunho: fechar o modal (Esc, clique fora) nao perde o que foi preenchido.
const draft: { profile?: ProfileId; model?: string; effort?: Effort; perm?: PermissionMode; tools?: string; prompt: string } = { prompt: '' }
// Tools uma por linha (como no editor de rotina): "Bash(git log:*)" tem espaco e nao pode ser quebrado.
const parseTools = (t: string): string[] => t.split('\n').map((x) => x.trim()).filter(Boolean)

export function AdhocPanel({ params }: IDockviewPanelProps<AdhocParams>) {
  const a = params.autoStart
  const keep = <T,>(set: (v: T) => void, key: keyof typeof draft) => (v: T): void => {
    ;(draft as Record<string, unknown>)[key] = v
    set(v)
  }
  const [profile, setProfileState] = useState<ProfileId>(a?.profile ?? draft.profile ?? 'claude-max')
  const [model, setModelState] = useState(a?.model ?? draft.model ?? 'sonnet')
  const [effort, setEffortState] = useState<Effort>(a?.effort ?? draft.effort ?? 'medium')
  const [perm, setPermState] = useState<PermissionMode>(a?.permissionMode ?? draft.perm ?? 'dontAsk')
  const [tools, setToolsState] = useState(a?.allowedTools ? a.allowedTools.join('\n') : (draft.tools ?? 'Read'))
  const [prompt, setPromptState] = useState(a?.prompt ?? draft.prompt)
  const setProfile = keep(setProfileState, 'profile')
  const setModel = keep(setModelState, 'model')
  const setEffort = keep(setEffortState, 'effort')
  const setPerm = keep(setPermState, 'perm')
  const setTools = keep(setToolsState, 'tools')
  const setPrompt = keep(setPromptState, 'prompt')
  const [runId, setRunId] = useState<string>()
  const [started, setStarted] = useState(false)
  const [starting, setStarting] = useState(false)
  const conns = useSettings()?.connections ?? []
  const conn = conns.find((c) => c.id === profile)
  const isClaude = conn ? conn.kind === 'claude' : true

  async function start(req?: RunRequest): Promise<void> {
    const r: RunRequest = req ?? {
      profile,
      model: isClaude ? model : undefined,
      effort,
      permissionMode: perm,
      allowedTools: parseTools(tools),
      prompt,
    }
    setStarting(true)
    try {
      setRunId(await window.turno.run.start(r))
    } finally {
      setStarting(false)
    }
  }
  if (a && !started) {
    setStarted(true)
    void start(a)
  }

  return (
    <div className="adhoc">
      <div className="adhoc-form">
        <div className="adhoc-grid">
          <label className="field">
            <span>Connection</span>
            <select value={profile} onChange={(e) => setProfile(e.target.value as ProfileId)}>
              {conns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
          <label className="field">
            <span>Model</span>
            {isClaude ? <ModelSelect value={model} onChange={setModel} /> : <><input value={conn?.model ?? ''} disabled /><small className="muted">Set by the connection.</small></>}
          </label>
          <label className="field">
            <span>Effort</span>
            <select value={effort} onChange={(e) => setEffort(e.target.value as Effort)}>
              {['low', 'medium', 'high', 'xhigh', 'max'].map((x) => <option key={x}>{x}</option>)}
            </select>
          </label>
          <label className="field">
            <span>Permissions</span>
            <select value={perm} onChange={(e) => setPerm(e.target.value as PermissionMode)}>
              <option value="manual">ask</option>
              <option value="dontAsk">allowed only</option>
              <option value="auto">auto</option>
              <option value="acceptEdits">accept edits</option>
              <option value="bypassPermissions">bypass all</option>
            </select>
          </label>
          {perm === 'bypassPermissions' ? (
            <small className="tone-err adhoc-tools">Bypass all: the agent runs anything without asking.</small>
          ) : (
            <label className="field adhoc-tools">
              <span>Allowed tools (one per line)</span>
              <textarea className="mono" rows={2} spellCheck={false} value={tools} onChange={(e) => setTools(e.target.value)} placeholder={'Read\nBash(git log:*)'} />
              {perm === 'dontAsk' && !parseTools(tools).length && <small className="tone-warn">No tools allowed: the agent can only answer with text.</small>}
            </label>
          )}
        </div>
        <textarea
          className="mono"
          rows={3}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          autoFocus
          placeholder="Prompt… (Ctrl+Enter runs)"
          onKeyDown={(e) => e.key === 'Enter' && e.ctrlKey && prompt.trim() && void start()}
        />
        <button className="btn primary" disabled={!prompt.trim() || starting} onClick={() => void start()}>
          {starting ? <><span className="spinner sm" /> Running…</> : <><IconPlay /> Run</>}
        </button>
      </div>
      {runId ? <Conversation runId={runId} compact /> : <div className="panel-empty">Write a prompt and run it. It does not become a routine or get a schedule.</div>}
    </div>
  )
}
