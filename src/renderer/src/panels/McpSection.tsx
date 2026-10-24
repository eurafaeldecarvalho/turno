import { useEffect, useRef, useState } from 'react'
import type { McpServerDef, McpStatusRow } from '../../../shared/types'
import { askConfirm } from '../ConfirmDialog'
import { toast } from '../Toast'
import { setSettingsCloseGuard } from '../SettingsModal'
import { getStore } from '../store'
import { getSidebarState } from '../sidebarStore'
import { plural } from '../fmt'
import { Switch } from './RoutineEditor'

const errText = (e: unknown): string => String((e as Error)?.message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

// Presets curtos: so os que a pesquisa achou que valem (resto entra como "Custom").
interface Preset { id: string; label: string; def: Omit<McpServerDef, 'id'>; hint: string }
const PRESETS: Preset[] = [
  { id: 'sentry', label: 'Sentry', def: { name: 'Sentry', transport: 'http', url: 'https://mcp.sentry.dev/mcp', preset: 'sentry' }, hint: 'Signs in with OAuth inside the agent the first time (in Claude Code: /mcp). Narrow it to one project with https://mcp.sentry.dev/mcp/<org>/<project>.' },
  { id: 'atlassian', label: 'Jira + Confluence (Atlassian)', def: { name: 'Atlassian', transport: 'http', url: 'https://mcp.atlassian.com/v1/mcp', preset: 'atlassian' }, hint: 'Atlassian Cloud. Signs in with OAuth inside the agent the first time.' },
  {
    id: 'bitbucket',
    label: 'Bitbucket Cloud (Atlassian)',
    def: { name: 'Bitbucket', transport: 'http', url: 'https://mcp.atlassian.com/v1/mcp', headers: { Authorization: 'Basic ${ATLASSIAN_BASIC}' }, secrets: ['ATLASSIAN_BASIC'], preset: 'bitbucket' },
    hint: 'Bitbucket tools need an Atlassian API token (no OAuth yet) and an org admin must allow API tokens for the Rovo MCP server. Secret = base64 of "email:api-token".',
  },
  {
    id: 'github',
    label: 'GitHub (read only)',
    def: { name: 'GitHub', transport: 'http', url: 'https://api.githubcopilot.com/mcp/readonly', headers: { Authorization: 'Bearer ${GITHUB_TOKEN}' }, secrets: ['GITHUB_TOKEN'], preset: 'github' },
    hint: 'A fine-grained personal access token. Often the gh CLI is enough and costs fewer tokens.',
  },
  { id: 'playwright', label: 'Playwright (browser)', def: { name: 'Playwright', transport: 'stdio', command: 'npx', args: ['-y', '@playwright/mcp'], preset: 'playwright' }, hint: 'Runs locally through npx (downloads the package on first use).' },
  { id: 'custom', label: 'Custom server', def: { name: '', transport: 'http', url: '' }, hint: 'Any MCP server: an https URL, or a command that speaks MCP over stdio.' },
]

const linesToMap = (t: string): Record<string, string> =>
  Object.fromEntries(t.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => { const i = l.search(/[:=]/); return i > 0 ? [l.slice(0, i).trim(), l.slice(i + 1).trim()] : [l, ''] }))
