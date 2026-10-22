import { useSyncExternalStore } from 'react'
import { toast } from './Toast'
import { LINK_HINT } from '../../shared/links'
import type { AgentId, SidebarFolder, SidebarItem, SidebarState } from '../../shared/types'
import { discarded, openAgent, openTerminal, panelForItem, paramsOf, setTakenNames, type TerminalParams } from './layout'
import { isParked, killParked, parkedAgent, setLive } from './liveTerms'

// ---- estado das pastas da barra lateral (persistido em %APPDATA%\turno\sidebar.json) ----
let state: SidebarState = { collapsed: {}, folders: [] }
const subs = new Set<() => void>()

export function useSidebar(): SidebarState {
  return useSyncExternalStore(
    (cb) => (subs.add(cb), () => subs.delete(cb)),
    () => state,
  )
}

function commit(next: SidebarState): void {
  state = next
  subs.forEach((f) => f())
  saveNow(next)
}
let lastWarn = 0
function saveNow(s: SidebarState): void {
  void window.turno.sidebar.save(s).catch((e) => {
    const msg = String((e as Error).message).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
    // arquivo ilegivel desde a abertura: o aviso fixo da abertura ja explica
    if (/couldn't be read when Turno started/.test(msg)) return
    if (Date.now() - lastWarn < 10_000) return // falhas seguidas (cada clique grava): um aviso so
    lastWarn = Date.now()
    toast(msg.replace('the change was not saved', 'Turno will save it with your next change'), 'warn')
  })
}

export async function initSidebar(): Promise<void> {
  state = await window.turno.sidebar.get()
  subs.forEach((f) => f())
}

export const uid = (): string => crypto.randomUUID()

export const toggleSection = (key: string): void =>
  commit({ ...state, collapsed: { ...state.collapsed, [key]: !state.collapsed[key] } })

export const addFolder = (name: string): string => {
  const id = uid()
  commit({ ...state, folders: [...state.folders, { id, name, items: [] }] })
  return id
}

export const renameFolder = (id: string, name: string): void =>
  commit({ ...state, folders: state.folders.map((f) => (f.id === id ? { ...f, name } : f)) })

// MCPs do hub e cartao de contexto dos agentes abertos a partir desta pasta
export const patchFolder = (id: string, patch: { mcp?: string[]; context?: string }): void =>
  commit({ ...state, folders: state.folders.map((f) => (f.id === id ? { ...f, ...patch } : f)) })

export const deleteFolder = (id: string): void => {
  const gone = state.folders.find((f) => f.id === id)?.items ?? []
  const { [id]: _drop, ...collapsed } = state.collapsed // nao deixa o id da pasta sobrando em sidebar.json
  commit({ ...state, collapsed, folders: state.folders.filter((f) => f.id !== id) })
  gone.forEach((x) => detach(x.id))
}

export const moveFolder = (id: string, delta: -1 | 1): void => {
  const i = state.folders.findIndex((f) => f.id === id)
  const j = i + delta
  if (i < 0 || j < 0 || j >= state.folders.length) return
  const folders = [...state.folders]
  ;[folders[i], folders[j]] = [folders[j], folders[i]]
  commit({ ...state, folders })
}

// Salva o item na pasta indicada (move de pasta se mudou).
export const saveItem = (folderId: string, item: SidebarItem): void => {
  const folders: SidebarFolder[] = state.folders.map((f) => ({ ...f, items: f.items.filter((x) => x.id !== item.id) }))
  const target = folders.find((f) => f.id === folderId)
  if (!target) return
  const old = state.folders.find((f) => f.id === folderId)?.items.findIndex((x) => x.id === item.id) ?? -1
  if (old >= 0) target.items.splice(old, 0, item)
  else target.items.push(item)
  commit({ ...state, folders, collapsed: { ...state.collapsed, [folderId]: false } })
  syncTitle(item.id, item.name)
}

// Nome do item e titulo da aba andam juntos.
function syncTitle(itemId: string, name: string): void {
  const p = panelForItem(itemId)
  if (p && p.title !== name) p.api.setTitle(name)
}

// Atualizacao vinda de um terminal aberto (pasta/sessao mudaram): salva sem mexer na ordem.
let saveTimer: ReturnType<typeof setTimeout> | undefined
export function patchItem(itemId: string, patch: Partial<SidebarItem>): void {
  let changed = false
  const folders = state.folders.map((f) => ({
    ...f,
    items: f.items.map((x) => {
      if (x.id !== itemId) return x
      const next = { ...x, ...patch }
      if (JSON.stringify(next) !== JSON.stringify(x)) changed = true
      return next
    }),
  }))
  if (!changed) return
  if (patch.name) syncTitle(itemId, patch.name)
  state = { ...state, folders }
  subs.forEach((f) => f())
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => saveNow(state), 400)
}

