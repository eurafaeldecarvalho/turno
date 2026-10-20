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
export function AdhocPanel({ params }: IDockviewPanelProps<AdhocParams>) {
  const a = params.autoStart
  const [profile, setProfile] = useState<ProfileId>(a?.profile ?? 'claude-max')
  const [model, setModel] = useState(a?.model ?? 'sonnet')
  const [effort, setEffort] = useState<Effort>(a?.effort ?? 'medium')
  const [perm, setPerm] = useState<PermissionMode>(a?.permissionMode ?? 'dontAsk')
  const [tools, setTools] = useState((a?.allowedTools ?? ['Read']).join(' '))
  const [prompt, setPrompt] = useState(a?.prompt ?? '')
  const [runId, setRunId] = useState<string>()
  const [started, setStarted] = useState(false)
  const conns = useSettings()?.connections ?? []
  const conn = conns.find((c) => c.id === profile)
  const isClaude = conn ? conn.kind === 'claude' : true

  async function start(req?: RunRequest): Promise<void> {
    const r: RunRequest = req ?? {
      profile,
      model: isClaude ? model : undefined,
      effort,
      permissionMode: perm,
      allowedTools: tools.split(/\s+/).filter(Boolean),
      prompt,
    }
    setRunId(await window.turno.run.start(r))
  }
  if (a && !started) {
    setStarted(true)
    void start(a)
  }

  return (
    <div className="adhoc">
      <div className="adhoc-form">
        <select value={profile} onChange={(e) => setProfile(e.target.value as ProfileId)} aria-label="Profile">
          {conns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        {isClaude ? <ModelSelect value={model} onChange={setModel} /> : <input value={conn?.model ?? ''} disabled aria-label="Model" />}
        <select value={effort} onChange={(e) => setEffort(e.target.value as Effort)} aria-label="Effort">
          {['low', 'medium', 'high', 'xhigh', 'max'].map((x) => <option key={x}>{x}</option>)}
        </select>
        <select value={perm} onChange={(e) => setPerm(e.target.value as PermissionMode)} aria-label="Permission">
          <option value="manual">ask</option>
          <option value="dontAsk">allowed only</option>
          <option value="auto">auto</option>
          <option value="acceptEdits">accept edits</option>
          <option value="bypassPermissions">bypass all</option>
        </select>
        <input className="mono grow" value={tools} onChange={(e) => setTools(e.target.value)} placeholder="allowed tools" aria-label="Tools" />
        <textarea
          className="mono"
          rows={3}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Prompt… (Ctrl+Enter runs)"
          onKeyDown={(e) => e.key === 'Enter' && e.ctrlKey && prompt.trim() && void start()}
        />
        <button className="btn primary" disabled={!prompt.trim()} onClick={() => void start()}>
          <IconPlay /> Run
        </button>
      </div>
      {runId ? <Conversation runId={runId} compact /> : <div className="panel-empty">Write a prompt and run it. It does not become a routine or get a schedule.</div>}
    </div>
  )
}
