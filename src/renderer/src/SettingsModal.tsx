import { useRef, useSyncExternalStore } from 'react'
import { SettingsPanel } from './panels/SettingsPanel'
import { useModalLayer } from './modalStack'
import { IconClose } from './icons'
import { isPage, type SettingsPage } from './settingsRegistry'

// Settings como MODAL (nao aba): single-instancia por natureza (sem acumular abas) e bloqueia o fundo.
// Duas colunas: categorias (com busca) a esquerda, a pagina escolhida a direita.
let open = false
let page: SettingsPage = 'general'
let anchor: string | undefined // card para rolar ate ele depois que a pagina aparecer
let version = 0
let navTick = 0 // cada navegacao (abrir, trocar de pagina, ir para um card): o painel rola ate o card pedido
const subs = new Set<() => void>()
const emit = (): void => {
  version++
  subs.forEach((f) => f())
}

// Ids antigos de secao (antes das paginas) continuam valendo
const LEGACY: Record<string, SettingsPage> = { agents: 'agents', mcp: 'mcp', connections: 'connections', notifications: 'notifications', terminal: 'terminal', appearance: 'appearance' }

// section: pagina (ex. 'agents', 'mcp') ou 'pagina:id-do-card'
export function openSettingsModal(section?: string): void {
  const [p, a] = (section ?? '').split(':')
  const target = isPage(p) ? p : LEGACY[p]
  if (!open && target) page = target
  else if (open && target) return void goToSettings(target, a)
  anchor = a
  open = true
  navTick++
  emit()
  // aberto por um link para uma pagina (status bar, paleta, menus): o teclado comeca na categoria aberta
  if (target) setTimeout(() => !document.querySelector('.settings-page')?.contains(document.activeElement) && document.getElementById(`settings-tab-${page}`)?.focus(), 60)
}
export const closeSettingsModal = (): void => close()
// Secao com edicao pendente (ex.: editor de MCP) pode segurar o fechamento ou a troca de pagina e perguntar antes
let closeGuard: ((next: () => void) => void) | undefined
export const setSettingsCloseGuard = (g?: (next: () => void) => void): void => {
  closeGuard = g
}
// campos digitados e ainda nao salvos (ntfy, pasta de rotinas) sao aplicados antes de trocar de pagina
let flushPending: (() => void) | undefined
export const setSettingsFlush = (f?: () => void): void => {
  flushPending = f
}
function close(): void {
  const doClose = (): void => {
    open = false
    emit()
  }
  if (closeGuard) closeGuard(doClose)
  else doClose()
}
export function goToSettings(p: SettingsPage, a?: string): void {
  const go = (): void => {
    flushPending?.()
    page = p
    anchor = a
    navTick++
    emit()
    // quem pediu (link no meio de uma pagina) some junto com a pagina velha: o foco vai para a categoria nova
    // (inclusive resultado da busca, que some quando a busca limpa): foco na categoria aberta
    setTimeout(() => !document.querySelector('.settings-page')?.contains(document.activeElement) && document.getElementById(`settings-tab-${p}`)?.focus(), 30)
  }
  if (p !== page && closeGuard) closeGuard(go)
  else go()
}
export const takeSettingsAnchor = (): string | undefined => {
  const a = anchor
  anchor = undefined
  return a
}

export const useSettingsNav = (): number =>
  useSyncExternalStore(
    (cb) => (subs.add(cb), () => subs.delete(cb)),
    () => navTick,
  )

export const useSettingsPage = (): SettingsPage =>
  useSyncExternalStore(
    (cb) => (subs.add(cb), () => subs.delete(cb)),
    () => page,
  )

export function SettingsModalHost() {
  const isOpen = useSyncExternalStore(
    (cb) => (subs.add(cb), () => subs.delete(cb)),
    () => open,
  )
  useSyncExternalStore(
    (cb) => (subs.add(cb), () => subs.delete(cb)),
    () => version,
  )
  const box = useRef<HTMLDivElement>(null)
  const z = useModalLayer(isOpen, close, box)
  if (!isOpen) return null
  return (
    <div className="modal-backdrop" style={{ zIndex: z }} onMouseDown={(e) => e.target === e.currentTarget && (e.preventDefault(), close())}>
      <div ref={box} tabIndex={-1} className="modal modal-wide modal-settings" role="dialog" aria-label="Settings" aria-modal="true">
        <button className="modal-x" aria-label="Close" onClick={close}><IconClose size={14} /></button>
        <SettingsPanel />
      </div>
    </div>
  )
}
