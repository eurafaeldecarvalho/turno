import { useSyncExternalStore } from 'react'
import type { AgentId, SidebarFolder, SidebarItem, SidebarState } from '../../shared/types'
import { openTerminal, panelForItem, type TerminalParams } from './layout'

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
  void window.turno.sidebar.save(next)
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

export const deleteFolder = (id: string): void => commit({ ...state, folders: state.folders.filter((f) => f.id !== id) })

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
  state = { ...state, folders }
  subs.forEach((f) => f())
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => void window.turno.sidebar.save(state), 400)
}

const baseName = (p?: string): string => (p ? (p.split(/[\\/]/).filter(Boolean).pop() ?? p) : '')

// Aba de terminal solta numa pasta: vira item ligado a esse terminal.
export function addTerminalItem(folderId: string, params: TerminalParams, title: string): string {
  const s = params.lastSession
  const item: SidebarItem = {
    id: uid(),
    kind: 'terminal',
    name: s?.name || (s ? `Claude · ${baseName(s.cwd)}` : '') || (params.lastCwd ? baseName(params.lastCwd) : title),
    cwd: s?.cwd ?? params.lastCwd ?? params.cwd,
    shell: params.shell,
    profile: params.profile,
    ...(s ? { agent: 'claude' as const, sessionId: s.sessionId } : {}),
  }
  saveItem(folderId, item)
  return item.id
}

export const deleteItem = (itemId: string): void =>
  commit({ ...state, folders: state.folders.map((f) => ({ ...f, items: f.items.filter((x) => x.id !== itemId) })) })

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
  { id: 'claude-qwen', name: 'Claude Code com Qwen local', newCmd: 'claude --session-id {id} --model qwen3.6:35b', resumeCmd: 'claude --resume {id} --model qwen3.6:35b' },
  { id: 'codex', name: 'Codex CLI', newCmd: 'codex', resumeCmd: 'codex resume {id}' },
  { id: 'gemini', name: 'Gemini CLI', newCmd: 'gemini', resumeCmd: 'gemini --resume {id}', note: 'confira o comando de retomada da sua versão' },
  { id: 'qwen-code', name: 'Qwen Code', newCmd: 'qwen', resumeCmd: 'qwen --resume {id}', note: 'confira o comando de retomada da sua versão' },
  { id: 'opencode', name: 'OpenCode', newCmd: 'opencode', resumeCmd: 'opencode --session {id}' },
  { id: 'custom', name: 'Comando personalizado', newCmd: '', resumeCmd: '' },
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
    if (item.url) await window.turno.ui.openExternal(item.url).catch((e) => alert(String(e.message ?? e)))
    return
  }
  // Ja aberto (inclusive a aba original que foi arrastada para a pasta): so foca.
  const open = panelForItem(item.id)
  if (open) return open.api.setActive()
  let cmd = ''
  if (item.kind === 'terminal') {
    // Reabre onde parou: retoma a ultima sessao do Claude, senao so o shell na ultima pasta.
    if (item.sessionId && (await window.turno.sidebar.claudeSessionExists(item.sessionId)))
      cmd = `claude --resume ${item.sessionId}${item.profile === 'qwen-local' ? ' --model qwen3.6:35b' : ''}`
  } else cmd = await resolveCommand(item)
  openTerminal(
    undefined,
    {
      cwd: item.cwd || undefined,
      shell: item.shell,
      profile: item.profile ?? (item.agent === 'claude-qwen' ? 'qwen-local' : undefined),
      initialCommand: cmd || undefined,
      itemId: item.id,
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
