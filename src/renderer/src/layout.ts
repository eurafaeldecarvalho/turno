import { useSyncExternalStore } from 'react'
import type { DockviewApi, Direction } from 'dockview-react'
import type { ProfileId, TermSession } from '../../shared/types'

// Ponto unico para abrir paineis no dockview (sidebar, atalhos, botoes dos paineis).
let api: DockviewApi | undefined
let _tabDisposables: Array<{ dispose(): void }> = []
export const setDockApi = (a: DockviewApi): void => {
  _tabDisposables.forEach((d) => d.dispose())
  api = a
  _tabDisposables = [a.onDidAddPanel(syncOpenTabs), a.onDidRemovePanel(syncOpenTabs)]
}
export const dockApi = (): DockviewApi | undefined => api

const uid = (p: string): string => `${p}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
let termCount = 0

type Dir = Exclude<Direction, 'within'> | undefined

function place(dir: Dir, refId?: string) {
  const ref = refId ? api?.getPanel(refId) : api?.activePanel
  return ref && dir ? { position: { referencePanel: ref.id, direction: dir } } : {}
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
  _routineEditState = { id }
  _emitRoutineEdit()
}
export function closeRoutineEditorModal(): void {
  _routineEditState = null
  _emitRoutineEdit()
}
export function useRoutineEditorModal(): { id: string | null } | null {
  return useSyncExternalStore(
    (cb) => (_routineEditSubs.add(cb), () => _routineEditSubs.delete(cb)),
    () => _routineEditState,
  )
}

// ---- modal de paineis (run, history, adhoc, fanout) ----
export type PanelModalState =
  | { kind: 'run'; runId: string; title: string }
  | { kind: 'history'; routine?: string }
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
}
let _openTabs: OpenTab[] = []
const _tabSubs = new Set<() => void>()
const _emitTabs = (): void => _tabSubs.forEach((f) => f())

function syncOpenTabs(): void {
  if (!api) return
  _openTabs = api.panels
    .filter((p) => !(paramsOf(p) as TerminalParams & { kind?: string }).itemId)
    .map((p) => {
      const pr = paramsOf(p) as TerminalParams & { kind?: string }
      return { id: p.id, title: p.title ?? '', kind: pr.kind ?? 'terminal' }
    })
  _emitTabs()
}

export function useOpenTabs(): OpenTab[] {
  return useSyncExternalStore(
    (cb) => (_tabSubs.add(cb), () => _tabSubs.delete(cb)),
    () => _openTabs,
  )
}

export function focusTab(id: string): void {
  api?.getPanel(id)?.api.setActive()
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
  termCount++
  api.addPanel({
    id: fixedId ?? uid('term'),
    component: 'terminal',
    tabComponent: 'tab',
    title: title ?? (params.profile === 'qwen-local' ? `qwen ${termCount}` : params.profile === 'claude-max' ? `claude ${termCount}` : `terminal ${termCount}`),
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
  _panelModal = { kind: 'run', runId, title }
  _emitPanel()
}
export const openHistory = (routine?: string): void => {
  _panelModal = { kind: 'history', routine }
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
