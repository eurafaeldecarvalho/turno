import { useEffect, useState } from 'react'
import type { AgentId, ClaudeSession, SidebarItem } from '../../shared/types'
import { AGENTS, agentOf, saveItem, uid, useSidebar } from './sidebarStore'
import { ModelSelect } from './ModelSelect'
import { when } from './fmt'
import { IconClose, IconFolder } from './icons'

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const k = (e: KeyboardEvent): void => void (e.key === 'Escape' && onClose())
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [onClose])
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-label={title}>
        <header className="modal-head">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <IconClose size={14} />
          </button>
        </header>
        {children}
      </div>
    </div>
  )
}

export function FolderDialog({ initial, onSave, onClose }: { initial?: string; onSave: (name: string) => void; onClose: () => void }) {
  const [name, setName] = useState(initial ?? '')
  const ok = name.trim().length > 0
  return (
    <Modal title={initial ? 'Rename folder' : 'New folder'} onClose={onClose}>
      <div className="modal-body">
        <label className="field">
          <span>Name</span>
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && ok && (onSave(name.trim()), onClose())} placeholder="e.g. Jobs, Study, Clients" />
        </label>
      </div>
      <footer className="modal-foot">
        <button className="btn ghost" onClick={onClose}>Cancel</button>
        <button className="btn primary" disabled={!ok} onClick={() => (onSave(name.trim()), onClose())}>Save</button>
      </footer>
    </Modal>
  )
}

