import { useEffect, useSyncExternalStore } from 'react'
import { SettingsPanel } from './panels/SettingsPanel'
import { isConfirmOpen } from './ConfirmDialog'

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
  useEffect(() => {
    if (!isOpen) return
    const key = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      if (isConfirmOpen()) return // um confirm aberto por cima: o Esc e dele, nao fecha o Settings
      e.preventDefault()
      e.stopPropagation()
      close()
    }
    window.addEventListener('keydown', key, true)
    return () => window.removeEventListener('keydown', key, true)
  }, [isOpen])
  if (!isOpen) return null
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="modal modal-wide" role="dialog" aria-label="Settings" aria-modal="true">
        <button className="modal-x" aria-label="Close" onClick={close}>✕</button>
        <SettingsPanel />
      </div>
    </div>
  )
}
