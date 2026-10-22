import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { agentDef, unavailableText } from '../../shared/agents'
import { useAgents, usageText, usageTone } from './agentStore'
import { openAgent, openAgentChat } from './layout'
import { openSettingsModal } from './SettingsModal'
import { menuKeyNav } from './modalStack'
import { IconChat, IconChevron, IconSpark } from './icons'

// Botao "Agent" da sidebar: clique abre a melhor conta disponivel (ranking); a seta escolhe agente/conta.
export function AgentButton() {
  const s = useAgents()
  const [open, setOpen] = useState(false)
  const wrap = useRef<HTMLDivElement>(null)
  const list = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (!open) return
    void window.turno.agents.detect() // agentes instalados agora (pode ter instalado um novo)
    list.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus()
    const down = (e: MouseEvent): void => void (!wrap.current?.contains(e.target as Node) && !list.current?.contains(e.target as Node) && setOpen(false))
    const key = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') return void (setOpen(false), trigger.current?.focus())
      menuKeyNav(e, list.current)
    }
    window.addEventListener('mousedown', down)
    window.addEventListener('keydown', key)
    return () => {
      window.removeEventListener('mousedown', down)
      window.removeEventListener('keydown', key)
    }
  }, [open])

  const usable = s.accounts.filter((a) => a.enabled && s.installed.includes(a.agent))
  // mesma regra do main (pickAccount com allowWarning): com folga primeiro; sem nenhuma, a melhor ja no limiar
  const signed = usable.filter((a) => !s.signedOut.includes(a.id))
  const best = signed.find((a) => ['ok', 'unknown'].includes(s.usage[a.id]?.state ?? 'unknown')) ?? signed.find((a) => s.usage[a.id]?.state === 'warning')
  const nearLimit = !!best && s.usage[best.id]?.state === 'warning'
  // sem conta: o mesmo texto da aba de Chat e do main (shared/agents.ts)
  const unavailable = unavailableText(s.accounts.filter((a) => s.installed.includes(a.agent)), s.usage, s.signedOut)
  const allOff = !usable.length && s.accounts.some((a) => s.installed.includes(a.agent))
  const none = allOff ? 'Every account is turned off: turn one on in Settings › Agents' : 'No agent found: install one or add an account in Settings › Agents'
  const byAgent = [...new Set(usable.map((a) => a.agent))]
  // o item do menu some ao fechar: o foco vai antes para o botao do menu (quem abrir algo devolve o foco a ele)
  const go = (fn: () => void): void => (setOpen(false), trigger.current?.focus(), fn())
  const pos = (): React.CSSProperties => {
    const r = wrap.current?.getBoundingClientRect()
    return r ? { left: r.right + 6, top: Math.min(r.top, window.innerHeight - 420) } : {}
  }

  return (
    <div className="agent-nav" ref={wrap}>
      <button
        className="agent-main"
        onClick={() => openAgent()}
        title={best ? `Opens ${best.label} (best available account${nearLimit ? ', near its limit' : ''})` : unavailable || none}
      >
        <IconChat /> Agent
        {best && <span className="agent-sub">{agentDef(best.agent)?.name ?? best.agent}</span>}
      </button>
      <button ref={trigger} className="agent-more" aria-label="Choose agent or account" title="Choose agent or account" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>
        <IconChevron size={12} />
      </button>
      {open &&
        createPortal(
          <div className="menu menu-floating agent-menu" role="menu" ref={list} style={pos()}>
            <button role="menuitem" onClick={() => go(() => openAgent())}>
              <strong>Best available</strong>
              <small className="muted">{best ? `${best.label}${nearLimit ? ' · near its limit' : ''}` : 'none right now'}</small>
            </button>
            <button role="menuitem" onClick={() => go(() => openAgentChat())}>
              <span className="row"><IconSpark size={13} /> New chat</span>
              <small className="muted">Structured chat; switches account at the limit</small>
            </button>
            {byAgent.map((ag) => (
              <div key={ag} className="agent-menu-group">
                <div className="agent-menu-label">{agentDef(ag)?.name ?? ag}</div>
                {usable
                  .filter((a) => a.agent === ag)
                  .map((a) => {
                    const u = s.usage[a.id]
                    return (
                      <button key={a.id} role="menuitem" onClick={() => go(() => openAgent({ agent: a.agent, accountId: a.id }))}>
                        <span className="agent-acc" title={a.label}>{a.label}</span>
                        {s.signedOut.includes(a.id) ? <small className="muted">not signed in</small> : usageText(u) && <small className={`tone-${usageTone(u)}`}>{usageText(u)}</small>}
                      </button>
                    )
                  })}
              </div>
            ))}
            {!byAgent.length && <div className="agent-menu-empty muted small">{allOff ? 'Every account is turned off.' : 'No agent CLI found on this PC.'}</div>}
            <div className="menu-sep" role="separator" />
            <button role="menuitem" onClick={() => go(() => openSettingsModal('agents'))}>Manage accounts and ranking…</button>
          </div>,
          document.body,
        )}
    </div>
  )
}