export function ItemDialog({ folderId, item, onClose }: { folderId: string; item?: SidebarItem; onClose: () => void }) {
  const { folders } = useSidebar()
  const [folder, setFolder] = useState(folderId)
  const [kind, setKind] = useState<SidebarItem['kind']>(item?.kind ?? 'chat')
  const [name, setName] = useState(item?.name ?? '')
  const [agent, setAgent] = useState<AgentId>(item?.agent ?? 'claude')
  const [sessionId, setSessionId] = useState(item?.sessionId ?? '')
  const [cwd, setCwd] = useState(item?.cwd ?? '')
  const [model, setModel] = useState(item?.model ?? '')
  const [command, setCommand] = useState(item?.command ?? '')
  const [url, setUrl] = useState(item?.url ?? '')
  const [sessions, setSessions] = useState<ClaudeSession[]>([])
  const claude = agent === 'claude' || agent === 'claude-qwen'
  const preset = agentOf(agent)

  useEffect(() => {
    if (claude && !sessions.length) void window.turno.sidebar.claudeSessions().then(setSessions)
  }, [claude])

  const pickSession = (id: string): void => {
    const s = sessions.find((x) => x.id === id)
    setSessionId(id)
    if (s) {
      if (s.cwd) setCwd(s.cwd)
      if (!name.trim()) setName(s.title.slice(0, 60))
    }
  }

  const valid = name.trim() && (kind === 'terminal' || kind === 'link' ? /^[a-z][\w+.-]*:/i.test(url.trim()) : agent !== 'custom' || command.trim())

  function save(): void {
    if (kind === 'terminal' && item) {
      saveItem(folder, { ...item, name: name.trim(), cwd: cwd.trim() || undefined })
      return onClose()
    }
    const base: SidebarItem = { id: item?.id ?? uid(), kind, name: name.trim() }
    const next: SidebarItem =
      kind === 'link'
        ? { ...base, url: url.trim() }
        : {
            ...base,
            agent,
            // Claude: o Turno cria o id da sessao na hora para poder retomar depois com --resume.
            sessionId: sessionId.trim() || (claude ? uid() : undefined),
            cwd: cwd.trim() || undefined,
            model: claude && agent === 'claude' ? model || undefined : undefined,
            command: command.trim() || undefined,
          }
    saveItem(folder, next)
    onClose()
  }

  return (
    <Modal title={item ? 'Edit item' : 'New item'} onClose={onClose}>
      <div className="modal-body">
        {kind !== 'terminal' && (
          <div className="seg">
            <button className={kind === 'chat' ? 'on' : ''} onClick={() => setKind('chat')}>Agent chat</button>
            <button className={kind === 'link' ? 'on' : ''} onClick={() => setKind('link')}>Link</button>
          </div>
        )}
        <div className="grid2">
          <label className="field">
            <span>Name</span>
            <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder={kind === 'chat' ? 'e.g. Study Kubernetes' : 'e.g. Chat on claude.ai'} />
          </label>
          <label className="field">
            <span>Folder</span>
            <select value={folder} onChange={(e) => setFolder(e.target.value)}>
              {folders.map((f) => (
                <option key={f.id} value={f.id}>{f.name}</option>
              ))}
            </select>
          </label>
        </div>

        {kind === 'terminal' ? (
          <>
            <label className="field">
              <span>Working folder</span>
              <input className="mono" value={cwd} onChange={(e) => setCwd(e.target.value)} />
            </label>
            <small className="muted">
              {item?.sessionId ? `Reopens with claude --resume ${item.sessionId.slice(0, 8)}… in this folder.` : 'Reopens a terminal in this folder.'} The folder and session
              update automatically while the terminal is open.
            </small>
          </>
        ) : kind === 'link' ? (
          <label className="field">
            <span>URL</span>
            <input className="mono" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://claude.ai/chat/…  ·  https://chatgpt.com/c/…" />
            <small className="muted">Opens in the browser or the app registered for the link (claude.ai, ChatGPT, Notion…).</small>
          </label>
        ) : (
          <>
            <label className="field">
              <span>Agent</span>
              <select value={agent} onChange={(e) => setAgent(e.target.value as AgentId)}>
                {AGENTS.map((a) => (
                  <option key={a.id} value={a.id}>{a.name}</option>
                ))}
              </select>
            </label>
            {claude && (
              <label className="field">
                <span>Session</span>
                <select value={sessions.some((s) => s.id === sessionId) ? sessionId : ''} onChange={(e) => pickSession(e.target.value)}>
                  <option value="">{item?.sessionId ? 'Keep this item\'s current session' : 'New conversation'}</option>
                  {sessions.map((s) => (
                    <option key={s.id} value={s.id}>
                      {when(s.updatedAt)} · {s.title}
                    </option>
                  ))}
                </select>
                <small className="muted">Lists recent Claude Code conversations (terminal and Desktop app).</small>
              </label>
            )}
            {!claude && agent !== 'custom' && (
              <label className="field">
                <span>Session ID (optional)</span>
                <input className="mono" value={sessionId} onChange={(e) => setSessionId(e.target.value)} placeholder="empty = new conversation" />
                {preset.note && <small className="muted">{preset.note}</small>}
              </label>
            )}
            <label className="field">
              <span>Working folder</span>
              <div className="row">
                <input className="mono grow" value={cwd} onChange={(e) => setCwd(e.target.value)} placeholder="C:\projects\my-app" />
                <button className="btn" onClick={async () => { const d = await window.turno.ui.pickFolder(); if (d) setCwd(d) }} title="Choose folder">
                  <IconFolder />
                </button>
              </div>
            </label>
            {agent === 'claude' && (
              <label className="field">
                <span>Model</span>
                <ModelSelect value={model} onChange={setModel} />
              </label>
            )}
            <details className="advanced" open={agent === 'custom'}>
              <summary>Command</summary>
              <label className="field">
                <span>Command ({'{id}'} = session id). Empty = automatic.</span>
                <input className="mono" value={command} onChange={(e) => setCommand(e.target.value)} placeholder={preset.resumeCmd || 'my-agent --resume {id}'} />
              </label>
            </details>
          </>
        )}
      </div>
      <footer className="modal-foot">
        <button className="btn ghost" onClick={onClose}>Cancel</button>
        <button className="btn primary" disabled={!valid} onClick={save}>Save</button>
      </footer>
    </Modal>
  )
}
