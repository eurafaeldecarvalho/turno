import { useEffect, useMemo, useRef, useState } from 'react'
import { menuKeyNav } from './modalStack'
import type { AwakeMode, AwakeStatus } from '../../shared/types'
import { useStore, isActive } from './store'
import { updateSettings } from './appearance'
import { openHistory, useActiveAgentKey } from './layout'
import { IconCoffee } from './icons'
import { useAgents, useAgentSessions, usageText, usageTone } from './agentStore'
import { openSettingsModal } from './SettingsModal'
import { AWAKE_MODES } from './awake'
import { switchAccount } from './accountSwitch'

function fmtUsd(v: number): string {
  return v > 0 && v < 0.01 ? '<$0.01' : `$${v.toFixed(2)}`
}

// Gasto cobrado por uso (chave de API) hoje e na semana. Runs em assinatura nao gravam custo (nao e gasto).
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
    <span className="sb-item sb-static" title="Pay-as-you-go API spend today and this week (Mon–Sun). Runs on a subscription plan aren't counted.">
      {fmtUsd(todayCost)} today
      <span className="sb-dim"> · {fmtUsd(weekCost)} this week</span>
    </span>
  )
}

// Conta ativa: a da aba de agente focada por ultimo (sem aba de agente, a que o proximo agente usaria),
// com o uso SO dela. Clique abre a troca de conta.
function ActiveAccountSegment() {
  const st = useAgents()
  const sessions = useAgentSessions()
  const key = useActiveAgentKey()
  const sess = key ? sessions.find((s) => s.key === key) : undefined
  const acc = st.accounts.find((a) => a.id === (sess?.accountId ?? st.best))
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent): void => void (!ref.current?.contains(e.target as Node) && setOpen(false))
    ref.current?.querySelector<HTMLElement>('.sb-pop button:not(:disabled)')?.focus()
    const keys = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') return void (setOpen(false), ref.current?.querySelector<HTMLElement>('.sb-item')?.focus())
      menuKeyNav(e, ref.current?.querySelector('.sb-pop') ?? null)
    }
    window.addEventListener('mousedown', close)
    window.addEventListener('keydown', keys)
    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('keydown', keys)
    }
  }, [open])
  if (!acc) return null
  const u = st.usage[acc.id]
  const others = st.accounts.filter((a) => a.id !== acc.id && a.enabled && !st.signedOut.includes(a.id) && (!st.installed.length || st.installed.includes(a.agent)))
  return (
    <div className="sb-awake" ref={ref}>
      <button
        className="sb-item"
        aria-haspopup="menu"
        aria-expanded={open}
        title={sess ? `This agent tab runs on ${acc.label}. Click to switch account.` : `The next agent opens on ${acc.label}. Click to switch or manage accounts.`}
        onClick={() => setOpen(!open)}
      >
        <span className={`dot dot-${usageTone(u)}`} />
        <span>{acc.label}</span>
        {usageText(u) && <span className="sb-dim">· {usageText(u)}</span>}
      </button>
      {open && (
        <div className="sb-pop sb-pop-left" role="menu">
          <div className="sb-pop-title">{sess ? 'Switch this agent tab to' : 'Switch account'}</div>
          {!sess && <div className="sb-pop-note">Focus an agent tab to move its conversation to another account.</div>}
          {others.map((a) => (
            <button
              key={a.id}
              role="menuitem"
              disabled={!sess}
              onClick={() => {
                setOpen(false)
                void switchAccount(a.id, key)
              }}
            >
              <span className={`dot dot-${usageTone(st.usage[a.id])}`} />
              <span className="sb-opt">
                <span>{a.label}</span>
                <small>{usageText(st.usage[a.id]) || 'no usage data yet'}</small>
              </span>
            </button>
          ))}
          {!others.length && <div className="sb-pop-note">No other account is signed in.</div>}
          <button role="menuitem" onClick={() => (setOpen(false), openSettingsModal('agents'))}>
            <span className="sb-opt">
              <span>Manage accounts…</span>
            </span>
          </button>
        </div>
      )}
    </div>
  )
}

const MODES = AWAKE_MODES

// Segmento "manter acordado" da barra de status.
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
    // a opcao marcada primeiro (a lista de seletores com virgula pegava a primeira do documento)
    ;(ref.current?.querySelector<HTMLElement>('[role="menuitemradio"][aria-checked="true"]') ?? ref.current?.querySelector<HTMLElement>('[role="menuitemradio"]'))?.focus()
    const esc = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') return void (setOpen(false), ref.current?.querySelector<HTMLElement>('.sb-item')?.focus())
      menuKeyNav(e, ref.current?.querySelector('.sb-pop') ?? null)
    }
    window.addEventListener('mousedown', close)
    window.addEventListener('keydown', esc)
    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('keydown', esc)
    }
  }, [open])
  if (!s) return null
  const label = (MODES.find((m) => m.v === s.mode) ?? MODES[1]).t
  return (
    <div className="sb-awake" ref={ref}>
      <button
        className={`sb-item ${s.active ? 'on' : ''}`}
        onClick={() => setOpen(!open)}
        aria-haspopup="menu"
        aria-expanded={open}
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
                ref.current?.querySelector<HTMLElement>('.sb-item')?.focus() // como no Esc: o foco volta ao botao
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
  const on = routines.filter((r) => r.config.enabled && !r.error).length // com erro nao roda: nao conta como ligada
  return (
    <footer className="statusbar">
      <button className="sb-item" onClick={() => openHistory()} title="Open runs">
        <span className={`dot ${running ? 'dot-run' : 'dot-idle'}`} />
        {running ? `${running} running` : 'idle'}
      </button>
      <span className="sb-item sb-static">
        {on}/{routines.length} routines on
      </span>
      <ActiveAccountSegment />
      <ClaudeUsageSegment />
      <span className="sb-spacer" />
      <AwakeSegment />
    </footer>
  )
}
