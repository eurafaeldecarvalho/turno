import { useEffect, useRef, useSyncExternalStore } from 'react'
import { useModalLayer } from './modalStack'

// Popup de confirmacao do app (no lugar do confirm() nativo): askConfirm(...) resolve true/false.
interface Ask {
  title: string
  message: string
  confirmLabel: string
  danger?: boolean // false = acao comum (botao normal); padrao e exclusao (vermelho)
  resolve: (ok: boolean) => void
}
let current: Ask | undefined
const subs = new Set<() => void>()
const emit = (): void => subs.forEach((f) => f())

export function askConfirm(o: { title: string; message: string; confirmLabel?: string; danger?: boolean }): Promise<boolean> {
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
  const w = closedWaiters.splice(0)
  setTimeout(() => w.forEach((f) => f()), 0)
}

// Avisos em segundo plano esperam o popup atual fechar em vez de cancela-lo
const closedWaiters: Array<() => void> = []
export const isConfirmOpen = (): boolean => !!current
export const onConfirmClosed = (f: () => void): void => void closedWaiters.push(f)

export function ConfirmHost() {
  const ask = useSyncExternalStore(
    (cb) => (subs.add(cb), () => subs.delete(cb)),
    () => current,
  )
  const btn = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (!ask) return
    btn.current?.focus()
  }, [ask])
  const box = useRef<HTMLDivElement>(null)
  const z = useModalLayer(!!ask, () => answer(false), box)
  if (!ask) return null
  return (
    <div className="modal-backdrop" style={{ zIndex: z }} onMouseDown={(e) => e.target === e.currentTarget && (e.preventDefault(), answer(false))}>
      <div ref={box} tabIndex={-1} className="modal confirm-modal" role="alertdialog" aria-modal="true" aria-label={ask.title}>
        <header className="modal-head">
          <h2>{ask.title}</h2>
        </header>
        <div className="modal-body">
          <p className="confirm-text">{ask.message}</p>
        </div>
        <footer className="modal-foot">
          <button ref={btn} className="btn ghost" onClick={() => answer(false)}>Cancel</button>
          <button className={`btn ${ask.danger === false ? 'primary' : 'danger'}`} onClick={() => answer(true)}>{ask.confirmLabel}</button>
        </footer>
      </div>
    </div>
  )
}