const baseName = (p?: string): string => (p ? (p.split(/[\\/]/).filter(Boolean).pop() ?? p) : '')

// Aba de terminal solta numa pasta: vira item ligado a esse terminal.
export function addTerminalItem(folderId: string, params: TerminalParams, title: string): string {
  const s = params.lastSession
  const item: SidebarItem = {
    id: uid(),
    kind: 'terminal',
    name: title.trim() || s?.name || (params.lastCwd ? baseName(params.lastCwd) : 'terminal'), // mesmo nome da aba
    cwd: s?.cwd ?? params.lastCwd ?? params.cwd,
    shell: params.shell,
    profile: params.profile,
    ...(s ? { agent: 'claude' as const, sessionId: s.sessionId } : {}),
  }
  saveItem(folderId, item)
  return item.id
}

export const getItem = (itemId: string): SidebarItem | undefined =>
  state.folders.flatMap((f) => f.items).find((x) => x.id === itemId)
export const itemExists = (itemId: string): boolean => !!getItem(itemId)

// Item saiu da pasta: o terminal escondido morre; a aba aberta vira um terminal comum.
function detach(itemId: string): void {
  killParked(itemId)
  setLive(itemId)
  const p = panelForItem(itemId)
  if (p) p.api.updateParameters({ ...paramsOf(p), itemId: undefined })
}

export const deleteItem = (itemId: string): void => {
  commit({ ...state, folders: state.folders.map((f) => ({ ...f, items: f.items.filter((x) => x.id !== itemId) })) })
  detach(itemId)
}

// Fecha de vez o terminal do item (aberto ou escondido); o item continua na pasta.
export function closeItemTerminal(itemId: string): void {
  killParked(itemId)
  const p = panelForItem(itemId)
  if (p) {
    discarded.add(p.id)
    p.api.close()
  }
}

// ---- agentes: como abrir/retomar a sessao de cada CLI ----
export interface AgentPreset {
  id: AgentId
  name: string
  newCmd: string // sem sessao
  resumeCmd: string // {id} = id da sessao
  hasModel?: boolean
  note?: string
}

export const AGENTS: AgentPreset[] = [
  { id: 'claude', name: 'Claude Code', newCmd: 'claude --session-id {id}', resumeCmd: 'claude --resume {id}', hasModel: true },
  // modelo vem da conexao qwen-local (env ANTHROPIC_MODEL do terminal); flag de modelo aqui passaria por cima da config
  { id: 'claude-qwen', name: 'Claude Code with local Qwen', newCmd: 'claude --session-id {id}', resumeCmd: 'claude --resume {id}' },
  { id: 'codex', name: 'Codex CLI', newCmd: 'codex', resumeCmd: 'codex resume {id}' },
  { id: 'gemini', name: 'Gemini CLI', newCmd: 'gemini', resumeCmd: 'gemini --resume {id}', note: 'check the resume command for your version' },
  { id: 'qwen-code', name: 'Qwen Code', newCmd: 'qwen', resumeCmd: 'qwen --resume {id}', note: 'check the resume command for your version' },
  { id: 'opencode', name: 'OpenCode', newCmd: 'opencode', resumeCmd: 'opencode --session {id}' },
  { id: 'custom', name: 'Custom command', newCmd: '', resumeCmd: '' },
]

export const agentOf = (id?: AgentId): AgentPreset => AGENTS.find((a) => a.id === id) ?? AGENTS[0]

const isClaude = (a?: AgentId): boolean => a === 'claude' || a === 'claude-qwen'

