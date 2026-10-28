import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { agentDef, unavailableText } from '../../shared/agents'
import { useAgents, usageText, usageTone } from './agentStore'
import { newAgentAsk } from './AgentFolderDialog'
import { openSettingsModal } from './SettingsModal'
import { menuKeyNav } from './modalStack'
import { IconChevron, IconPlus } from './icons'
import { NewItems } from './NewItems'

// Botao "New agent" da sidebar: clique abre a melhor conta disponivel (ranking); a seta abre o menu New
// (agente, chat, terminal, rotina, pasta) e as contas de cada agente.
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
  // a escolha vem do main (respeita a estrategia de Settings); sem ela, a mesma regra aqui
  const best = signed.find((a) => a.id === s.best) ?? signed.find((a) => ['ok', 'unknown'].includes(s.usage[a.id]?.state ?? 'unknown')) ?? signed.find((a) => s.usage[a.id]?.state === 'warning')
  const nearLimit = !!best && s.usage[best.id]?.state === 'warning'
  // sem conta: o mesmo texto da aba de Chat e do main (shared/agents.ts)
  const unavailable = unavailableText(s.accounts.filter((a) => s.installed.includes(a.agent)), s.usage, s.signedOut)
  const allOff = !usable.length && s.accounts.some((a) => s.installed.includes(a.agent))
  const none = allOff ? 'Every account is turned off: turn one on in Settings › Accounts' : 'No agent found: install one or add an account in Settings › Accounts'
  const byAgent = [...new Set(usable.map((a) => a.agent))]
  // o item do menu some ao fechar: o foco vai antes para o botao do menu (quem abrir algo devolve o foco a ele)
  const go = (fn: () => void): void => (setOpen(false), trigger.current?.focus(), fn())
  const pos = (): React.CSSProperties => {
    const r = wrap.current?.getBoundingClientRect()
    if (!r) return {}
    // usa a altura livre da janela (com varias contas o menu nao corta "Manage…" havendo espaco)
    const top = Math.max(8, Math.min(r.top, window.innerHeight - 480))
    return { left: r.right + 6, top, maxHeight: window.innerHeight - top - 12 }
  }

  return (
    <div className="agent-nav" ref={wrap}>
      <button
        className="agent-main"
        onClick={() => newAgentAsk()}
        title={best ? `Opens ${best.label} (best available account${nearLimit ? ', near its limit' : ''})` : unavailable || none}
      >
        <IconPlus /> New agent
        {best && <span className="agent-sub">{agentDef(best.agent)?.name ?? best.agent}</span>}
      </button>
      <button ref={trigger} className="agent-more" aria-label="New: agent, chat, terminal, routine, folder" title="New: agent, chat, terminal, routine, folder, or a specific account" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>
        <IconChevron size={12} />
      </button>
      {open &&
        createPortal(
          <div className="menu menu-floating agent-menu" role="menu" ref={list} style={pos()}>
            <div className="agent-menu-label">New</div>
            <NewItems onPick={go} />
            <div className="menu-sep" role="separator" />
            {byAgent.map((ag) => (
              <div key={ag} className="agent-menu-group">
                <div className="agent-menu-label">{agentDef(ag)?.name ?? ag}</div>
                {usable
                  .filter((a) => a.agent === ag)
                  .map((a) => {
                    const u = s.usage[a.id]
                    return (
                      <button key={a.id} role="menuitem" onClick={() => go(() => newAgentAsk({ agent: a.agent, accountId: a.id }))}>
                        <span className="agent-acc" title={a.label}>
                          {a.label}
                          {best?.id === a.id && <span className="pill pill-ok agent-best">{nearLimit ? 'best · near limit' : 'best'}</span>}
                        </span>
                        {s.signedOut.includes(a.id) ? <small className="muted">not signed in</small> : usageText(u) && <small className={`tone-${usageTone(u)}`}>{usageText(u)}</small>}
                      </button>
                    )
                  })}
              </div>
            ))}
            {!byAgent.length && <div className="agent-menu-empty muted small">{allOff ? 'Every account is turned off.' : 'No agent CLI found on this PC.'}</div>}
            <div className="menu-sep" role="separator" />
            <button role="menuitem" onClick={() => go(() => openSettingsModal('agents'))}>Manage agents and accounts…</button>
          </div>,
          document.body,
        )}
    </div>
  )
}
