import { useEffect, useState } from 'react'
import type { Task } from '../../../shared/types'
import { useSettings } from '../appearance'
import { useAgents } from '../agentStore'
import { agentDef } from '../../../shared/agents'
import { openAgent } from '../layout'
import { toast } from '../Toast'
import { when } from '../fmt'
import { IconFolder, IconPlay, IconRefresh } from '../icons'

const errText = (e: unknown): string => String((e as Error)?.message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

// Tarefas atribuidas a voce no GitHub e no Jira. "Start" grava a tarefa (como dado nao confiavel), cria/reabre um
// worktree turno/<KEY>-slug e abre o Agent nele. Comentar e mudar status fica com o agente.
export function TasksPanel() {
  const s = useSettings()
  const agents = useAgents()
  const [tasks, setTasks] = useState<Task[]>()
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [jiraOn, setJiraOn] = useState(false)
  const [loading, setLoading] = useState(false)
  const [filter, setFilter] = useState<'all' | 'github' | 'jira'>('all')
  const [q, setQ] = useState('')
  const [open, setOpen] = useState<string>() // tarefa com o formulario de "Start" aberto
  const [jiraForm, setJiraForm] = useState(false)

  const load = async (): Promise<void> => {
    setLoading(true)
    try {
      const r = await window.turno.tasks.list()
      setTasks(r.tasks)
      setErrors(r.errors)
      setJiraOn(r.jiraConnected)
    } catch (e) {
      toast(errText(e), 'err')
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => void load(), [])

  const shown = (tasks ?? []).filter((t) => (filter === 'all' || t.provider === filter) && (!q.trim() || `${t.key} ${t.title} ${t.project}`.toLowerCase().includes(q.toLowerCase())))
  const installedAgents = [...new Set(agents.accounts.filter((a) => a.enabled && agents.installed.includes(a.agent)).map((a) => a.agent))]

  return (
    <div className="tasks">
      <header className="tasks-head">
        <div className="seg" role="group" aria-label="Source">
          {(['all', 'github', 'jira'] as const).map((f) => (
            <button key={f} className={filter === f ? 'on' : ''} aria-pressed={filter === f} onClick={() => setFilter(f)}>
              {f === 'all' ? 'All' : f === 'github' ? 'GitHub' : 'Jira'}
            </button>
          ))}
        </div>
        <input className="grow" type="search" placeholder="Filter tasks" title="Filter by key, title or project" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Filter tasks" />
        <button className="btn ghost" onClick={() => void (!loading && load())} aria-busy={loading || undefined} title="Refresh">
          {loading ? <span className="spinner sm" /> : <IconRefresh size={14} />} Refresh
        </button>
        <button id="jira-toggle" className="btn ghost" onClick={() => setJiraForm(!jiraForm)}>{jiraOn ? 'Jira connected' : 'Connect Jira'}</button>
      </header>
      {jiraForm && <JiraForm connected={jiraOn} initial={s?.integrations?.jira} onDone={() => (setJiraForm(false), void load(), setTimeout(() => document.getElementById('jira-toggle')?.focus()))} />}
      {Object.entries(errors).map(([k, v]) => (
        <div key={k} className="banner banner-warn">{k === 'github' ? 'GitHub' : 'Jira'}: {v}</div>
      ))}
      {!tasks && loading && <div className="panel-empty">Loading your tasks…</div>}
      {tasks && !shown.length && <div className="panel-empty">{filter === 'jira' && !jiraOn ? 'Jira is not connected. Use Connect Jira above.' : tasks.length ? 'No task matches the filter.' : 'No open task assigned to you.'}</div>}
      <ul className="task-list">
        {shown.map((t) => (
          <li key={`${t.provider}:${t.key}`} className={open === t.key ? 'open' : ''}>
            <div className="task-row">
              <span className={`task-src src-${t.provider}`}>{t.provider === 'github' ? 'GH' : 'JIRA'}</span>
              <span className="task-main">
                <button className="link task-title" title="Open in the browser" onClick={() => void window.turno.ui.openExternal(t.url)}>{t.title}</button>
                <small className="muted">{t.key}{t.status ? ` · ${t.status}` : ''}{t.updatedAt ? ` · updated ${when(t.updatedAt)}` : ''}</small>
              </span>
              <button className="btn small" onClick={() => setOpen(open === t.key ? undefined : t.key)}><IconPlay size={13} /> Start</button>
            </div>
            {open === t.key && (
              <StartForm task={t} defaultFolder={s?.integrations?.repoMap?.[t.project] ?? ''} agents={installedAgents} onDone={() => setOpen(undefined)} />
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}

function StartForm({ task, defaultFolder, agents, onDone }: { task: Task; defaultFolder: string; agents: string[]; onDone: () => void }) {
  const [folder, setFolder] = useState(defaultFolder)
  const [worktree, setWorktree] = useState(true)
  const [agent, setAgent] = useState('')
  const [busy, setBusy] = useState(false)
  const go = async (): Promise<void> => {
    setBusy(true)
    try {
      const r = await window.turno.tasks.start(task, folder.trim(), worktree)
      openAgent({ agent: agent || undefined, cwd: r.cwd, prompt: r.prompt, title: task.key.split('/').pop()?.slice(0, 24) })
      if (r.branch) toast(`Working on branch ${r.branch}`, 'info')
      onDone()
    } catch (e) {
      toast(errText(e), 'err')
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="task-start">
      <label className="field">
        <span>Repository folder</span>
        <div className="row">
          <input className="mono grow" value={folder} onChange={(e) => setFolder(e.target.value)} placeholder="C:\\code\\my-repo" />
          <button className="btn" aria-label="Choose folder" title="Choose folder" onClick={async () => { const d = await window.turno.ui.pickFolder(); if (d) setFolder(d) }}><IconFolder /></button>
        </div>
      </label>
      <div className="row">
        <label className="check-row"><input type="checkbox" checked={worktree} onChange={(e) => setWorktree(e.target.checked)} /> Isolated worktree (branch turno/…)</label>
        <select aria-label="Agent" value={agent} onChange={(e) => setAgent(e.target.value)}>
          <option value="">Best available agent</option>
          {agents.map((a) => <option key={a} value={a}>{agentDef(a)?.name ?? a}</option>)}
        </select>
        <button className="btn primary" disabled={busy || !folder.trim()} onClick={() => void go()}>{busy ? <span className="spinner sm" /> : <IconPlay size={13} />} Start</button>
      </div>
    </div>
  )
}

// embedded = dentro de Settings › Integrations: sem foco automatico, sem Cancel e sem Esc proprio
export function JiraForm({ connected, initial, onDone, embedded }: { connected: boolean; initial?: { baseUrl: string; email: string }; onDone: () => void; embedded?: boolean }) {
  const [baseUrl, setBaseUrl] = useState(initial?.baseUrl ?? '')
  const [email, setEmail] = useState(initial?.email ?? '')
  const [token, setToken] = useState('')
  const [busy, setBusy] = useState(false)
  const save = async (): Promise<void> => {
    setBusy(true)
    try {
      const who = await window.turno.tasks.connectJira({ baseUrl, email, token })
      toast(`Jira connected as ${who}`, 'ok')
      onDone()
    } catch (e) {
      toast(errText(e), 'err')
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className={embedded ? 'jira-form' : 'jira-form card'} onKeyDown={(e) => !embedded && e.key === 'Escape' && (e.stopPropagation(), onDone())}>
      <p className="muted small">Jira Cloud with your e-mail and an API token (id.atlassian.com › Security › API tokens). The token is kept encrypted by Windows.</p>
      <div className="grid3">
        <label className="field"><span>Site</span><input autoFocus={!embedded} value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://your-company.atlassian.net" /></label>
        <label className="field"><span>E-mail</span><input value={email} onChange={(e) => setEmail(e.target.value)} /></label>
        <label className="field"><span>API token{connected ? ' (leave empty to keep)' : ''}</span><input type="password" autoComplete="off" value={token} onChange={(e) => setToken(e.target.value)} /></label>
      </div>
      <div className="row">
        <button className="btn primary" disabled={busy || !baseUrl || !email || (!connected && !token)} onClick={() => void save()}>{busy ? <span className="spinner sm" /> : null} Connect</button>
        {connected && <button className="btn ghost danger" onClick={() => void window.turno.tasks.disconnectJira().then(onDone)}>Disconnect</button>}
        {!embedded && <button className="btn ghost" onClick={onDone}>Cancel</button>}
      </div>
    </div>
  )
}
