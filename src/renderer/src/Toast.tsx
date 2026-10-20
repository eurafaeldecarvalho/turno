import { useSyncExternalStore } from 'react'

// Notificacoes DENTRO do app (complementam as do SO, que so aparecem com a janela fora de foco).
// toast(msg, tone) empilha um aviso efemero no canto inferior direito.
export type ToastTone = 'ok' | 'err' | 'warn' | 'run' | 'info'
interface Toast {
  id: number
  message: string
  tone: ToastTone
}

let items: Toast[] = []
let nextId = 1
const timers = new Map<number, ReturnType<typeof setTimeout>>()
const subs = new Set<() => void>()
const emit = (): void => subs.forEach((f) => f())
const DURATION = 4500

function schedule(id: number): void {
  timers.set(id, setTimeout(() => dismiss(id), DURATION))
}
function dismiss(id: number): void {
  const t = timers.get(id)
  if (t) clearTimeout(t)
  timers.delete(id)
  items = items.filter((x) => x.id !== id)
  emit()
}

export function toast(message: string, tone: ToastTone = 'info'): void {
  const id = nextId++
  items = [...items, { id, message, tone }].slice(-5) // no maximo 5 na pilha
  emit()
  schedule(id)
}

export function ToastHost() {
  const list = useSyncExternalStore(
    (cb) => (subs.add(cb), () => subs.delete(cb)),
    () => items,
  )
  if (!list.length) return null
  return (
    <div className="toast-host" aria-live="polite" role="status">
      {list.map((t) => (
        <div
          key={t.id}
          className={`toast toast-${t.tone}`}
          onMouseEnter={() => {
            const x = timers.get(t.id) // pausa o auto-dismiss enquanto o mouse esta em cima (acessibilidade)
            if (x) {
              clearTimeout(x)
              timers.delete(t.id)
            }
          }}
          onMouseLeave={() => {
            if (!timers.has(t.id)) schedule(t.id)
          }}
        >
          <span className="toast-dot" />
          <span className="toast-msg">{t.message}</span>
          <button className="toast-x" aria-label="dismiss" onClick={() => dismiss(t.id)}>✕</button>
        </div>
      ))}
    </div>
  )
}
