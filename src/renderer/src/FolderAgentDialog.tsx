import { useEffect, useState } from 'react'
import type { McpServerDef, SidebarFolder } from '../../shared/types'
import { Modal, guardClose } from './ItemDialog'
import { patchFolder } from './sidebarStore'
import { openSettingsModal } from './SettingsModal'

const MAX_LINES = 15

// Pasta › Agent setup: quais MCPs do hub e qual cartao de contexto os agentes abertos desta pasta recebem.
export function FolderAgentDialog({ folder, onClose }: { folder: SidebarFolder; onClose: () => void }) {
  const [servers, setServers] = useState<McpServerDef[]>([])
  const [loaded, setLoaded] = useState(false)
  const [picked, setPicked] = useState<string[]>(folder.mcp ?? [])
  const [context, setContext] = useState(folder.context ?? '')
  useEffect(() => {
    // servidores mudaram no Settings com o dialogo aberto: a lista acompanha
    const load = (): void => void window.turno.mcp.list().then((l) => (setServers(l), setLoaded(true)))
    load()
    window.addEventListener('turno:mcp-changed', load)
    return () => window.removeEventListener('turno:mcp-changed', load)
  }, [])
  const lines = context.trim() ? context.trim().split(/\r?\n/).length : 0 // o main corta depois do trim: linhas vazias no fim nao contam
  const tooLong = lines > MAX_LINES
  const save = (): void => {
    patchFolder(folder.id, { mcp: picked.filter((id) => servers.some((s) => s.id === id)), context: context.trim() || undefined })
    onClose()
  }
  return (
    <Modal
      title={`Agent setup · ${folder.name}`}
      // Esc/X/clique fora com algo mudado: pergunta antes de descartar (como os outros dialogos de item)
      onClose={guardClose(JSON.stringify([[...picked].sort(), context.trim()]) !== JSON.stringify([[...(folder.mcp ?? [])].sort(), (folder.context ?? '').trim()]), onClose)}
    >
      <div className="modal-body">
        <p className="muted small">Applies to agents opened from this folder's items (new sessions; a running agent keeps what it started with).</p>
        <fieldset className="field">
          <legend>MCP servers</legend>
          {servers.map((s) => (
            <label key={s.id} className="check-row">
              <input type="checkbox" checked={picked.includes(s.id)} onChange={(e) => setPicked(e.target.checked ? [...picked, s.id] : picked.filter((x) => x !== s.id))} />
              <span>{s.name}</span>
              <small className="muted mono">{s.url ?? s.command}</small>
            </label>
          ))}
          {loaded && picked.some((id) => !servers.some((s) => s.id === id)) && (
            <small className="tone-warn">
              {picked.filter((id) => !servers.some((s) => s.id === id)).map((id) => `"${id}"`).join(', ')} {picked.filter((id) => !servers.some((s) => s.id === id)).length > 1 ? 'were' : 'was'} removed from Settings › MCP: not sent, and dropped when you save.
            </small>
          )}
          {servers
            .filter((s) => picked.includes(s.id) && (s.secrets ?? []).some((n) => !s.secretSet?.[n]))
            .map((s) => (
              <small key={`sec-${s.id}`} className="tone-warn">"{s.name}" has no value for its secret yet: set it in Settings › MCP.</small>
            ))}
          {!servers.length && (
            <small className="muted">
              No servers yet.{' '}
              <button className="link" onClick={() => openSettingsModal('mcp')}>Add one in Settings</button>
            </small>
          )}
        </fieldset>
        <label className="field">
          <span>Context card (what the agent can't find out alone)</span>
          <textarea
            rows={6}
            value={context}
            onChange={(e) => setContext(e.target.value)}
            placeholder={'This repo = Sentry project "api-web", Jira project PAY.\nAWS profile acme-dev is fine; never write to acme-prod.\ngh is signed in as rafael.'}
            aria-invalid={tooLong || undefined}
            maxLength={2000}
          />
          <small className={tooLong ? 'tone-warn' : 'muted'}>{tooLong ? `Only the first ${MAX_LINES} lines are sent.` : 'Keep it short: 5 to 15 lines. Agents already see their tools; say what is specific to this folder.'}</small>
        </label>
      </div>
      <footer className="modal-foot">
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn primary" onClick={save}>Save</button>
      </footer>
    </Modal>
  )
}
