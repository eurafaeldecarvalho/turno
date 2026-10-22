import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { McpServerDef, McpStatusRow } from '../shared/types'
import { readJson, writeJsonAtomic } from './jsonStore'
import { getSecret, setSecret, deleteSecret } from './secrets'
import { getSidebar } from './sidebar'

// Hub de MCP: um lugar so para cadastrar servidores e segredos. O Turno injeta, POR SESSAO OU ROTINA, so o conjunto
// escolhido (--mcp-config com placeholders ${TURNO_MCP_*}; os valores vao no env do processo filho, vindos do cofre).
// Nunca escreve nos configs dos agentes (~/.claude.json etc.) e nunca chama ferramentas MCP ele mesmo.
const file = (): string => join(app.getPath('userData'), 'mcp-hub.json')
const sessDir = (): string => join(app.getPath('userData'), 'agent-sessions')

let servers: McpServerDef[] | undefined
// ids de servidores removidos: nunca sao reaproveitados (pastas e rotinas que ainda citam o id nao ganham um servidor
// novo sem o usuario escolher)
let retired: string[] = []
let blocked = false

function load(): McpServerDef[] {
  if (servers) return servers
  const r = readJson<{ servers?: McpServerDef[]; retired?: string[] }>(file())
  blocked = !r.ok
  retired = r.ok && Array.isArray(r.data?.retired) ? r.data!.retired.filter((x) => typeof x === 'string') : []
  const list = r.ok && Array.isArray(r.data?.servers) ? r.data!.servers : []
  servers = list.filter((s) => s && typeof s.id === 'string' && (s.transport === 'stdio' || s.transport === 'http'))
  return servers
}
function save(): void {
  if (blocked) throw new Error("mcp-hub.json couldn't be read when Turno started; changes aren't saved")
  writeJsonAtomic(file(), { servers, retired })
}

export const listMcp = (): McpServerDef[] => load().map((s) => ({ ...s, secretSet: Object.fromEntries((s.secrets ?? []).map((n) => [n, !!getSecret(secretKey(s.id, n))])) }))
const secretKey = (id: string, name: string): string => `mcp:${id}:${name}`
const envName = (id: string, name: string): string => `TURNO_MCP_${id.replace(/[^A-Za-z0-9]/g, '_').toUpperCase()}_${name.replace(/[^A-Za-z0-9]/g, '_').toUpperCase()}`

// Grava/atualiza um servidor. Segredos (valores de headers/env marcados como secretos) vao para o cofre;
// valor vazio mantem o que ja estava.
export function saveMcp(def: McpServerDef, secretValues: Record<string, string> = {}): McpServerDef {
  const list = load()
  let id = def.id?.trim() || ''
  if (!id) {
    // servidor novo: id derivado do nome, sem nunca sobrescrever outro com o mesmo nome (ex.: dois Sentry)
    const baseId = def.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 36) || 'server'
    id = baseId
    let n = 1
    while (list.some((s) => s.id === id) || retired.includes(id)) id = `${baseId}-${++n}`
  }
  // nome igual ao de outro servidor: o novo ganha o proximo numero livre ("Sentry 2"); editar para um nome repetido e recusado
  const taken = (nm: string): boolean => list.some((s) => s.id !== id && s.name.trim().toLowerCase() === nm.trim().toLowerCase())
  if (taken(def.name)) {
    if (def.id?.trim()) throw new Error(`Another server is already named "${def.name.trim()}". Pick a different name.`)
    let k = 2
    while (taken(`${def.name.trim()} ${k}`)) k++
    def = { ...def, name: `${def.name.trim()} ${k}` }
  }
  if (!/^[a-z0-9][a-z0-9-]{0,40}$/.test(id)) throw new Error('id: use lowercase letters, numbers and hyphens')
  if (def.transport === 'http' && !/^https?:\/\//i.test(def.url ?? '')) throw new Error('URL must start with http:// or https://')
  if (def.transport === 'stdio' && !def.command?.trim()) throw new Error('command is required')
  const clean: McpServerDef = {
    id,
    name: def.name.trim() || id,
    transport: def.transport,
    command: def.transport === 'stdio' ? def.command?.trim() : undefined,
    args: def.transport === 'stdio' ? (def.args ?? []).filter(Boolean) : undefined,
    url: def.transport === 'http' ? def.url?.trim() : undefined,
    headers: def.headers ?? {},
    env: def.env ?? {},
    secrets: [...new Set(def.secrets ?? [])],
    everyTab: !!def.everyTab,
    note: def.note?.trim() || undefined,
    preset: def.preset,
  }
  const dup = clean.secrets!.find((n, i, all) => all.findIndex((x) => x.toUpperCase() === n.toUpperCase()) !== i)
  if (dup) throw new Error(`secret name "${dup}" repeats another one (names are case-insensitive)`)
  const bad = clean.secrets!.find((n) => !/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(n))
  if (bad) throw new Error(`secret name "${bad}": use letters, numbers and _ (like GITHUB_TOKEN)`)
  for (const [n, v] of Object.entries(secretValues)) if (v && clean.secrets!.includes(n)) setSecret(secretKey(id, n), v)
  const i = list.findIndex((s) => s.id === id)
  // nome de segredo que saiu da lista: apaga o valor guardado (senao voltaria sozinho num servidor novo com o mesmo id)
  if (i >= 0) for (const n of list[i].secrets ?? []) if (!clean.secrets!.includes(n)) deleteSecret(secretKey(id, n))
  if (i >= 0) list[i] = clean
  else list.push(clean)
  save()
  return clean
}

