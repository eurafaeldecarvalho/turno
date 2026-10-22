import { useEffect, useRef, useState } from 'react'
import { cleanPath, folderOk } from './paths'
import { LINK_HINT, LINK_RE } from '../../shared/links'
import { askConfirm } from './ConfirmDialog'
import { createPortal } from 'react-dom'
import type { AgentId, ClaudeSession, SidebarItem } from '../../shared/types'
import { AGENTS, agentOf, saveItem, uid, useSidebar } from './sidebarStore'
import { ModelSelect } from './ModelSelect'
import { when } from './fmt'
import { IconClose, IconFolder } from './icons'
import { useModalLayer } from './modalStack'

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  const box = useRef<HTMLDivElement>(null)
  const z = useModalLayer(true, onClose, box)
  return createPortal(
    <div className="modal-backdrop modal-backdrop-top-anchored" style={{ zIndex: z }} onMouseDown={(e) => e.target === e.currentTarget && (e.preventDefault(), onClose())}>
      <div ref={box} tabIndex={-1} className="modal" role="dialog" aria-modal="true" aria-label={title}>
        <header className="modal-head">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <IconClose size={14} />
          </button>
        </header>
        {children}
      </div>
    </div>,
    document.body,
  )
}

// Fechar sem salvar (Esc, clique fora, X): com algo digitado, pergunta antes. O Cancel descarta direto.
export function guardClose(dirty: boolean, onClose: () => void): () => void {
  return () => (dirty ? void askConfirm({ title: 'Discard changes?', message: 'What you typed here will be lost.', confirmLabel: 'Discard' }).then((ok) => ok && onClose()) : onClose())
}

