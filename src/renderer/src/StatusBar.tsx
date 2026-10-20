import { useEffect, useMemo, useRef, useState } from 'react'
import type { AwakeMode, AwakeStatus } from '../../shared/types'
import { useStore, isActive } from './store'
import { updateSettings } from './appearance'
import { openHistory, useOpenTabs } from './layout'
import { IconCoffee } from './icons'

function fmtMb(kb: number): string {
  const mb = kb / 1024
  return mb >= 1000 ? `${(mb / 1024).toFixed(1)} GB` : `${Math.round(mb)} MB`
}

function fmtUsd(v: number): string {
  return v < 0.01 ? '<$0.01' : `$${v.toFixed(2)}`
}

// Segmento de terminais abertos + RAM total dos processos pty.
function TerminalSegment() {
  const tabs = useOpenTabs()
  const termCount = tabs.filter((t) => t.kind === 'terminal' || t.kind === 'session').length
  const [totalKb, setTotalKb] = useState(0)

  useEffect(() => {
    if (!termCount) { setTotalKb(0); return }
    let cancelled = false
    const poll = (): void => {
      void window.turno.stats.ptyMemory()
        .then((items) => {
          if (cancelled) return
          setTotalKb(items.reduce((s, x) => s + x.memKb, 0))
        })
        .catch(() => { if (!cancelled) setTotalKb(0) })
    }
    poll()
    const id = setInterval(poll, 5000)
    return () => { cancelled = true; clearInterval(id) }
  }, [termCount])

  if (!termCount) return null
  return (
    <span className="sb-item sb-static">
      {termCount} {termCount === 1 ? 'terminal' : 'terminais'}
      {totalKb > 0 && <span className="sb-dim"> · {fmtMb(totalKb)}</span>}
    </span>
  )
}

// Segmento de uso do Claude: custo hoje e na semana.
function ClaudeUsageSegment() {
  const runs = useStore((s) => s.runs)

  const { todayCost, weekCost, hasCost } = useMemo(() => {
    const now = new Date()
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const weekStart = new Date(todayStart)
    weekStart.setDate(todayStart.getDate() - ((todayStart.getDay() + 6) % 7)) // segunda-feira
    const todayCost = runs
      .filter((r) => r.started_at && new Date(r.started_at) >= todayStart && r.cost_usd != null)
      .reduce((s, r) => s + (r.cost_usd ?? 0), 0)
    const weekCost = runs
      .filter((r) => r.started_at && new Date(r.started_at) >= weekStart && r.cost_usd != null)
      .reduce((s, r) => s + (r.cost_usd ?? 0), 0)
    return { todayCost, weekCost, hasCost: runs.some((r) => r.cost_usd != null) }
  }, [runs])

  if (!hasCost) return null

  return (
    <span className="sb-item sb-static" title="Custo Claude hoje e nesta semana">
      {fmtUsd(todayCost)} hoje
      <span className="sb-dim"> · {fmtUsd(weekCost)} semana</span>
    </span>
  )
}

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
      <TerminalSegment />
      <ClaudeUsageSegment />
      <span className="sb-spacer" />
      <AwakeSegment />
    </footer>
  )
}
