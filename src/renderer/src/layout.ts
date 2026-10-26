import { useSyncExternalStore } from 'react'
import { agentDef, agentStartCwd } from '../../shared/agents'
import { getSettingsSnapshot } from './appearance'
import { askConfirm } from './ConfirmDialog'
import type { DockviewApi, Direction } from 'dockview-react'
import type { ProfileId, TermSession } from '../../shared/types'

// Ponto unico para abrir paineis no dockview (sidebar, atalhos, botoes dos paineis).
let api: DockviewApi | undefined
let _tabDisposables: Array<{ dispose(): void }> = []
export const setDockApi = (a: DockviewApi): void => {
  _tabDisposables.forEach((d) => d.dispose())
  api = a
  _tabDisposables = [a.onDidAddPanel(syncOpenTabs), a.onDidRemovePanel(syncOpenTabs), a.onDidActivePanelChange(syncOpenTabs)]
}
export const dockApi = (): DockviewApi | undefined => api

const uid = (p: string): string => `${p}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
// Numeracao por tipo: o primeiro Claude e "claude 1", nao "claude 6".
const termCounts: Record<string, number> = {}
// nomes de itens das pastas (a sidebar registra; layout nao importa sidebarStore para evitar ciclo)
let takenNames: () => string[] = () => []
export const setTakenNames = (f: () => string[]): void => void (takenNames = f)

type Dir = Exclude<Direction, 'within'> | undefined

function place(dir: Dir, refId?: string) {
  const ref = refId ? api?.getPanel(refId) : api?.activePanel
  if (!ref) return {}
  return dir ? { position: { referencePanel: ref.id, direction: dir } } : refId ? { position: { referenceGroup: ref.group, direction: 'within' as const } } : {}
}

export interface TerminalParams {
  shell?: string
  cwd?: string
  profile?: ProfileId
  initialCommand?: string
  itemId?: string // item da sidebar que este terminal atualiza
  lastCwd?: string // pasta atual (OSC 9;9 do prompt)
  lastSession?: TermSession // sessao do Claude Code rodando aqui
  launchId?: string // env preparado pelo main (ex.: login de uma conta numa pasta isolada); vale uma vez
  agent?: AgentTermParams // aba de agente (botao Agent): conta escolhida pelo ranking, troca na mesma aba
}

export interface AgentTermParams {
  key: string // conversa no Turno (sobrevive a trocas de conta)
  agent?: string // agente pedido (sem = melhor conta de qualquer agente)
  accountId?: string // conta atual/pedida
  resumeSessionId?: string // sessao nativa para retomar ao reabrir
  prompt?: string // primeiro prompt (so no 1o lancamento)
  chrome?: boolean
  folderId?: string // pasta da sidebar: MCPs e cartao de contexto da pasta
  model?: string // modelo do item da pasta (Claude: --model)
}

// Paineis fechados de vez (nao escondidos), mesmo sendo de um item de pasta.
export const discarded = new Set<string>()

// ---- modal de edicao de rotinas ----
let _routineEditState: { id: string | null } | null = null
const _routineEditSubs = new Set<() => void>()
const _emitRoutineEdit = (): void => _routineEditSubs.forEach((f) => f())

export function openRoutineEditorModal(id: string | null): void {
  // editor dessa rotina ja aberto por baixo (Runs/run abertos a partir dele): fecha o que esta por cima
  if (id && _routineEditState?.id === id && _panelModal) return closePanelModal()
  _routineEditState = { id }
  _emitRoutineEdit()
}
let _routineEditGuard: (() => boolean) | undefined
export const setRoutineEditGuard = (g: (() => boolean) | undefined): void => void (_routineEditGuard = g)
export function closeRoutineEditorModal(): void {
  const done = (): void => {
    _routineEditState = null
    _emitRoutineEdit()
  }
  if (!_routineEditGuard?.()) return done()
  void askConfirm({ title: 'Discard changes?', message: 'This routine has changes that were not saved.', confirmLabel: 'Discard' }).then((ok) => ok && done())
}
export function useRoutineEditorModal(): { id: string | null } | null {
  return useSyncExternalStore(
    (cb) => (_routineEditSubs.add(cb), () => _routineEditSubs.delete(cb)),
    () => _routineEditState,
  )
}

// ---- modal de paineis (run, history, adhoc, fanout) ----
export type PanelModalState =
  | { kind: 'run'; runId: string; title: string; back?: { routine?: string } }
  | { kind: 'history'; routine?: string; keepFilter?: boolean }
  | { kind: 'adhoc' }
  | { kind: 'fanout' }

let _panelModal: PanelModalState | null = null
const _panelModalSubs = new Set<() => void>()
const _emitPanel = (): void => _panelModalSubs.forEach((f) => f())

export function closePanelModal(): void {
  _panelModal = null
  _emitPanel()
}
export function usePanelModal(): PanelModalState | null {
  return useSyncExternalStore(
    (cb) => (_panelModalSubs.add(cb), () => _panelModalSubs.delete(cb)),
    () => _panelModal,
  )
}

// Reactive list of open panels (not linked to a sidebar folder) — shown in the Sidebar.
export interface OpenTab {
  id: string
  title: string
  kind: string
  agent?: boolean // terminal rodando Claude (icone de chat, como o botao da nav)
  active?: boolean
  routineId?: string // aba de rotina
  runId?: string // aba de run
  profile?: string // conexao do terminal (claude-max, qwen-local...)
  command?: string // comando inicial (pode ter --model)
  agentKey?: string // aba de agente: conversa no broker (status, conta)
}
let _openTabs: OpenTab[] = []
let _termTotal = 0
const _tabSubs = new Set<() => void>()
const _emitTabs = (): void => _tabSubs.forEach((f) => f())

function syncOpenTabs(): void {
  if (!api) return
  _openTabs = api.panels
    .filter((p) => !(paramsOf(p) as TerminalParams & { kind?: string }).itemId)
    .map((p) => {
      const pr = paramsOf(p) as TerminalParams & { kind?: string; routineId?: string; runId?: string }
      const agent = !!pr.agent || pr.profile === 'claude-max' || /^claude\b/.test(pr.initialCommand ?? '') || !!pr.lastSession
      return { id: p.id, title: p.title ?? '', kind: pr.kind ?? 'terminal', agent, active: api!.activePanel?.id === p.id, routineId: pr.routineId, runId: pr.runId, profile: pr.profile, command: pr.initialCommand, agentKey: pr.agent?.key }
    })
  // Status bar: todos os terminais abertos, inclusive os que ja estao numa pasta da sidebar.
  _termTotal = api.panels.filter((p) => (paramsOf(p) as { kind?: string }).kind === 'terminal').length
  // aba de agente focada por ultimo (inclusive as de pasta): a conta "ativa" do rodape e do Switch account
  const focusedKey = api.activePanel ? (paramsOf(api.activePanel) as TerminalParams).agent?.key : undefined
  const keys = new Set(api.panels.map((p) => (paramsOf(p) as TerminalParams).agent?.key).filter(Boolean))
  _agentKey = focusedKey ?? (_agentKey && keys.has(_agentKey) ? _agentKey : undefined)
  _emitTabs()
}

let _agentKey: string | undefined
export const getActiveAgentKey = (): string | undefined => _agentKey
export function useActiveAgentKey(): string | undefined {
  return useSyncExternalStore(
    (cb) => (_tabSubs.add(cb), () => _tabSubs.delete(cb)),
    () => _agentKey,
  )
}

export function useOpenTabs(): OpenTab[] {
  return useSyncExternalStore(
    (cb) => (_tabSubs.add(cb), () => _tabSubs.delete(cb)),
    () => _openTabs,
  )
}

export function useTerminalTotal(): number {
  return useSyncExternalStore(
    (cb) => (_tabSubs.add(cb), () => _tabSubs.delete(cb)),
    () => _termTotal,
  )
}

// Rotina renomeada: a aba da sessao (e a lista Open tabs) acompanham o nome novo.
export function syncRoutineTitles(names: Map<string, string>): void {
  if (!api) return
  let changed = false
  for (const p of api.panels) {
    const pr = paramsOf(p) as { kind?: string; routineId?: string; customTitle?: boolean }
    const name = pr.kind === 'session' && pr.routineId && !pr.customTitle ? names.get(pr.routineId) : undefined
    if (name && p.title !== name) {
      p.api.setTitle(name)
      changed = true
    }
  }
  if (changed) syncOpenTabs()
}

// Renomear uma aba pela lista Open tabs da sidebar.
export function renameTab(id: string, title: string): void {
  const p = api?.getPanel(id)
  p?.api.setTitle(title)
  if (p && (paramsOf(p) as { kind?: string }).kind === 'session') p.api.updateParameters({ ...paramsOf(p), customTitle: true }) // syncRoutineTitles respeita
  syncOpenTabs()
  saveLayout()
}

export function focusTab(id: string): void {
  const p = api?.getPanel(id)
  if (!p) return
  const wasMax = api!.hasMaximizedGroup()
  if (wasMax && !p.api.isMaximized()) api!.exitMaximizedGroup()
  p.api.setActive()
  // com maximizado, o painel so aceita foco depois de reorganizar: entrega o teclado a ele
  // o teclado vai junto para a aba (terminal, rotina, chat); com maximizado, so depois de reorganizar
  setTimeout(() => window.dispatchEvent(new CustomEvent('turno:focus-panel', { detail: id })), wasMax ? 120 : 30)
}

export function closeTab(id: string): void {
  api?.getPanel(id)?.api.close()
}

// O dockview guarda os params em dois lugares que divergem (panel.params x api.getParameters()):
// sempre ler a uniao, com as atualizacoes por cima.
export function paramsOf(p: { params?: unknown; api: { getParameters?: () => unknown } }): TerminalParams & { kind?: string } {
  return { ...((p.params as object) ?? {}), ...((p.api.getParameters?.() as object) ?? {}) }
}

export function panelForItem(itemId: string) {
  return api?.panels.find((p) => paramsOf(p).itemId === itemId)
}

// Aba de agente (botao Agent): a conta sai do ranking; o main troca de conta na mesma aba quando a cota acaba.
export function openAgent(o: { agent?: string; accountId?: string; model?: string; prompt?: string; cwd?: string; folderId?: string; itemId?: string; resumeSessionId?: string; chrome?: boolean; dir?: Dir; title?: string; fixedId?: string; refId?: string } = {}): void {
  openTerminal(
    o.dir,
    {
      cwd: agentStartCwd(o.cwd, getSettingsSnapshot()?.agentStartDir),
      itemId: o.itemId,
      agent: { key: uid('agent'), agent: o.agent, accountId: o.accountId, prompt: o.prompt, folderId: o.folderId, resumeSessionId: o.resumeSessionId, model: o.model, chrome: o.chrome ?? (!o.agent || o.agent === 'claude') },
    },
    o.title,
    o.refId,
    o.fixedId,
  )
}

export const openTasks = (): void => openOnce('tasks', 'tasks', 'Tasks', {})

// Chat estruturado do botao Agent (Claude headless no ranking de contas). Cada chat e uma aba propria.
// refId: aba de referencia (o "+" de um painel abre o chat naquele grupo)
export function openAgentChat(cwd?: string, refId?: string): void {
  if (!api) return
  // numeradas como os terminais: duas abas "chat" iguais confundiam
  const taken = new Set(api.panels.map((p) => (p.title ?? '').toLowerCase()))
  let n = 1
  while (taken.has(`chat ${n}`)) n++
  const ref = refId ? api.getPanel(refId) : undefined
  api.addPanel({ id: uid('chat'), component: 'chat', tabComponent: 'tab', title: `chat ${n}`, params: { kind: 'chat', cwd: agentStartCwd(cwd, getSettingsSnapshot()?.agentStartDir) }, ...(ref ? { position: { referencePanel: ref } } : {}) })
}

// Teclas digitadas logo depois de pedir uma aba nova (Ctrl+Shift+N...), antes de ela existir na tela: o foco ainda
// nao esta em lugar nenhum e elas sumiam. Guardadas aqui (so caracteres, nunca Enter) e entregues ao terminal novo.
let early: { at: number; buf: string } | undefined
const EARLY_MS = 800
if (typeof window !== 'undefined')
  window.addEventListener(
    'keydown',
    (e) => {
      if (!early || Date.now() - early.at > EARLY_MS) return void (early = undefined)
      const t = document.activeElement
      if (t && t !== document.body && t.tagName !== 'HTML') return // algo ja tem o foco (inclusive o terminal novo)
      if (e.key.length !== 1 || e.ctrlKey || e.altKey || e.metaKey) return
      early.buf += e.key
      e.preventDefault()
    },
    true,
  )
// Esvazia o que ja foi guardado; a captura segue ate o fim da janela (o terminal chama de novo quando recebe o foco)
export function takeEarlyKeys(): string {
  if (!early) return ''
  const b = early.buf
  early.buf = ''
  if (Date.now() - early.at > EARLY_MS) early = undefined
  return b
}

export function openTerminal(dir?: Dir, params: TerminalParams = {}, title?: string, refId?: string, fixedId?: string): void {
  if (!api) return
  const existing = fixedId ? api.getPanel(fixedId) : undefined
  if (existing) return existing.api.setActive()
  early = { at: Date.now(), buf: '' }
  const label = params.agent ? (params.agent.agent ? (agentDef(params.agent.agent)?.name ?? params.agent.agent).toLowerCase() : 'agent') : params.profile === 'qwen-local' ? 'qwen' : params.profile === 'claude-max' ? 'claude' : 'terminal'
  termCounts[label] = (termCounts[label] ?? 0) + 1
  // pula nomes ja usados (aba aberta ou item salvo numa pasta): dois "terminal 4" diferentes confundiam
  const taken = new Set([...api.panels.map((p) => p.title ?? ''), ...takenNames()].map((n) => n.toLowerCase()))
  while (taken.has(`${label} ${termCounts[label]}`)) termCounts[label]++
  api.addPanel({
    id: fixedId ?? uid('term'),
    component: 'terminal',
    tabComponent: 'tab',
    title: title ?? `${label} ${termCounts[label]}`,
    params: { ...params, kind: 'terminal' },
    renderer: 'always', // mantem o xterm vivo quando a aba fica escondida
    ...place(dir, refId),
  })
}

// Paineis "singleton": se ja existe, so ativa.
function openOnce(id: string, component: string, title: string, params: Record<string, unknown>, dir?: Dir): void {
  if (!api) return
  const existing = api.getPanel(id)
  // o teclado vai para a aba aberta (atalho, paleta, sidebar), como em focusTab
  const focus = (): void => void setTimeout(() => window.dispatchEvent(new CustomEvent('turno:focus-panel', { detail: id })), 30)
  if (existing) {
    existing.api.updateParameters(params)
    existing.api.setActive()
    return focus()
  }
  api.addPanel({ id, component, tabComponent: 'tab', title, params: { ...params, kind: component }, ...place(dir) })
  focus()
}

// Clique na rotina abre a sessao (execucao atual/ultima); "configurar" abre o editor como modal.
export const openRoutine = (routineId: string | null, title: string, edit = false): void =>
  !routineId || edit
    ? openRoutineEditorModal(routineId)
    : openOnce(`session:${routineId}`, 'session', title, { routineId })
export const openRun = (runId: string, title: string): void => {
  const from = _panelModal?.kind === 'history' ? { routine: _panelModal.routine } : _panelModal?.kind === 'run' ? _panelModal.back : undefined
  _panelModal = { kind: 'run', runId, title, back: from }
  _emitPanel()
}
// Runs lembra a rotina escolhida no filtro: abrir uma run e voltar mantem a escolha.
export function rememberHistoryRoutine(routine: string): void {
  if (_panelModal?.kind === 'history') _panelModal = { ..._panelModal, routine: routine || undefined }
}
// "Runs vistos": o badge de falhas na sidebar some quando o usuario abre Runs; volta so para falhas novas.
const RUNS_SEEN_KEY = 'turno.runsSeenAt'
let _runsSeenAt = (() => {
  try {
    return Number(localStorage.getItem(RUNS_SEEN_KEY)) || 0
  } catch {
    return 0
  }
})()
const _runsSeenSubs = new Set<() => void>()
export function markRunsSeen(): void {
  _runsSeenAt = Date.now()
  try {
    localStorage.setItem(RUNS_SEEN_KEY, String(_runsSeenAt))
  } catch {
    /* armazenamento indisponivel: segue so em memoria nesta sessao */
  }
  _runsSeenSubs.forEach((cb) => cb())
}
export function useRunsSeenAt(): number {
  return useSyncExternalStore(
    (cb) => (_runsSeenSubs.add(cb), () => _runsSeenSubs.delete(cb)),
    () => _runsSeenAt,
  )
}
export const openHistory = (routine?: string, keepFilter = false): void => {
  markRunsSeen() // abriu Runs = viu as falhas: zera o badge (so falhas novas reaparecem)
  _panelModal = { kind: 'history', routine, keepFilter }
  _emitPanel()
}
export const openAdhoc = (): void => {
  _panelModal = { kind: 'adhoc' }
  _emitPanel()
}
export const openFanout = (): void => {
  _panelModal = { kind: 'fanout' }
  _emitPanel()
}

// ---- persistencia do layout ----
const KEY = 'turno.layout.v1'

export function saveLayout(): void {
  syncOpenTabs()
  if (!api) return
  try {
    const json = api.toJSON() as any
    // Nao reexecutar comandos ao restaurar: terminais voltam limpos.
    for (const p of Object.values(json.panels ?? {}) as any[]) {
      if (p.params?.initialCommand) delete p.params.initialCommand
      if (p.params?.autoStart) delete p.params.autoStart
      if (p.params?.lastSession) delete p.params.lastSession // o Claude nao volta rodando com o layout
    }
    localStorage.setItem(KEY, JSON.stringify(json))
  } catch {
    /* storage indisponivel */
  }
}

export function restoreLayout(): boolean {
  if (!api) return false
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return false
    api.fromJSON(JSON.parse(raw))
    // Fecha paineis que nao sao mais abas: run/history/adhoc/fanout/routine-editor viram modais.
    const MODAL_KINDS = new Set(['run', 'history', 'adhoc', 'fanout', 'routine'])
    for (const p of api.panels.filter((x) => {
      const pr = paramsOf(x)
      return x.id.startsWith('chat:') || pr.itemId || (pr.kind && MODAL_KINDS.has(pr.kind))
    })) {
      discarded.add(p.id)
      p.api.close()
    }
    return api.panels.length > 0
  } catch {
    api.clear()
    return false
  }
}
