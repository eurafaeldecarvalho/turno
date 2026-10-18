import { useEffect, useRef, useState } from 'react'
import type { AwakeMode, AwakeStatus } from '../../shared/types'
import { useStore, isActive } from './store'
import { updateSettings } from './appearance'
import { openHistory } from './layout'
import { IconCoffee } from './icons'

const MODES: Array<{ v: AwakeMode; t: string; d: string }> = [
  { v: 'on', t: 'On', d: 'Keeps the computer awake all the time' },
  { v: 'auto', t: 'Agent', d: 'Stays awake while an agent is working' },
  { v: 'off', t: 'Off', d: 'Follows the normal Windows power mode' },
]

// Segmento "manter acordado" da barra de status (igual ao CaffeinateStatusSegment do Orca).
function AwakeSegment() {
  const [s, setS] = useState<AwakeStatus>()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    void window.turno.settings.awake().then(setS)
    return window.turno.settings.onAwake(setS)
  }, [])
  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent): void => void (!ref.current?.contains(e.target as Node) && setOpen(false))
    window.addEventListener('mousedown', close)
    return () => window.removeEventListener('mousedown', close)
  }, [open])
  if (!s) return null
  const label = MODES.find((m) => m.v === s.mode)!.t
  return (
    <div className="sb-awake" ref={ref}>
      <button
        className={`sb-item ${s.active ? 'on' : ''}`}
        onClick={() => setOpen(!open)}
        aria-label={`Keep the computer awake: ${label}, ${s.active ? 'active' : 'inactive'}`}
        title="Keep the computer awake"
      >
        <IconCoffee size={13} />
        <span>{label}</span>
        <span className="sb-dim">· {s.active ? 'active' : 'inactive'}</span>
      </button>
      {open && (
        <div className="sb-pop" role="menu">
          <div className="sb-pop-title">Keep the computer awake</div>
          {MODES.map((m) => (
            <button
              key={m.v}
              role="menuitemradio"
              aria-checked={s.mode === m.v}
              className={s.mode === m.v ? 'on' : ''}
              onClick={() => {
                void updateSettings({ keepAwake: m.v })
                setOpen(false)
              }}
            >
              <span className="sb-radio" />
              <span className="sb-opt">
                <span>{m.t}</span>
                <small>{m.d}</small>
              </span>
            </button>
          ))}
          <div className="sb-pop-note">Closing the laptop lid follows the Windows power settings.</div>
        </div>
      )}
    </div>
  )
}

export function StatusBar() {
  const runs = useStore((s) => s.runs)
  const routines = useStore((s) => s.routines)
  const running = runs.filter(isActive).length
  const on = routines.filter((r) => r.config.enabled).length
  return (
    <footer className="statusbar">
      <button className="sb-item" onClick={() => openHistory()} title="Open runs">
        <span className={`dot ${running ? 'dot-run' : 'dot-idle'}`} />
        {running ? `${running} running` : 'idle'}
      </button>
      <span className="sb-item sb-static">
        {on}/{routines.length} routines on
      </span>
      <span className="sb-spacer" />
      <AwakeSegment />
    </footer>
  )
}