export function FolderDialog({ initial, onSave, onClose }: { initial?: string; onSave: (name: string) => void; onClose: () => void }) {
  const [name, setName] = useState(initial ?? '')
  const { folders } = useSidebar()
  const dup = folders.some((f) => f.name.trim().toLowerCase() === name.trim().toLowerCase() && f.name.trim().toLowerCase() !== (initial ?? '').trim().toLowerCase())
  const ok = name.trim().length > 0 && !dup
  return (
    <Modal title={initial ? 'Rename folder' : 'New folder'} onClose={guardClose(name.trim() !== (initial ?? '').trim(), onClose)}>
      <div className="modal-body">
        <label className="field">
          <span>Name</span>
          <input autoFocus value={name} aria-invalid={dup || undefined} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), ok && (onSave(name.trim()), onClose()))} placeholder="e.g. Jobs, Study, Clients" />
          {dup && <small className="tone-warn">A folder with this name already exists.</small>}
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
  // pasta que nao existe: o terminal abriria na pasta pessoal sem avisar
  const [cwdMissing, setCwdMissing] = useState(false)
  useEffect(() => {
    const p = cleanPath(cwd)
    if (!p) return setCwdMissing(false)
    let alive = true // resposta atrasada de um valor ja trocado e ignorada
    const t = setTimeout(() => void folderOk(p).then((ok) => alive && setCwdMissing(!ok)), 300)
    return () => {
      alive = false
      clearTimeout(t)
    }
  }, [cwd])
  const initialSnap = useRef(JSON.stringify([folderId, item?.kind ?? 'chat', item?.name ?? '', item?.agent ?? 'claude', item?.sessionId ?? '', item?.cwd ?? '', item?.model ?? '', item?.command ?? '', item?.url ?? '']))
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

  const linkName = (): string => {
    try {
      return new URL(url.trim()).hostname || url.trim()
    } catch {
      return url.trim()
    }
  }
  const valid = (name.trim() || (kind === 'link' && LINK_RE.test(url.trim()))) && (kind === 'terminal' ? true : kind === 'link' ? LINK_RE.test(url.trim()) : agent !== 'custom' || command.trim())

  const warnedCwd = useRef(item?.cwd ?? '') // pasta ja salva antes (aceita) nao avisa de novo
  const [confirmCwd, setConfirmCwd] = useState(false)
  const [checking, setChecking] = useState(false)
  async function save(): Promise<void> {
    const c = cleanPath(cwd)
    if (checking) return
    setChecking(true) // pasta de rede pode levar segundos: o botao mostra que esta conferindo
    const ok = !c || kind === 'link' || warnedCwd.current === c || (await folderOk(c))
    setChecking(false)
    if (!ok) {
      warnedCwd.current = c // segundo Save grava mesmo assim
      setCwdMissing(true)
      return void setConfirmCwd(true)
    }
    if (kind === 'terminal' && item) {
      saveItem(folder, { ...item, name: name.trim(), cwd: cleanPath(cwd) || undefined })
      return onClose()
    }
    const newId = item?.id ?? uid()
    requestAnimationFrame(() => document.querySelector(`[data-item-id="${newId}"]`)?.scrollIntoView({ block: 'nearest' }))
    const base: SidebarItem = { id: newId, kind, name: name.trim() || (kind === 'link' ? linkName() : '') } // link sem nome: usa o host
    const next: SidebarItem =
      kind === 'link'
        ? { ...base, url: url.trim() }
        : {
            ...base,
            agent,
            // Claude: o Turno cria o id da sessao na hora para poder retomar depois com --resume.
            sessionId: sessionId.trim() || (claude ? uid() : undefined),
            cwd: cleanPath(cwd) || undefined,
            model: claude && agent === 'claude' ? model || undefined : undefined,
            command: command.trim() || undefined,
          }
    saveItem(folder, next)
    onClose()
  }

  return (
    <Modal title={item ? 'Edit item' : 'New item'} onClose={guardClose(JSON.stringify([folder, kind, name, agent, sessionId, cwd, model, command, url]) !== initialSnap.current, onClose)}>
      <div
        className="modal-body"
        onKeyDown={(e) => {
          // Enter num campo de uma linha salva (textarea e select seguem normais)
          const t = e.target as HTMLElement
          if (e.key === 'Enter' && !e.shiftKey && t.tagName === 'INPUT' && valid) (e.preventDefault(), save())
        }}
      >
        {kind !== 'terminal' && (
          <div className="seg">
            <button className={kind === 'chat' ? 'on' : ''} aria-pressed={kind === 'chat'} onClick={() => setKind('chat')}>Agent chat</button>
            <button className={kind === 'link' ? 'on' : ''} aria-pressed={kind === 'link'} onClick={() => setKind('link')}>Link</button>
          </div>
        )}
        <div className="grid2">
          <label className="field">
            <span>Name</span>
            <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder={kind === 'chat' ? 'e.g. Study Kubernetes' : kind === 'terminal' ? 'e.g. API server' : 'e.g. Chat on claude.ai'} />
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
              <div className="row">
                <input className="mono grow" value={cwd} onChange={(e) => setCwd(e.target.value)} placeholder="C:\projects\my-app" />
                <button className="btn" onClick={async () => { const d = await window.turno.ui.pickFolder(); if (d) setCwd(d) }} title="Choose folder" aria-label="Choose folder">
                  <IconFolder />
                </button>
              </div>
              {cwdMissing && <small className="tone-warn">This folder doesn't exist (or isn't a full path like C:\code\repo); the terminal will start in your home folder.{confirmCwd && cleanPath(cwd) === warnedCwd.current ? ' Click Save anyway to keep it.' : ''}</small>}
            </label>
            <small className="muted">
              {item?.sessionId ? `Reopens with claude --resume ${item.sessionId.slice(0, 8)}… in this folder.` : 'Reopens a terminal in this folder.'} The folder{item?.sessionId ? ' and session' : ''} update{item?.sessionId ? '' : 's'}{' '}
              automatically while the terminal is open.
            </small>
          </>
        ) : kind === 'link' ? (
          <label className="field">
            <span>URL</span>
            <input className="mono" aria-invalid={url.trim() && !LINK_RE.test(url.trim()) ? true : undefined} aria-describedby={url.trim() && !LINK_RE.test(url.trim()) ? 'link-hint' : undefined} value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://claude.ai/chat/…  ·  https://chatgpt.com/c/…" />
            {url.trim() && !LINK_RE.test(url.trim()) && <small id="link-hint" className="tone-err">{LINK_HINT}</small>}
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
              {cwdMissing && <small className="tone-warn">This folder doesn't exist (or isn't a full path like C:\code\repo); the terminal will start in your home folder.{confirmCwd && cleanPath(cwd) === warnedCwd.current ? ' Click Save anyway to keep it.' : ''}</small>}
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
                <span>Command ({'{id}'} = session id).{agent === 'custom' ? ' Required for a custom agent.' : ' Empty = automatic.'}</span>
                <input
                  className="mono"
                  value={command}
                  onChange={(e) => setCommand(e.target.value)}
                  placeholder={preset.resumeCmd || 'my-agent --resume {id}'}
                  aria-invalid={agent === 'custom' && !command.trim() && !!name.trim() ? true : undefined}
                  aria-describedby={agent === 'custom' && !command.trim() && !!name.trim() ? 'cmd-required' : undefined}
                />
                {agent === 'custom' && !command.trim() && !!name.trim() && <small id="cmd-required" className="tone-err">Type the command that starts this agent.</small>}
              </label>
            </details>
          </>
        )}
      </div>
      <footer className="modal-foot">
        <button className="btn ghost" onClick={onClose}>Cancel</button>
        <button className="btn primary" disabled={!valid} aria-busy={checking || undefined} onClick={save}>{checking ? 'Checking the folder…' : confirmCwd && cleanPath(cwd) === warnedCwd.current ? 'Save anyway' : 'Save'}</button>
      </footer>
    </Modal>
  )
}
