import { useEffect, useState } from 'react'
import { cleanPath, folderOk, isAbsPath } from '../paths'
import type { IDockviewPanelProps } from 'dockview-react'
import type { PermissionMode } from '../../../shared/types'
import { Conversation } from './RunViewer'
import { IconFolder, IconPlay } from '../icons'
import { useSettings } from '../appearance'
import { useAgents, usageText } from '../agentStore'
import { unavailableText } from '../../../shared/agents'

export interface AgentChatParams {
  runId?: string // conversa ja iniciada (reabrir a aba)
  cwd?: string
}

// Chat estruturado do botao Agent: conversa do Claude Code em modo headless, na melhor conta do ranking.
// Quando a conta bate no limite (ou passa do limiar), o proximo turno continua a MESMA conversa na proxima conta.
// Rascunho do prompt que ainda nao comecou: sobrevive a fechar a aba (como o Ad hoc), some ao iniciar o chat
let chatDraft = ''
// aba que esta com o rascunho na tela: uma 2a aba "New chat" aberta junto comeca vazia (nao duplica a tarefa)
let draftOwner: string | null = null

export function AgentChatPanel({ params, api }: IDockviewPanelProps<AgentChatParams>) {
  const conns = useSettings()?.connections ?? []
  const claudeConn = conns.find((c) => c.kind === 'claude')
  const agents = useAgents()
  const allClaude = agents.accounts.filter((a) => a.agent === 'claude')
  const claudeAccounts = allClaude.filter((a) => a.enabled)
  const signedIn = claudeAccounts.filter((a) => !agents.signedOut.includes(a.id))
  // mesma regra do main (pickAccount com allowWarning): logada, ligada e fora de esgotada/bloqueada
  const usable = signedIn.filter((a) => !['exhausted', 'blocked'].includes(agents.usage[a.id]?.state ?? 'unknown'))
  const best = usable.find((a) => ['ok', 'unknown'].includes(agents.usage[a.id]?.state ?? 'unknown')) ?? usable[0]
  // mesmo texto do botao Agent e do main (shared/agents.ts)
  const why = unavailableText(allClaude, agents.usage, agents.signedOut, 'Claude account')
  const [cwd, setCwd] = useState(params.cwd ?? '')
  // pasta digitada que nao existe: o Claude abriria na pasta do usuario sem avisar
  const [cwdMissing, setCwdMissing] = useState(false)
  const [checkedCwd, setCheckedCwd] = useState('') // ultima pasta conferida: enquanto a digitada nao foi, Start espera
  const cwdPending = !!cleanPath(cwd) && checkedCwd !== cleanPath(cwd)
  useEffect(() => {
    const p = cleanPath(cwd)
    if (!p) return setCwdMissing(false)
    // resposta atrasada (pasta de rede lenta) de um valor que o usuario ja trocou e ignorada
    let alive = true
    const t = setTimeout(() => void folderOk(p).then((ok) => alive && (setCwdMissing(!ok), setCheckedCwd(p))), 250)
    return () => {
      alive = false
      clearTimeout(t)
    }
    return () => clearTimeout(t)
  }, [cwd])
  const [perm, setPerm] = useState<PermissionMode>('manual')
  const [prompt, setPromptState] = useState(() => {
    if (params.runId || (draftOwner && draftOwner !== api.id)) return ''
    draftOwner = api.id
    return chatDraft
  })
  useEffect(() => () => void (draftOwner === api.id && (draftOwner = null)), [])
  const setPrompt = (v: string): void => {
    if (draftOwner && draftOwner !== api.id) return setPromptState(v) // rascunho e da outra aba aberta
    draftOwner = api.id
    chatDraft = v
    setPromptState(v)
  }
  const [runId, setRunId] = useState(params.runId)
  const [starting, setStarting] = useState(false)
  const [err, setErr] = useState<string>()

  async function start(): Promise<void> {
    if (!claudeConn || !prompt.trim() || why || cwdMissing || cwdPending) return
    // confere a pasta agora (o aviso tem atraso de digitacao): nunca inicia numa pasta relativa ou inexistente
    const dir = cleanPath(cwd)
    if (dir && !(await folderOk(dir))) return setCwdMissing(true)
    setStarting(true)
    setErr(undefined)
    try {
      const id = await window.turno.run.start({ profile: claudeConn.id, pool: true, cwd: cleanPath(cwd) || undefined, permissionMode: perm, prompt, chrome: false })
      chatDraft = ''
      draftOwner = null
      setRunId(id)
      api.updateParameters({ runId: id, cwd })
      api.setTitle(prompt.trim().slice(0, 28) || 'chat')
    } catch (e) {
      setErr(String((e as Error).message).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
    } finally {
      setStarting(false)
    }
  }

  if (runId) return <Conversation runId={runId} onHeadChange={(id) => api.updateParameters({ runId: id, cwd })} />
  return (
    <div className="agent-chat">
      <div className="agent-chat-form">
        <h2>New chat</h2>
        <p className="muted small">
          Runs Claude Code in a structured chat on your best Claude account{best ? ` (now: ${best.label}${usageText(agents.usage[best.id]) ? `, ${usageText(agents.usage[best.id])}` : ''})` : ''}. When an account reaches its limit, the conversation continues on the next one.
        </p>
        {!claudeConn && <div className="banner banner-err">There is no Claude connection in Settings › Connections.</div>}
        {claudeConn && why && <div className="banner banner-warn">{why}</div>}
        <div className="adhoc-grid">
          <label className="field">
            <span>Folder</span>
            <div className="row">
              <input className="mono grow" value={cwd} aria-invalid={cwdMissing || undefined} onChange={(e) => setCwd(e.target.value)} placeholder="Your home folder" />
              <button className="btn" aria-label="Choose folder" title="Choose folder" onClick={async () => { const d = await window.turno.ui.pickFolder(); if (d) setCwd(d) }}>
                <IconFolder />
              </button>
            </div>
            {cwdPending && !cwdMissing && <small className="muted">Checking the folder…</small>}
            {cwdMissing && <small className="tone-err">{isAbsPath(cleanPath(cwd)) ? "This folder doesn't exist." : 'Use a full path, like C:\\code\\my-repo.'}</small>}
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
        </div>
        {perm === 'bypassPermissions' && <small className="tone-err">Bypass all: the agent runs anything without asking.</small>}
        <textarea
          rows={5}
          value={prompt}
          autoFocus
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="What should the agent do? (Ctrl+Enter starts)"
          onKeyDown={(e) => e.key === 'Enter' && (e.ctrlKey || e.metaKey) && void start()}
        />
        {err && <div className="banner banner-err">{err}</div>}
        <div className="row">
          <button className="btn primary" disabled={!prompt.trim() || starting || !claudeConn || !!why || cwdMissing || cwdPending} onClick={() => void start()}>
            {starting ? <><span className="spinner sm" /> Starting…</> : <><IconPlay /> Start</>}
          </button>
        </div>
      </div>
    </div>
  )
}
