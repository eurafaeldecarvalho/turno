import { useRef, useSyncExternalStore } from 'react'
import { SettingsPanel } from './panels/SettingsPanel'
import { useModalLayer } from './modalStack'
import { IconClose } from './icons'

// Settings como MODAL (nao aba): single-instancia por natureza (sem acumular abas) e bloqueia o fundo.
let open = false
const subs = new Set<() => void>()
const emit = (): void => subs.forEach((f) => f())

export function openSettingsModal(): void {
  open = true
  emit()
}
function close(): void {
  open = false
  emit()
}

export function SettingsModalHost() {
  const isOpen = useSyncExternalStore(
    (cb) => (subs.add(cb), () => subs.delete(cb)),
    () => open,
  )
  const box = useRef<HTMLDivElement>(null)
  const z = useModalLayer(isOpen, close, box)
  if (!isOpen) return null
  return (
    <div className="modal-backdrop" style={{ zIndex: z }} onMouseDown={(e) => e.target === e.currentTarget && (e.preventDefault(), close())}>
      <div ref={box} tabIndex={-1} className="modal modal-wide" role="dialog" aria-label="Settings" aria-modal="true">
        <button className="modal-x" aria-label="Close" onClick={close}><IconClose size={14} /></button>
        <SettingsPanel />
      </div>
    </div>
  )
}