export function removeMcp(id: string): void {
  const list = load()
  const s = list.find((x) => x.id === id)
  for (const n of s?.secrets ?? []) deleteSecret(secretKey(id, n))
  servers = list.filter((x) => x.id !== id)
  if (!retired.includes(id)) retired.push(id)
  save()
}

// JSON do --mcp-config (so placeholders) + env com os valores reais. Id desconhecido e ignorado (nunca amplia).
function buildConfig(ids: string[]): { json: unknown; env: Record<string, string>; used: string[] } {
  const list = load()
  const env: Record<string, string> = {}
  const mcpServers: Record<string, unknown> = {}
  const used: string[] = []
  for (const id of [...new Set(ids)]) {
    const s = list.find((x) => x.id === id)
    if (!s) continue
    const sub = (map: Record<string, string> = {}): Record<string, string> => {
      const out: Record<string, string> = { ...map }
      for (const n of s.secrets ?? []) {
        const v = getSecret(secretKey(s.id, n))
        if (v == null) continue
        env[envName(s.id, n)] = v
        // o segredo substitui o valor de mesmo nome em headers/env, ou um ${NOME} dentro dele
        for (const k of Object.keys(out)) if (k === n) out[k] = `\${${envName(s.id, n)}}`
        for (const k of Object.keys(out)) out[k] = out[k].split(`\${${n}}`).join(`\${${envName(s.id, n)}}`)
      }
      return out
    }
    // ${NOME} na URL e nos argumentos tambem vira o placeholder do env (o Claude Code expande ${VAR} em url/args)
    const inText = (t: string): string => {
      for (const n of s.secrets ?? []) if (getSecret(secretKey(s.id, n)) != null) t = t.split(`\${${n}}`).join(`\${${envName(s.id, n)}}`)
      return t
    }
    mcpServers[`turno-${s.id}`] =
      s.transport === 'http'
        ? { type: 'http', url: inText(s.url ?? ''), headers: sub(s.headers) }
        : { type: 'stdio', command: s.command, args: (s.args ?? []).map(inText), env: sub(s.env) }
    used.push(s.id)
  }
  return { json: { mcpServers }, env, used }
}

// Extras do Claude Code numa aba de agente: MCPs da pasta (ou os marcados para toda aba) e o cartao de contexto.
// A ordem importa: --mcp-config aceita varios arquivos e engoliria um argumento solto depois dele.
export function claudeLaunchExtras(o: { key: string; folderId?: string; cwd?: string }): { args: string; env: Record<string, string> } {
  const folder = o.folderId ? getSidebar().folders.find((f) => f.id === o.folderId) : undefined
  const ids = folder ? folder.mcp ?? [] : load().filter((s) => s.everyTab).map((s) => s.id)
  return sessionExtras(o.key, ids, folder?.context)
}

export function sessionExtras(key: string, ids: string[], context?: string): { args: string; env: Record<string, string> } {
  mkdirSync(sessDir(), { recursive: true })
  const parts: string[] = []
  let env: Record<string, string> = {}
  if (ids.length) {
    const c = buildConfig(ids)
    if (c.used.length) {
      const f = join(sessDir(), `${key}.mcp.json`)
      writeFileSync(f, JSON.stringify(c.json, null, 2), { mode: 0o600 })
      parts.push(`--mcp-config "${f}"`)
      env = c.env
    }
  }
  const card = cardText(context)
  if (card) {
    const f = join(sessDir(), `${key}.context.md`)
    writeFileSync(f, card)
    parts.push(`--append-system-prompt-file "${f}"`)
  }
  return { args: parts.join(' '), env }
}