// Monta o comando: Claude usa --session-id na 1a vez (id fixo criado pelo Turno) e --resume depois.
export async function resolveCommand(item: SidebarItem): Promise<string> {
  const agent = agentOf(item.agent)
  let cmd: string
  if (item.command?.trim()) cmd = item.command
  else if (isClaude(item.agent) && item.sessionId) {
    const exists = await window.turno.sidebar.claudeSessionExists(item.sessionId)
    cmd = exists ? agent.resumeCmd : agent.newCmd
  } else cmd = item.sessionId ? agent.resumeCmd : agent.newCmd
  cmd = cmd.replace(/\{id\}/g, item.sessionId ?? '')
  if (agent.hasModel && item.model && !/--model\b/.test(cmd)) cmd += ` --model ${item.model}`
  return cmd
}

export async function openItem(item: SidebarItem): Promise<void> {
  if (item.kind === 'link') {
    // erro vira toast (o alert() nativo travava a janela inteira)
    if (item.url) await window.turno.ui.openExternal(item.url).catch(() => toast(`Can't open this link. ${LINK_HINT}`, 'err'))
    return
  }
  // Ja aberto (inclusive a aba original que foi arrastada para a pasta): so foca.
  const open = panelForItem(item.id)
  if (open) return open.api.setActive()
  // Claude (sem comando proprio): abre pelo broker de contas — melhor conta do ranking, troca no limite,
  // MCPs e cartao de contexto da pasta. O historico e compartilhado entre contas, entao o resume funciona em qualquer uma.
  const folder = state.folders.find((f) => f.items.some((i) => i.id === item.id))
  // terminal com perfil (ex.: Qwen local) ou shell proprio segue pelo caminho antigo: nunca vai para uma conta paga
  const claudeItem = (item.kind === 'chat' && item.agent === 'claude' && !item.command?.trim()) || (item.kind === 'terminal' && !!item.sessionId && !item.profile && !item.shell)
  if (!isParked(item.id) && claudeItem) {
    const exists = item.sessionId ? await window.turno.sidebar.claudeSessionExists(item.sessionId) : false
    if (item.kind === 'terminal' && !exists) patchItem(item.id, { agent: undefined, sessionId: undefined })
    else
      return openAgent({
        agent: 'claude',
        model: item.model,
        resumeSessionId: exists ? item.sessionId : undefined,
        cwd: item.cwd || undefined,
        folderId: folder?.id,
        itemId: item.id,
        title: item.name,
        fixedId: `chat:${item.id}`,
        chrome: true,
      })
  }
  let cmd = ''
  if (isParked(item.id)) {
    // Aba escondida: o terminal continua vivo, so volta para a tela.
  } else if (item.kind === 'terminal') {
    // Reabre onde parou: retoma a ultima sessao do Claude, senao so o shell na ultima pasta.
    if (item.sessionId && /^[A-Za-z0-9_-]{1,128}$/.test(item.sessionId) && (await window.turno.sidebar.claudeSessionExists(item.sessionId)))
      cmd = `claude --resume ${item.sessionId} --chrome` // modelo: env da conexao do profile (nunca flag de modelo fixa)
    else if (item.sessionId) patchItem(item.id, { agent: undefined, sessionId: undefined }) // sessao sumiu: vira terminal comum
  } else cmd = await resolveCommand(item)
  openTerminal(
    undefined,
    {
      cwd: item.cwd || undefined,
      shell: item.shell,
      profile: item.profile ?? (item.agent === 'claude-qwen' ? 'qwen-local' : undefined),
      initialCommand: cmd || undefined,
      itemId: item.id,
      agent: isParked(item.id) ? (parkedAgent(item.id) as TerminalParams['agent']) : undefined,
    },
    item.name,
    undefined,
    `chat:${item.id}`, // mesmo item = mesma aba (clicar de novo so foca)
  )
}

// ---- arrastar aba do dockview para uma pasta ----
let dragging: { id: string; params: TerminalParams; title: string } | undefined
export const setDragging = (d: typeof dragging): void => void (dragging = d)
export const getDragging = (): typeof dragging => dragging

setTakenNames(() => state.folders.flatMap((f) => f.items.map((i) => i.name)))
