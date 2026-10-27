import { useEffect, useRef, useSyncExternalStore } from 'react'
import { useModalLayer } from './modalStack'
import { getSettingsSnapshot } from './appearance'
import { openAgent } from './layout'
import { pushRecentDir, startFolderLabel } from '../../shared/agents'
import { IconFolder } from './icons'

// Popup do New agent: em qual pasta abrir. A pasta padrao (Settings › Agents & accounts › Start folder, ou a home)
// e a opcao destacada: Enter abre direto. Tasks e pastas da sidebar nao passam por aqui (ja tem a pasta delas).
type OpenOpts = Parameters<typeof openAgent>[0]
interface Ask {
  opts: OpenOpts
}
let current: Ask | undefined
const subs = new Set<() => void>()
const emit = (): void => subs.forEach((f) => f())

// recentes: conveniencia por maquina (localStorage pode falhar em perfil bloqueado: segue sem eles)
const RECENT_KEY = 'turno.agentRecentDirs'
function readRecent(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]')
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}
function remember(dir: string): void {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(pushRecentDir(readRecent(), dir)))
  } catch {
    /* sem armazenamento: so nao lembra */
  }
}

// Novo agente pedido pela pessoa (botao, menu, atalho, paleta): pergunta a pasta antes de abrir.
export function newAgentAsk(opts: OpenOpts = {}): void {
  current = { opts }
  emit()
}

function close(): void {
  current = undefined
  emit()
}
function openIn(dir: string | undefined): void {
  const c = current
  close()
  if (!c) return
  if (dir) remember(dir)
  // undefined = pasta padrao (openAgent aplica a Start folder; vazia = home)
  openAgent({ ...c.opts, cwd: dir })
}

export function AgentFolderHost() {
  const ask = useSyncExternalStore(
    (cb) => (subs.add(cb), () => subs.delete(cb)),
    () => current,
  )
  const first = useRef<HTMLButtonElement>(null)
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (ask) first.current?.focus()
  }, [ask])
  const z = useModalLayer(!!ask, close, box)
  if (!ask) return null
  const start = getSettingsSnapshot()?.agentStartDir ?? ''
  const recent = readRecent().filter((d) => d !== start)
  const choose = async (): Promise<void> => {
    const dir = await window.turno.ui.pickFolder()
    if (dir) openIn(dir)
  }
  return (
    <div className="modal-backdrop" style={{ zIndex: z }} onMouseDown={(e) => e.target === e.currentTarget && (e.preventDefault(), close())}>
      <div ref={box} tabIndex={-1} className="modal confirm-modal agent-folder-modal" role="dialog" aria-modal="true" aria-label="Open agent in">
        <header className="modal-head">
          <h2>Open agent in</h2>
        </header>
        <div
          className="modal-body agent-folder-list"
          onKeyDown={(e) => {
            // setas andam entre as pastas (Tab tambem)
            if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
            e.preventDefault()
            const opts = Array.from(box.current?.querySelectorAll<HTMLButtonElement>('.agent-folder-opt') ?? [])
            const i = opts.indexOf(document.activeElement as HTMLButtonElement)
            opts[(i + (e.key === 'ArrowDown' ? 1 : -1) + opts.length) % opts.length]?.focus()
          }}
        >
          <button ref={first} className="agent-folder-opt default" onClick={() => openIn(undefined)} title={start || 'Your home folder'}>
            <IconFolder size={14} />
            <span className="grow">
              <strong>{start ? startFolderLabel(start) : 'Home folder'}</strong>
              <small className="muted mono">{start || 'Default folder (set it in Settings › Agents & accounts)'}</small>
            </span>
            <span className="pill pill-ok">default</span>
          </button>
          {recent.map((d) => (
            <button key={d} className="agent-folder-opt" onClick={() => openIn(d)} title={d}>
              <IconFolder size={14} />
              <span className="grow">
                <strong>{startFolderLabel(d)}</strong>
                <small className="muted mono">{d}</small>
              </span>
            </button>
          ))}
        </div>
        <footer className="modal-foot">
          <button className="btn ghost" onClick={close}>Cancel</button>
          <button className="btn" onClick={() => void choose()}>Choose folder…</button>
        </footer>
      </div>
    </div>
  )
}
