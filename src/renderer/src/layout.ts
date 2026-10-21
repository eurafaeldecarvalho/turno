import { useSyncExternalStore } from 'react'
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
      const pr = paramsOf(p) as TerminalParams & { kind?: string }
      const agent = pr.profile === 'claude-max' || /^claude\b/.test(pr.initialCommand ?? '') || !!pr.lastSession
      return { id: p.id, title: p.title ?? '', kind: pr.kind ?? 'terminal', agent, active: api!.activePanel?.id === p.id }
    })
  // Status bar: todos os terminais abertos, inclusive os que ja estao numa pasta da sidebar.
  _termTotal = api.panels.filter((p) => (paramsOf(p) as { kind?: string }).kind === 'terminal').length
  _emitTabs()
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
  if (wasMax) setTimeout(() => window.dispatchEvent(new CustomEvent('turno:focus-panel', { detail: id })), 120)
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

export function openTerminal(dir?: Dir, params: TerminalParams = {}, title?: string, refId?: string, fixedId?: string): void {
  if (!api) return
  const existing = fixedId ? api.getPanel(fixedId) : undefined
  if (existing) return existing.api.setActive()
  const label = params.profile === 'qwen-local' ? 'qwen' : params.profile === 'claude-max' ? 'claude' : 'terminal'
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
  if (existing) {
    existing.api.updateParameters(params)
    existing.api.setActive()
    return
  }
  api.addPanel({ id, component, tabComponent: 'tab', title, params: { ...params, kind: component }, ...place(dir) })
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
export const openHistory = (routine?: string, keepFilter = false): void => {
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
