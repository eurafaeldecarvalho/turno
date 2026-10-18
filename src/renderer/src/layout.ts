import type { DockviewApi, Direction } from 'dockview-react'
import type { ProfileId, TermSession } from '../../shared/types'

// Ponto unico para abrir paineis no dockview (sidebar, atalhos, botoes dos paineis).
let api: DockviewApi | undefined
export const setDockApi = (a: DockviewApi): void => void (api = a)
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

export function panelForItem(itemId: string) {
  return api?.panels.find((p) => (p.params as TerminalParams | undefined)?.itemId === itemId)
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
    title: title ?? (params.profile === 'qwen-local' ? `qwen ${termCount}` : `terminal ${termCount}`),
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

// Clique na rotina abre a sessao (execucao atual/ultima); "configurar" abre o editor.
export const openRoutine = (routineId: string | null, title: string, edit = false): void =>
  !routineId || edit
    ? openOnce(routineId ? `routine:${routineId}` : uid('routine-new'), 'routine', routineId ? `⚙ ${title}` : title, { routineId })
    : openOnce(`session:${routineId}`, 'session', title, { routineId })
export const openRun = (runId: string, title: string): void => openOnce(`run:${runId}`, 'run', title, { runId })
export const openHistory = (routine?: string): void =>
  openOnce(routine ? `history:${routine}` : 'history', 'history', routine ? `history · ${routine}` : 'Runs', { routine })
export const openSettings = (): void => openOnce('settings', 'settings', 'Settings', {})
export const openAdhoc = (): void => openOnce(uid('adhoc'), 'adhoc', 'Ad hoc run', {})

// ---- persistencia do layout ----
const KEY = 'turno.layout.v1'

export function saveLayout(): void {
  if (!api) return
  try {
    const json = api.toJSON() as any
    // Nao reexecutar comandos ao restaurar: terminais voltam limpos.
    for (const p of Object.values(json.panels ?? {}) as any[]) {
      if (p.params?.initialCommand) delete p.params.initialCommand
      if (p.params?.autoStart) delete p.params.autoStart
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
    // Abas de chat voltariam como shell vazio: fecha; um clique no item reabre a sessao.
    for (const p of api.panels.filter((x) => x.id.startsWith('chat:') || (x.params as TerminalParams | undefined)?.itemId)) p.api.close()
    return api.panels.length > 0
  } catch {
    api.clear()
    return false
  }
}
