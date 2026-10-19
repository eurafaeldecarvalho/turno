import { useEffect, useRef, useSyncExternalStore } from 'react'

// Popup de confirmacao do app (no lugar do confirm() nativo): askConfirm(...) resolve true/false.
interface Ask {
  title: string
  message: string
  confirmLabel: string
  resolve: (ok: boolean) => void
}
let current: Ask | undefined
const subs = new Set<() => void>()
const emit = (): void => subs.forEach((f) => f())

export function askConfirm(o: { title: string; message: string; confirmLabel?: string }): Promise<boolean> {
  current?.resolve(false)
  return new Promise((resolve) => {
    current = { confirmLabel: 'Delete', ...o, resolve }
    emit()
  })
}

function answer(ok: boolean): void {
  const c = current
  current = undefined
  emit()
  c?.resolve(ok)
}

export function ConfirmHost() {
  const ask = useSyncExternalStore(
    (cb) => (subs.add(cb), () => subs.delete(cb)),
    () => current,
  )
  const btn = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (!ask) return
    btn.current?.focus()
    const key = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopPropagation()
      answer(false)
    }
    window.addEventListener('keydown', key, true)
    return () => window.removeEventListener('keydown', key, true)
  }, [ask])
  if (!ask) return null
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && answer(false)}>
      <div className="modal confirm-modal" role="alertdialog" aria-label={ask.title}>
        <header className="modal-head">
          <h2>{ask.title}</h2>
        </header>
        <div className="modal-body">
          <p className="confirm-text">{ask.message}</p>
        </div>
        <footer className="modal-foot">
          <button className="btn ghost" onClick={() => answer(false)}>Cancel</button>
          <button ref={btn} className="btn danger" onClick={() => answer(true)}>{ask.confirmLabel}</button>
        </footer>
      </div>
    </div>
  )
}