// Cartao de contexto: so o que o agente nao descobre sozinho (5-15 linhas). Corta para nao virar um prompt gigante.
// limites do cartao de contexto (os mesmos que a UI avisa e o ROUTINE.md aceita)
export const CARD_MAX_LINES = 15
export const CARD_MAX_CHARS = 2000

export function cardText(context?: string): string {
  const t = (context ?? '').trim()
  if (!t) return ''
  const lines = t.split(/\r?\n/).slice(0, CARD_MAX_LINES)
  return `Environment notes from Turno (set by the user for this folder):\n${lines.join('\n').slice(0, CARD_MAX_CHARS)}`
}

// Rotina: argv para o runner (claude -p). Lista vazia = nenhum servidor do hub.
export function routineMcpArgs(runId: string, ids: string[], strict: boolean, context?: string): { args: string[]; env: Record<string, string> } {
  const out: string[] = []
  let env: Record<string, string> = {}
  mkdirSync(sessDir(), { recursive: true })
  if (ids.length) {
    const c = buildConfig(ids)
    if (c.used.length) {
      const f = join(sessDir(), `run-${runId}.mcp.json`)
      writeFileSync(f, JSON.stringify(c.json, null, 2), { mode: 0o600 })
      out.push('--mcp-config', f)
      env = c.env
    }
  }
  if (strict) out.push('--strict-mcp-config')
  const card = cardText(context)
  if (card) out.push('--append-system-prompt', card)
  return { args: out, env }
}

// Checagem antes de rotina agendada: servidores HTTP alcancaveis (sem gastar nada). stdio nao da para testar sem rodar.
export async function precheckMcp(ids: string[]): Promise<string | null> {
  const list = load()
  for (const id of ids) {
    const s = list.find((x) => x.id === id)
    if (!s) continue // servidor removido do hub: a rotina so deixa de recebe-lo (como a UI promete), nao e pulada
    for (const n of s.secrets ?? []) if (getSecret(secretKey(s.id, n)) == null) return `MCP server "${s.name}" is missing its secret "${n}"`
    if (s.transport !== 'http' || !s.url) continue
    try {
      await fetch(s.url, { method: 'GET', signal: AbortSignal.timeout(5000) })
    } catch {
      return `MCP server "${s.name}" is unreachable (${s.url})`
    }
  }
  return null
}

// Painel de status: servidores do hub + os que os agentes ja carregam sozinhos (so leitura).
export function mcpStatus(cwd?: string): McpStatusRow[] {
  const rows: McpStatusRow[] = load().map((s) => ({ source: 'turno', id: s.id, name: s.name, transport: s.transport, target: s.url ?? [s.command, ...(s.args ?? [])].join(' ') }))
  const read = (f: string): Record<string, { url?: string; command?: string; args?: string[]; type?: string }> => {
    try {
      return JSON.parse(readFileSync(f, 'utf8')).mcpServers ?? {}
    } catch {
      return {}
    }
  }
  const claudeJson = process.env.CLAUDE_CONFIG_DIR ? join(process.env.CLAUDE_CONFIG_DIR, '.claude.json') : join(homedir(), '.claude.json')
  for (const [n, v] of Object.entries(read(claudeJson))) rows.push({ source: 'claude-user', id: n, name: n, transport: v.url ? 'http' : 'stdio', target: v.url ?? [v.command, ...(v.args ?? [])].join(' ') })
  if (cwd && existsSync(join(cwd, '.mcp.json')))
    for (const [n, v] of Object.entries(read(join(cwd, '.mcp.json')))) rows.push({ source: 'project', id: n, name: n, transport: v.url ? 'http' : 'stdio', target: v.url ?? [v.command, ...(v.args ?? [])].join(' ') })
  const codexToml = join(process.env.CODEX_HOME || join(homedir(), '.codex'), 'config.toml')
  if (existsSync(codexToml)) {
    for (const m of readFileSync(codexToml, 'utf8').matchAll(/^\[mcp_servers\.([^\]]+)\]/gm)) rows.push({ source: 'codex', id: m[1], name: m[1], transport: 'stdio', target: '' })
  }
  return rows
}
