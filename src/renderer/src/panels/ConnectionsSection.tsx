import { useEffect, useRef, useState } from 'react'
import { claudeInstallCommand } from '../../../shared/agents'
import { toast } from '../Toast'
import { plural } from '../fmt'
import type { Connection, PreflightResult } from '../../../shared/types'
import { updateSettings, useSettings } from '../appearance'
import { connectionsReducer, newConnectionId, validateConnectionForm } from '../connectionsStore'
import { installAgent } from '../layout'
import { useStore } from '../store'
import { askConfirm } from '../ConfirmDialog'
import { CATALOG, CatalogPicker, type CatalogEntry } from './CatalogPicker'
import { setSettingsCloseGuard } from '../SettingsModal'

// Comando de bootstrap do Claude Code (quando o binario nao existe). Editavel; confirme em docs.claude.com.
const CLAUDE_INSTALL_CMD = claudeInstallCommand(window.turno.winBuild ? 'win32' : 'linux') // instalador oficial, sem Node

// Aba Conexoes: gerencia os provedores de IA. Claude = login OAuth do CLI (sem segredo guardado aqui).
// Endpoint = Anthropic-compativel (Ollama, OpenAI-compat via shim): baseUrl + model + token (cofre).
export function ConnectionsSection() {
  const s = useSettings()
  const routines = useStore((st) => st.routines)
  const [claudeOk, setClaudeOk] = useState<boolean | null>(null)
  const [busy, setBusy] = useState(false)
  const [draft, setDraft] = useState<Connection | null>(null)
  const [token, setToken] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const nameRef = useRef<HTMLInputElement>(null)
  const urlRef = useRef<HTMLInputElement>(null)
  const modelRef = useRef<HTMLInputElement>(null)
  const keyRef = useRef<HTMLInputElement>(null)
  // corrigiu o campo: a mensagem de erro antiga some
  useEffect(() => setErr(null), [draft?.name, draft?.baseUrl, draft?.model, draft?.kind])
  const addRef = useRef<HTMLButtonElement>(null)
  const [checks, setChecks] = useState<Record<string, PreflightResult | 'checking'>>({})
  const [picking, setPicking] = useState(false)

  const check = async (c: Connection): Promise<void> => {
    setChecks((m) => ({ ...m, [c.id]: 'checking' }))
    const r = await window.turno.provider.preflight(c.id).catch((): PreflightResult => ({ state: 'endpoint_unreachable', message: 'check failed' }))
    setChecks((m) => ({ ...m, [c.id]: r }))
  }

  // formulario aberto com algo digitado: trocar de pagina ou fechar o Settings pergunta antes de descartar
  const typedRef = useRef(false)
  // mudou algo em relacao a como o formulario abriu (conexao nova ou edicao de uma existente), ou digitou chave
  const draftInit = useRef('')
  const openDraft = (d: Connection): void => {
    draftInit.current = JSON.stringify(d)
    setDraft(d)
  }
  typedRef.current = !!draft && (JSON.stringify(draft) !== draftInit.current || !!token.trim())
  useEffect(() => {
    if (!draft) return
    setSettingsCloseGuard((next) =>
      typedRef.current ? void askConfirm({ title: 'Discard changes?', message: draftInit.current.includes('"id":""') ? 'The provider you started adding will be lost.' : 'Your changes to this provider will be lost.', confirmLabel: 'Discard' }).then((ok) => ok && (setDraft(null), next())) : next(),
    )
    return () => setSettingsCloseGuard(undefined)
  }, [!!draft])
  const refreshClaude = (): void => void window.turno.provider.claudeStatus().then(setClaudeOk)
  useEffect(() => refreshClaude(), [])
  if (!s) return null
  const conns = s.connections
  const catEntry = draft?.catalogId ? CATALOG.find((e) => e.id === draft.catalogId) : undefined
  const saveList = (list: Connection[]): Promise<boolean> => updateSettings({ connections: list })

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

  // Fecha o formulario devolvendo o foco a quem abriu. Pelo Esc, se ja tem algo digitado num provider novo, pergunta antes.
  const cancelForm = (ask: boolean): void => {
    if (!draft) return
    const editedId = draft.id
    const close = (): void => {
      setDraft(null)
      requestAnimationFrame(() => {
        const edit = editedId ? document.querySelector<HTMLElement>(`[data-edit-conn="${CSS.escape(editedId)}"]`) : null
        ;(edit ?? addRef.current)?.focus()
      })
    }
    if (!ask || !typedRef.current) return close()
    void askConfirm({ title: 'Discard changes?', message: draft.id ? 'Your changes to this provider will be lost.' : 'The provider you started adding will be lost.', confirmLabel: 'Discard' }).then((ok) => ok && close())
  }

  const startAdd = (): void => {
    openDraft({ id: '', name: '', kind: 'endpoint', baseUrl: '', model: '' })
    setToken('')
    setErr(null)
  }
  // escolheu no catalogo: preenche o formulario (formato Anthropic vai direto; OpenAI passa pelo tradutor)
  const fromCatalog = (e: CatalogEntry): void => {
    setPicking(false)
    openDraft({
      id: '',
      name: e.name,
      kind: 'endpoint',
      // o CLI acrescenta /v1/messages sozinho: base Anthropic sem o /v1 final
      baseUrl: e.style === 'anthropic' ? e.baseUrl.replace(/\/v1$/, '') : e.baseUrl,
      model: e.models?.[0] ?? '',
      via: e.style === 'anthropic' ? 'direct' : 'translate',
      catalogId: e.id,
    })
    setToken('')
    setErr(null)
    // o resto ja veio preenchido: com chave exigida, o foco vai direto para o campo da chave
    if (e.needsKey) setTimeout(() => keyRef.current?.focus(), 60)
  }
  const startEdit = (c: Connection): void => {
    openDraft({ ...c })
    setToken('')
    setErr(null)
  }

  const save = async (): Promise<void> => {
    if (!draft) return
    const e = validateConnectionForm(draft)
    if (e) {
      setErr(e)
      return void (/name/i.test(e) ? nameRef.current?.focus() : /url/i.test(e) ? urlRef.current?.focus() : /model/i.test(e) && modelRef.current?.focus())
    }
    // nome repetido deixaria dois "Claude Code on X" iguais no menu New e no editor de rotina
    if (conns.some((c) => c.id !== draft.id && c.name.trim().toLowerCase() === draft.name.trim().toLowerCase())) {
      setErr(`A connection named "${draft.name.trim()}" already exists. Pick another name.`)
      return void nameRef.current?.focus()
    }
    // provedor do catalogo que exige chave: salvar sem ela daria uma conexao que nunca funciona
    if (catEntry?.needsKey && !token.trim() && !draft.tokenRef) {
      setErr(`${draft.name || 'This provider'} needs an API key. Paste it in API key.`)
      return void keyRef.current?.focus()
    }
    const isNew = !draft.id
    const id = draft.id || newConnectionId(conns, draft.name)
    let conn: Connection = { ...draft, id, name: draft.name.trim() }
    // token novo: o cofre so e gravado depois que o settings.json aceitou a conexao (falhou = nada muda)
    if (token.trim()) conn = { ...conn, tokenRef: `conn:${id}`, token: undefined }
    if (!(await saveList(isNew ? connectionsReducer(conns, { type: 'add', conn }) : connectionsReducer(conns, { type: 'update', id, patch: conn })))) return
    if (token.trim()) {
      const ok = await window.turno.provider.setToken(id, token.trim()).then(() => true, () => false)
      if (!ok) return void toast("The connection was saved, but its token couldn't be stored. Edit it and type the token again.", 'warn')
    }
    setDraft(null)
    // foco no Edit da conexao salva (ou em Add from catalog), como no Cancel
    requestAnimationFrame(() => (document.querySelector<HTMLElement>(`[data-edit-conn="${CSS.escape(id)}"]`) ?? addRef.current)?.focus())
  }
  const remove = async (c: Connection): Promise<void> => {
    const using = routines.filter((r) => r.config.profile === c.id).length
    // sempre confirma: a conexao some com URL, modelo, comandos e token, sem desfazer
    const ok = await askConfirm({
      title: 'Remove connection',
      message:
        using > 0
          ? `${plural(using, 'routine')} ${using === 1 ? 'uses' : 'use'} "${c.name}" and will be skipped until pointed at another connection. Remove anyway?`
          : `Remove "${c.name}"? Its settings${c.tokenRef ? ' and saved token' : ''} will be deleted.`,
      confirmLabel: 'Remove',
    })
    if (!ok) return
    // remove do settings.json primeiro: falhou = conexao, token e formulario aberto ficam como estavam
    if (!(await saveList(connectionsReducer(conns, { type: 'remove', id: c.id })))) return
    if (draft?.id === c.id) setDraft(null) // formulario de edicao dele nao fica aberto com dados apagados
    if (c.tokenRef) await window.turno.provider.deleteToken(c.id).catch(() => {})
    requestAnimationFrame(() => addRef.current?.focus()) // a linha removida tinha o foco
  }

  return (
    <section className="card">
      <h3>Connections</h3>
      <p className="muted small">Where the AI comes from. Claude signs in through its own CLI. Other providers are endpoints: Anthropic-compatible ones are used directly, OpenAI-compatible ones go through Turno's local translator.</p>
      <div className="conn-list">
        {conns.map((c) => {
          const chk = checks[c.id]
          const res = chk && chk !== 'checking' ? chk : undefined
          return (
            <div key={c.id} className="conn-row">
              <div className="conn-info">
                <div className="conn-title">
                  <strong title={c.name}>{c.name}</strong>
                  <span className="pill">{c.kind}</span>
                  {c.via === 'translate' && <span className="pill" title="OpenAI-compatible: Claude Code talks to Turno's local translator">via translator</span>}
                </div>
                {c.kind === 'endpoint' && <div className="muted small mono conn-meta" title={`${c.baseUrl} · ${c.model}`}>{c.baseUrl} · {c.model}{c.tokenRef ? ' · token saved' : ''}</div>}
                {c.kind === 'claude' && (
                  <div className="muted small conn-status">
                    <span className={`dot ${claudeOk == null ? 'dot-idle' : claudeOk ? 'dot-ok' : 'dot-err'}`} />
                    {claudeOk == null ? 'checking…' : claudeOk ? 'connected' : 'not connected'}
                  </div>
                )}
                {chk && <div className={`small ${res?.state === 'ok' ? 'tone-ok' : chk === 'checking' ? 'muted' : 'tone-warn'}`}>{chk === 'checking' ? 'checking…' : res!.message}</div>}
                {res?.state === 'missing_binary' && (
                  <div className="row small wrap">
                    <code className="mono">{CLAUDE_INSTALL_CMD}</code>
                    <button className="btn ghost small" onClick={() => installAgent('claude')}>Install in terminal</button>
                    <button className="btn ghost small" onClick={() => void navigator.clipboard.writeText(CLAUDE_INSTALL_CMD)}>Copy</button>
                  </div>
                )}
              </div>
              <button className="btn small" aria-busy={chk === 'checking' || undefined} onClick={() => void (chk !== 'checking' && check(c))}>Check</button>
              {c.kind === 'claude' ? (
                claudeOk ? (
                  <button className="btn ghost small conn-span" disabled={busy} onClick={() => void logoutClaude()}>Disconnect</button>
                ) : (
                  <button className="btn primary small conn-span" disabled={busy} onClick={() => void connectClaude()}>Connect</button>
                )
              ) : (
                <>
                  <button className="btn ghost small" data-edit-conn={c.id} onClick={() => startEdit(c)}>Edit</button>
                  <button className="btn ghost small btn-danger-text" onClick={() => void remove(c)}>Remove</button>
                </>
              )}
            </div>
          )
        })}
      </div>

      {draft ? (
        <div
          className="conn-form"
          data-esc-local
          onKeyDown={(e) => {
            // Esc descarta so o formulario, nao o Settings inteiro
            if (e.key !== 'Escape') return
            e.preventDefault()
            cancelForm(true)
          }}
        >
          <div className="grid2">
            <label className="field"><span>Name</span><input ref={nameRef} autoFocus aria-invalid={err && /name/i.test(err) ? true : undefined} aria-describedby={err && /name/i.test(err) ? 'conn-err' : undefined} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></label>
            <label className="field"><span>Type</span>
              <select value={draft.kind} onChange={(e) => setDraft({ ...draft, kind: e.target.value as Connection['kind'] })}>
                <option value="endpoint">Endpoint</option>
                <option value="claude">Claude CLI</option>
              </select>
            </label>
          </div>
          {draft.kind === 'endpoint' && (
            <div className="grid2">
              <label className="field"><span>Base URL</span><input ref={urlRef} className="mono" aria-invalid={err && /url/i.test(err) ? true : undefined} aria-describedby={err && /url/i.test(err) ? 'conn-err' : undefined} value={draft.baseUrl ?? ''} placeholder="http://localhost:11434" onChange={(e) => setDraft({ ...draft, baseUrl: e.target.value })} /></label>
              <label className="field"><span>Model</span><input ref={modelRef} className="mono" aria-invalid={err && /model/i.test(err) ? true : undefined} aria-describedby={err && /model/i.test(err) ? 'conn-err' : undefined} value={draft.model ?? ''} placeholder="qwen3:14b" list="conn-models" onChange={(e) => setDraft({ ...draft, model: e.target.value })} /></label>
              <datalist id="conn-models">{(catEntry?.models ?? []).map((m) => <option key={m} value={m} />)}</datalist>
              <label className="field"><span>{catEntry?.needsKey ? 'API key' : 'Token'} {draft.tokenRef ? '(leave blank to keep)' : catEntry?.needsKey ? '' : '(optional)'}</span><input ref={keyRef} className="mono" type="password" aria-invalid={err && /api key/i.test(err) ? true : undefined} aria-describedby={err && /api key/i.test(err) ? 'conn-err' : undefined} value={token} onChange={(e) => (setToken(e.target.value), setErr(null))} /></label>
              <label className="field"><span>API format</span>
                <select value={draft.via ?? 'direct'} onChange={(e) => setDraft({ ...draft, via: e.target.value as Connection['via'] })}>
                  <option value="direct">Anthropic (Claude Code talks to it directly)</option>
                  <option value="translate">OpenAI (through Turno's translator)</option>
                </select>
              </label>
            </div>
          )}
          {draft.kind === 'endpoint' && catEntry && (
            <p className="muted small">
              {catEntry.authNotes ?? 'Create an API key on the provider site and paste it above.'}{' '}
              {catEntry.docsUrl && <button className="link" onClick={() => void window.turno.ui.openExternal(catEntry.docsUrl!).catch(() => {})}>Open {catEntry.name}</button>}
            </p>
          )}
          {draft.kind === 'endpoint' && draft.via === 'translate' && (
            <p className="muted small">Tools, images and streaming are translated; Anthropic-only features (web search, extended thinking) aren't available on this provider.</p>
          )}
          {err && <div id="conn-err" className="banner banner-err" role="alert">{err}</div>}
          <div className="row">
            <button className="btn primary" onClick={() => void save()}>Save</button>
            <button className="btn ghost" onClick={() => cancelForm(false)}>Cancel</button>
          </div>
        </div>
      ) : picking ? (
        <CatalogPicker onPick={fromCatalog} onClose={() => (setPicking(false), requestAnimationFrame(() => addRef.current?.focus()))} />
      ) : (
        <div className="row">
          <button ref={addRef} className="btn conn-add" onClick={() => setPicking(true)}>+ Add from catalog ({CATALOG.length} providers)</button>
          <button className="btn ghost" onClick={startAdd}>Custom provider</button>
        </div>
      )}
    </section>
  )
}