// argumentos separados por espaco; "entre aspas" mantem espacos (ex.: caminhos em Program Files)
// (como num shell: aspas duplas ou simples, inclusive no meio da palavra, ex.: --root="C:/My Docs").
// Aspa sem fechar = null (o editor avisa e nao salva).
function splitArgs(t: string): string[] | null {
  const out: string[] = []
  let cur = ''
  let has = false
  let quote = ''
  for (const ch of t) {
    if (quote ? ch === quote : ch === '"' || ch === "'") {
      quote = quote ? '' : ch
      has = true
    } else if (!quote && /\s/.test(ch)) {
      if (has) out.push(cur)
      cur = ''
      has = false
    } else {
      cur += ch
      has = true
    }
  }
  if (quote) return null
  if (has) out.push(cur)
  return out
}
// mostra um argumento como ele seria digitado (com aspas se tiver espaco)
const showArg = (a: string): string => (/[\s"']/.test(a) ? (a.includes('"') ? `'${a}'` : `"${a}"`) : a)
const mapToLines = (m?: Record<string, string>): string => Object.entries(m ?? {}).map(([k, v]) => `${k}: ${v}`).join('\n')

function Editor({ init, hint, onDone, guard }: { init: McpServerDef; hint?: string; onDone: () => void; guard: { current?: (next: () => void) => void } }) {
  const [d, setD] = useState(init)
  const [headers, setHeaders] = useState(mapToLines(init.headers))
  const [env, setEnv] = useState(mapToLines(init.env))
  const [args, setArgs] = useState((init.args ?? []).map(showArg).join(' '))
  const parsedArgs = d.transport === 'stdio' ? splitArgs(args) : []
  const [secretNames, setSecretNames] = useState((init.secrets ?? []).join(', '))
  const [values, setValues] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [nameErr, setNameErr] = useState('')
  const nameRef = useRef<HTMLInputElement>(null)
  // sem repetir, nem so por maiuscula/minuscula (as duas virariam a mesma variavel de ambiente)
  const names = secretNames
    .split(',')
    .map((s) => s.trim())
    .filter((s, i, all) => s && all.findIndex((x) => x.toUpperCase() === s.toUpperCase()) === i)
  // ${NOME} usado na URL, headers, env ou argumentos sem estar nos segredos: o Turno nao preenche (so o env do agente)
  const used = (d.transport === 'http' ? [d.url ?? '', headers] : [env, args]).join('\n')
  const undeclared = [...new Set([...used.matchAll(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g)].map((m) => m[1]))].filter((n) => !names.includes(n))
  // Esc com algo digitado (inclusive um segredo): pergunta antes de jogar fora, como em Connections
  const dirty =
    JSON.stringify([d.name, d.url ?? '', d.command ?? '', !!d.everyTab, headers, env, args, secretNames]) !==
      JSON.stringify([init.name, init.url ?? '', init.command ?? '', !!init.everyTab, mapToLines(init.headers), mapToLines(init.env), (init.args ?? []).map(showArg).join(' '), (init.secrets ?? []).join(', ')]) ||
    Object.values(values).some(Boolean)
  // sair do editor por qualquer caminho (Esc, Cancel, Edit de outro servidor) pergunta antes de perder o que foi digitado
  const leave = (next: () => void): void => {
    if (!dirty) return next()
    void askConfirm({ title: 'Discard changes?', message: 'What you typed for this server will be lost.', confirmLabel: 'Discard' }).then((ok) => ok && next())
  }
  guard.current = leave
  const cancel = (): void => leave(onDone)
  // mesmas regras do main, conferidas antes: erro no proprio campo e foco nele (como em Connections)
  const [fieldErr, setFieldErr] = useState<{ field: 'url' | 'command' | 'headers' | 'env'; msg: string } | null>(null)
  const urlRef = useRef<HTMLInputElement>(null)
  const cmdRef = useRef<HTMLInputElement>(null)
  const headersRef = useRef<HTMLTextAreaElement>(null)
  const envRef = useRef<HTMLTextAreaElement>(null)
  const save = async (): Promise<void> => {
    // linha sem "NOME: valor" (ou com nome invalido) seria salva como nome estranho e valor vazio
    const badLine = (t: string, re: RegExp): string | undefined =>
      t.split('\n').map((l) => l.trim()).filter(Boolean).find((l) => { const i = l.search(/[:=]/); return i <= 0 || !re.test(l.slice(0, i).trim()) })
    const badH = d.transport === 'http' ? badLine(headers, /^[A-Za-z0-9!#$%&'*+.^_`|~-]+$/) : undefined
    if (badH) {
      setFieldErr({ field: 'headers', msg: `"${badH.slice(0, 60)}" is not "Name: value".` })
      return void headersRef.current?.focus()
    }
    const badE = d.transport === 'stdio' ? badLine(env, /^[A-Za-z_][A-Za-z0-9_]*$/) : undefined
    if (badE) {
      setFieldErr({ field: 'env', msg: `"${badE.slice(0, 60)}" is not "NAME: value" (letters, digits and _ in the name).` })
      return void envRef.current?.focus()
    }
    if (d.transport === 'http' && !/^https?:\/\//i.test((d.url ?? '').trim())) {
      setFieldErr({ field: 'url', msg: 'URL must start with http:// or https://' })
      return void urlRef.current?.focus()
    }
    if (d.transport === 'stdio' && !(d.command ?? '').trim()) {
      setFieldErr({ field: 'command', msg: 'Type the command that starts the server (e.g. npx).' })
      return void cmdRef.current?.focus()
    }
    setBusy(true)
    try {
      const saved = await window.turno.mcp.save(
        // so os campos do transporte escolhido (trocar de HTTP para comando nao leva headers escondidos junto)
        { ...d, headers: d.transport === 'http' ? linesToMap(headers) : {}, env: d.transport === 'stdio' ? linesToMap(env) : {}, args: d.transport === 'stdio' ? (parsedArgs ?? []) : [], secrets: names },
        values,
      )
      // servidor novo com nome ja usado ganha numero: avisa (editar para um nome repetido e recusado)
      if (saved.name !== d.name.trim()) toast(`"${d.name.trim()}" was already taken, so this server was saved as "${saved.name}".`, 'info')
      onDone()
    } catch (e) {
      const msg = errText(e)
      // nome repetido: erro no proprio campo e foco nele (como em Connections); o resto continua como aviso
      if (/already named/i.test(msg)) {
        setNameErr(msg)
        nameRef.current?.focus()
      } else toast(msg, 'err')
    } finally {
      setBusy(false)
    }
  }
  return (
    // Esc cancela so o editor (o Settings continua aberto)
    <div className="mcp-editor" data-esc-local onKeyDown={(e) => e.key === 'Escape' && (e.stopPropagation(), cancel())}>
      {hint && <p className="muted small">{hint}</p>}
      <div className="grid2">
        <label className="field">
          <span>Name</span>
          <input ref={nameRef} autoFocus value={d.name} aria-invalid={nameErr ? true : undefined} aria-describedby={nameErr ? 'mcp-name-err' : undefined} onChange={(e) => (setD({ ...d, name: e.target.value }), setNameErr(''))} />
          {nameErr && <small id="mcp-name-err" className="tone-err">{nameErr}</small>}
        </label>
        <label className="field">
          <span>Transport</span>
          <select value={d.transport} onChange={(e) => setD({ ...d, transport: e.target.value as McpServerDef['transport'] })}>
            <option value="http">HTTP (remote URL)</option>
            <option value="stdio">Command (local)</option>
          </select>
        </label>
      </div>
      {d.transport === 'http' ? (
        <>
          <label className="field">
            <span>URL</span>
            <input ref={urlRef} className="mono" value={d.url ?? ''} aria-invalid={fieldErr?.field === 'url' || undefined} aria-describedby={fieldErr?.field === 'url' ? 'mcp-url-err' : undefined} onChange={(e) => (setD({ ...d, url: e.target.value }), setFieldErr(null))} placeholder="https://…/mcp" />
            {fieldErr?.field === 'url' && <small id="mcp-url-err" className="tone-err">{fieldErr.msg}</small>}
          </label>
          <label className="field">
            <span>Headers (one per line, Name: value; use {'${SECRET}'} for secrets)</span>
            <textarea ref={headersRef} className="mono" rows={2} value={headers} aria-invalid={fieldErr?.field === 'headers' || undefined} aria-describedby={fieldErr?.field === 'headers' ? 'mcp-headers-err' : undefined} onChange={(e) => (setHeaders(e.target.value), setFieldErr(null))} />
            {fieldErr?.field === 'headers' && <small id="mcp-headers-err" className="tone-err">{fieldErr.msg}</small>}
          </label>
        </>
      ) : (
        <>
          <div className="grid2">
            <label className="field">
              <span>Command</span>
              <input ref={cmdRef} className="mono" value={d.command ?? ''} aria-invalid={fieldErr?.field === 'command' || undefined} aria-describedby={fieldErr?.field === 'command' ? 'mcp-cmd-err' : undefined} onChange={(e) => (setD({ ...d, command: e.target.value }), setFieldErr(null))} />
              {fieldErr?.field === 'command' && <small id="mcp-cmd-err" className="tone-err">{fieldErr.msg}</small>}
            </label>
            <label className="field">
              <span>Arguments (quote paths with spaces)</span>
              <input className="mono" value={args} aria-invalid={!parsedArgs || undefined} onChange={(e) => setArgs(e.target.value)} />
              {!parsedArgs && <small className="tone-err">A quote is not closed.</small>}
            </label>
          </div>
          <label className="field">
            <span>Environment (one per line, NAME: value)</span>
            <textarea ref={envRef} className="mono" rows={2} value={env} aria-invalid={fieldErr?.field === 'env' || undefined} aria-describedby={fieldErr?.field === 'env' ? 'mcp-env-err' : undefined} onChange={(e) => (setEnv(e.target.value), setFieldErr(null))} />
            {fieldErr?.field === 'env' && <small id="mcp-env-err" className="tone-err">{fieldErr.msg}</small>}
          </label>
        </>
      )}
      <label className="field"><span>Secret names (comma separated). Values stay in Windows' encrypted store and reach the agent session as environment variables, so commands it runs can read them: prefer read-only tokens.</span><input className="mono" value={secretNames} onChange={(e) => setSecretNames(e.target.value)} placeholder="GITHUB_TOKEN" /></label>
      {undeclared.length > 0 && (
        <small className="tone-warn">
          {undeclared.map((n) => `\${${n}}`).join(', ')} {undeclared.length > 1 ? 'are' : 'is'} not in Secret names: the agent gets it only if that variable already exists in its environment.
        </small>
      )}
      {names.map((n) => (
        <label className="field" key={n}>
          <span>{n}{init.secretSet?.[n] ? ' (saved; leave empty to keep)' : ''}</span>
          <input type="password" autoComplete="off" value={values[n] ?? ''} onChange={(e) => setValues({ ...values, [n]: e.target.value })} />
        </label>
      ))}
      <label className="field toggle-field">
        <span>Also give it to agent tabs opened outside a folder</span>
        <Switch checked={!!d.everyTab} onChange={(v) => setD({ ...d, everyTab: v })} />
      </label>
      <div className="row">
        <button className="btn primary" disabled={!d.name.trim() || !parsedArgs} aria-busy={busy || undefined} onClick={() => void (!busy && save())}>Save server</button>
        <button className="btn ghost" onClick={cancel}>Cancel</button>
      </div>
    </div>
  )
}

// Settings › MCP servers: um lugar so para os servidores. O Turno os injeta por pasta/rotina (nunca edita os configs dos agentes).
export function McpSection() {
  const [list, setList] = useState<McpServerDef[]>([])
  const [status, setStatus] = useState<McpStatusRow[]>([])
  const [edit, setEdit] = useState<{ def: McpServerDef; hint?: string; n?: number } | null>(null)
  // editor aberto: fechar o Settings (X, fundo, Esc fora do editor) passa pela mesma pergunta de descartar
  useEffect(() => {
    if (!edit) return
    setSettingsCloseGuard((next) => (guard.current ? guard.current(() => (setEdit(null), next())) : next()))
    return () => setSettingsCloseGuard(undefined)
  }, [!!edit])
  const guard = useRef<(next: () => void) => void>(undefined)
  // editor fechou (salvar, cancelar, Esc): o foco volta para "Add a server…" depois que ele reaparece
  const wasEditing = useRef(false)
  useEffect(() => {
    if (wasEditing.current && !edit) document.getElementById('mcp-add')?.focus()
    wasEditing.current = !!edit
  }, [edit])
  const [preset, setPreset] = useState('')
  const reload = (): void => {
    void window.turno.mcp.list().then(setList)
    void window.turno.mcp.status().then(setStatus)
  }
  useEffect(reload, [])
  const start = (id: string): void => {
    const p = PRESETS.find((x) => x.id === id)
    if (!p) return
    setEdit({ def: { id: '', ...p.def }, hint: p.hint })
    setPreset('')
  }
  const remove = async (s: McpServerDef): Promise<void> => {
    // quantas rotinas e pastas usam, como no Remove de Connections
    const nRoutines = getStore().routines.filter((r) => r.config.mcp?.includes(s.id)).length
    const nFolders = getSidebarState().folders.filter((f) => f.mcp?.includes(s.id)).length
    const using = [nRoutines && plural(nRoutines, 'routine'), nFolders && plural(nFolders, 'folder')].filter(Boolean).join(' and ')
    if (!(await askConfirm({ title: 'Remove MCP server', message: `Remove "${s.name}" and its saved secrets? ${using ? `${using} ${nRoutines + nFolders === 1 ? 'uses' : 'use'} it and will stop getting it.` : 'No folder or routine uses it.'}`, confirmLabel: 'Remove' }))) return
    await window.turno.mcp.remove(s.id).catch((e) => toast(errText(e), 'err'))
    if (edit?.def.id === s.id) setEdit(null) // o editor aberto era deste servidor: Save o traria de volta
    window.dispatchEvent(new Event('turno:mcp-changed'))
    reload()
    // a linha removida tinha o foco: volta para "Add a server…" ou, com o editor aberto, para ele
    requestAnimationFrame(() => (document.getElementById('mcp-add') ?? document.querySelector<HTMLElement>('.mcp-editor input'))?.focus())
  }
  const outside = status.filter((r) => r.source !== 'turno')
  return (
    <section className="card" id="settings-mcp">
      <h3>MCP servers</h3>
      <p className="muted small">
        Set servers up once here. Pick them per folder (folder menu › Agent setup) and per routine; Turno passes only those to the agent it opens. Your own agent configs are never changed.
      </p>
      <ul className="mcp-list">
        {list.map((s) => (
          <li key={s.id}>
            <span className="mcp-main">
              <strong>{s.name}</strong>
              <small className="muted mono">{s.url ?? [s.command, ...(s.args ?? []).map(showArg)].join(' ')}</small>
              {(s.secrets ?? []).some((n) => !s.secretSet?.[n]) && <small className="tone-warn">Missing secret value</small>}
              {s.everyTab && <small className="muted">also in agent tabs outside folders</small>}
            </span>
            <button className="btn ghost small" onClick={() => (edit && guard.current ? guard.current(() => setEdit({ def: s, n: (edit.n ?? 0) + 1 })) : setEdit({ def: s }))}>Edit</button>
            <button className="btn ghost small danger" onClick={() => void remove(s)}>Remove</button>
          </li>
        ))}
        {!list.length && !edit && <li className="muted small">No servers yet.</li>}
      </ul>
      {edit ? (
        <Editor key={`${edit.def.id || edit.hint || 'new'}:${edit.n ?? 0}`} guard={guard} init={edit.def} hint={edit.hint} onDone={() => (setEdit(null), reload(), window.dispatchEvent(new Event('turno:mcp-changed')))} />
      ) : (
        <div className="row">
          {/* escolher so seleciona (setas do teclado navegam sem abrir nada); o botao abre o editor */}
          <select id="mcp-add" aria-label="Add an MCP server" value={preset} onChange={(e) => setPreset(e.target.value)}>
            <option value="">Add a server…</option>
            {PRESETS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
          <button className="btn" disabled={!preset} onClick={() => start(preset)}>Add</button>
        </div>
      )}
      {outside.length > 0 && (
        <details className="mcp-outside">
          <summary className="small">Already configured in your agents ({outside.length}, read only)</summary>
          <ul>
            {outside.map((r) => (
              <li key={`${r.source}-${r.id}`} className="small">
                <strong>{r.name}</strong> <span className="muted">· {r.source === 'claude-user' ? 'Claude Code (user)' : r.source === 'codex' ? 'Codex' : 'this project (.mcp.json)'}{r.target ? ` · ${r.target}` : ''}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  )
}
