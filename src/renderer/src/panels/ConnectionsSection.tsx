import { useEffect, useState } from 'react'
import type { Connection, PreflightResult } from '../../../shared/types'
import { updateSettings, useSettings } from '../appearance'
import { connectionsReducer, newConnectionId, validateConnectionForm } from '../connectionsStore'
import { openTerminal } from '../layout'

// Comando de bootstrap do Claude Code (quando o binario nao existe). Editavel; confirme em docs.claude.com.
const CLAUDE_INSTALL_CMD = 'npm install -g @anthropic-ai/claude-code'

// Aba Conexoes: gerencia os provedores de IA. Claude = login OAuth do CLI (sem segredo guardado aqui).
// Endpoint = Anthropic-compativel (Ollama, OpenAI-compat via shim): baseUrl + model + token (cofre).
export function ConnectionsSection() {
  const s = useSettings()
  const [claudeOk, setClaudeOk] = useState<boolean | null>(null)
  const [busy, setBusy] = useState(false)
  const [draft, setDraft] = useState<Connection | null>(null)
  const [token, setToken] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [checks, setChecks] = useState<Record<string, PreflightResult | 'checking'>>({})

  const check = async (c: Connection): Promise<void> => {
    setChecks((m) => ({ ...m, [c.id]: 'checking' }))
    const r = await window.turno.provider.preflight(c.id).catch((): PreflightResult => ({ state: 'endpoint_unreachable', message: 'check failed' }))
    setChecks((m) => ({ ...m, [c.id]: r }))
  }

  const refreshClaude = (): void => void window.turno.provider.claudeStatus().then(setClaudeOk)
  useEffect(() => refreshClaude(), [])
  if (!s) return null
  const conns = s.connections
  const saveList = (list: Connection[]): Promise<void> => updateSettings({ connections: list })

  const connectClaude = async (): Promise<void> => {
    setBusy(true)
    await window.turno.provider.claudeLogin().catch(() => {})
    setBusy(false)
    refreshClaude()
  }
  const logoutClaude = async (): Promise<void> => {
    setBusy(true)
    await window.turno.provider.claudeLogout().catch(() => {})
    setBusy(false)
    refreshClaude()
  }

  const startAdd = (): void => {
    setDraft({ id: '', name: '', kind: 'endpoint', baseUrl: '', model: '' })
    setToken('')
    setErr(null)
  }
  const startEdit = (c: Connection): void => {
    setDraft({ ...c })
    setToken('')
    setErr(null)
  }

  const save = async (): Promise<void> => {
    if (!draft) return
    const e = validateConnectionForm(draft)
    if (e) return setErr(e)
    const isNew = !draft.id
    const id = draft.id || newConnectionId(conns, draft.name)
    let conn: Connection = { ...draft, id }
    if (token.trim()) {
      const ref = await window.turno.provider.setToken(id, token.trim())
      conn = { ...conn, tokenRef: ref, token: undefined }
    }
    await saveList(isNew ? connectionsReducer(conns, { type: 'add', conn }) : connectionsReducer(conns, { type: 'update', id, patch: conn }))
    setDraft(null)
  }
  const remove = async (c: Connection): Promise<void> => {
    if (c.tokenRef) await window.turno.provider.deleteToken(c.id).catch(() => {})
    await saveList(connectionsReducer(conns, { type: 'remove', id: c.id }))
  }

  return (
    <section className="card">
      <h3>Connections</h3>
      <p className="muted small">Where the AI comes from. Claude signs in through its own CLI; other providers are Anthropic-compatible endpoints.</p>
      <div className="conn-list">
        {conns.map((c) => (
          <div key={c.id} className="conn-row row">
            <div className="grow">
              <strong>{c.name}</strong> <span className="tag">{c.kind}</span>
              {c.kind === 'endpoint' && <div className="muted small mono">{c.baseUrl} · {c.model}{c.tokenRef ? ' · token saved' : ''}</div>}
              {c.kind === 'claude' && <div className="muted small">{claudeOk == null ? 'checking…' : claudeOk ? 'connected' : 'not connected'}</div>}
              {checks[c.id] && <div className={`small ${checks[c.id] !== 'checking' && (checks[c.id] as PreflightResult).state === 'ok' ? 'tone-ok' : 'tone-warn'}`}>{checks[c.id] === 'checking' ? 'checking…' : (checks[c.id] as PreflightResult).message}</div>}
              {checks[c.id] !== 'checking' && (checks[c.id] as PreflightResult | undefined)?.state === 'missing_binary' && (
                <div className="row small">
                  <code className="mono">{CLAUDE_INSTALL_CMD}</code>
                  <button className="btn ghost" onClick={() => openTerminal('right', { initialCommand: CLAUDE_INSTALL_CMD }, 'Install Claude Code')}>Install in terminal</button>
                  <button className="btn ghost" onClick={() => void navigator.clipboard.writeText(CLAUDE_INSTALL_CMD)}>Copy</button>
                </div>
              )}
            </div>
            <button className="btn ghost" onClick={() => void check(c)}>Check</button>
            {c.kind === 'claude' ? (
              claudeOk ? (
                <button className="btn ghost" disabled={busy} onClick={() => void logoutClaude()}>Disconnect</button>
              ) : (
                <button className="btn" disabled={busy} onClick={() => void connectClaude()}>Connect</button>
              )
            ) : (
              <>
                <button className="btn ghost" onClick={() => startEdit(c)}>Edit</button>
                <button className="btn ghost" onClick={() => void remove(c)}>Remove</button>
              </>
            )}
          </div>
        ))}
      </div>

      {draft ? (
        <div className="conn-form card">
          <div className="grid2">
            <label className="field"><span>Name</span><input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></label>
            <label className="field"><span>Type</span>
              <select value={draft.kind} onChange={(e) => setDraft({ ...draft, kind: e.target.value as Connection['kind'] })}>
                <option value="endpoint">Endpoint (Anthropic-compatible)</option>
                <option value="claude">Claude (CLI login)</option>
              </select>
            </label>
          </div>
          {draft.kind === 'endpoint' && (
            <div className="grid2">
              <label className="field"><span>Base URL</span><input className="mono" value={draft.baseUrl ?? ''} placeholder="http://localhost:11434" onChange={(e) => setDraft({ ...draft, baseUrl: e.target.value })} /></label>
              <label className="field"><span>Model</span><input className="mono" value={draft.model ?? ''} placeholder="qwen3.6:35b" onChange={(e) => setDraft({ ...draft, model: e.target.value })} /></label>
              <label className="field"><span>Token {draft.tokenRef ? '(leave blank to keep)' : '(optional)'}</span><input className="mono" type="password" value={token} onChange={(e) => setToken(e.target.value)} /></label>
            </div>
          )}
          {err && <div className="banner banner-err">{err}</div>}
          <div className="row">
            <button className="btn primary" onClick={() => void save()}>Save</button>
            <button className="btn ghost" onClick={() => setDraft(null)}>Cancel</button>
          </div>
        </div>
      ) : (
        <button className="btn" onClick={startAdd}>+ Add provider</button>
      )}
    </section>
  )
}
