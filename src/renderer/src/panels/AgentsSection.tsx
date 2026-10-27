import { useEffect, useState } from 'react'
import { AGENTS, agentDef, installCommandFor } from '../../../shared/agents'
import { useAgents, usageText, usageTone, whenText } from '../agentStore'
import { installAgent, openTerminal } from '../layout'
import { closeSettingsModal } from '../SettingsModal'
import { useSettings } from '../appearance'
import { askConfirm } from '../ConfirmDialog'
import { toast } from '../Toast'
import { NumInput } from '../NumInput'
import { Switch } from './RoutineEditor'
import type { AccountUsage, AgentAccount, RankStrategy, UsageWindow } from '../../../shared/types'

const errText = (e: unknown): string => String((e as Error)?.message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

function Bar({ w, label }: { w?: UsageWindow; label: string }) {
  if (!w) return null
  const tone = w.pct >= 95 ? 'err' : w.pct >= 80 ? 'warn' : 'ok'
  return (
    <span className="usage-bar" title={`${label}: ${w.pct}%${w.resetsAt ? ` · resets ${whenText(w.resetsAt)}` : ''}`}>
      <span className="usage-bar-label">{label}</span>
      <span className="usage-bar-track"><span className={`usage-bar-fill tone-bg-${tone}`} style={{ width: `${Math.min(100, Math.max(0, w.pct))}%` }} /></span>
      <span className="usage-bar-pct">{w.pct}%</span>
    </span>
  )
}

// Settings › Agents & accounts: contas ranqueadas. O Agent abre na primeira com cota; no limiar (ou no limite) troca para a proxima.
export function AgentsSection() {
  const st = useAgents()
  const [adding, setAdding] = useState('')
  const [addKind, addId] = adding.split(/:(.*)/) as [string, string]
  const conns = useSettings()?.connections ?? []
  useEffect(() => void window.turno.agents.detect(), [])
  const accounts = st.accounts
  const multi = AGENTS.filter((a) => a.homeVar) // todos que suportam varias contas; os nao instalados ganham o botao Install

  // login padrao so ganha Sign in/Check sign-in quando o problema e login vencido (conta suspensa nao se resolve entrando)
  const loginExpired = (u?: AccountUsage): boolean => u?.state === 'blocked' && /^login expired/.test(u.reason ?? '')
  const commitLabel = (a: AgentAccount, el: HTMLInputElement, keepFocus: boolean): void => {
    const v = el.value.trim()
    if (!v) {
      el.value = a.label // nome vazio nao vale: volta ao salvo
      el.removeAttribute('data-esc-local')
    }
    else if (v !== a.label)
      void window.turno.agents
        .update(a.id, { label: v })
        .then(() => {
          // o campo remonta com o nome novo (key = nome): devolve o foco a ele
          if (keepFocus) setTimeout(() => document.querySelector<HTMLInputElement>(`[data-acct="${a.id}"] .acct-label`)?.focus(), 120)
        })
        .catch((e) => {
          el.value = a.label // recusado (nome repetido): volta ao salvo
          el.removeAttribute('data-esc-local')
          toast(errText(e), 'err')
        })
  }
  const move = (i: number, d: -1 | 1): void => {
    const ids = accounts.map((a) => a.id)
    const j = i + d
    if (j < 0 || j >= ids.length) return
    ;[ids[i], ids[j]] = [ids[j], ids[i]]
    const moved = ids[j]
    void window.turno.agents
      .reorder(ids)
      .then(() =>
        // a lista e redesenhada quando o estado volta do main: o foco segue a conta movida (teclado nao cai no body)
        setTimeout(() => {
          const row = document.querySelector(`[data-acct="${moved}"]`)
          // chegou na ponta: o foco vai para o nome (pular para a outra seta faria o proximo Enter desfazer)
          const btn = row?.querySelector<HTMLElement>(`[data-dir="${d < 0 ? 'up' : 'down'}"]:not(:disabled)`) ?? row?.querySelector<HTMLElement>('.acct-label')
          btn?.focus()
        }, 120),
      )
      .catch((e) => toast(errText(e), 'err'))
  }
  // Login sempre pelo CLI oficial, num terminal visivel, com a pasta da conta
  const loginTerminal = (launchId: string, command: string, title: string): void => {
    closeSettingsModal()
    openTerminal(undefined, { launchId, initialCommand: command }, title)
  }
  const add = async (): Promise<void> => {
    if (!adding) return
    try {
      if (addKind === 'default' || addKind === 'conn') {
        const acc = addKind === 'default' ? await window.turno.agents.addDefault(addId) : await window.turno.agents.addConnection(addId)
        setAdding('')
        toast(`${acc.label} added to the list.`, 'ok')
        return
      }
      const r = await window.turno.agents.add(addId)
      setAdding('')
      toast(`Sign in to ${r.account.label} in the terminal that opened. Then come back here and click "Check sign-in".`, 'info', { sticky: true })
      loginTerminal(r.launchId, r.command, `sign in · ${r.account.label}`)
    } catch (e) {
      toast(errText(e), 'err')
    }
  }
  const login = async (id: string, label: string): Promise<void> => {
    try {
      const r = await window.turno.agents.login(id)
      loginTerminal(r.launchId, r.command, `sign in · ${label}`)
    } catch (e) {
      toast(errText(e), 'err')
    }
  }
  const check = async (id: string): Promise<void> => {
    const ok = await window.turno.agents.refreshLogin(id)
    toast(ok ? 'Signed in.' : 'No sign-in found in this account yet.', ok ? 'ok' : 'warn')
  }
  const remove = async (a: AgentAccount): Promise<void> => {
    const { id, label } = a
    const message = a.home
      ? `Remove "${label}" from Turno? Its sign-in folder is deleted; your conversations stay (they're shared with your other accounts).`
      : a.connection
        ? `Remove "${label}" from the list? The connection stays in Settings › Connections; add it back here any time.`
        : `Remove "${label}" from the list? Your sign-in on this PC isn't touched; add it back here any time.`
    const ok = await askConfirm({ title: 'Remove account', message, confirmLabel: 'Remove' })
    if (!ok) return
    await window.turno.agents.remove(id).catch((e) => toast(errText(e), 'err'))
    document.getElementById('acct-add')?.focus() // a linha removida tinha o foco: nao deixa cair no body
  }
  // Agente escolhido no "Add account": se nao estiver no PATH, o botao vira "Install" (roda o CLI oficial num terminal)
  const selDef = addKind === 'iso' ? agentDef(addId) : undefined
  const selInstalled = addKind !== 'iso' || st.installed.includes(addId)
  const install = (): void => {
    if (!selDef) return
    if (installCommandFor(selDef, !!window.turno.winBuild)) {
      closeSettingsModal()
      installAgent(selDef.id)
      toast(`Installing ${selDef.name} in a terminal. When it finishes, reopen Agents & accounts and add the account.`, 'info', { sticky: true })
      void window.turno.agents.detect()
    } else if (selDef.url) {
      void window.turno.ui.openExternal(selDef.url)
    }
  }

  return (
    <section className="card agents-card" id="settings-agents">
      <h3>Agents and accounts</h3>
      <p className="muted small">
        {{
          rank: 'The Agent button opens the first account in this list that still has quota.',
          headroom: 'The Agent button opens the account with the most quota left; the list order breaks ties.',
          'reset-soonest': 'The Agent button opens the account whose limit resets soonest, so quota that would expire gets used first; the list order breaks ties.',
        }[st.thresholds.strategy ?? 'rank']}{' '}
        When an account passes the limits below, Turno moves the conversation to the next one in the same tab: same agent resumes the same conversation; another agent gets a handoff note. Sign-ins stay inside each agent's own CLI.
      </p>
      <div className="grid2">
        <label className="field">
          <span>Switch at 5-hour usage (%)</span>
          <NumInput integer min={50} max={100} value={st.thresholds.fiveHour} onChange={(v) => void window.turno.agents.setThresholds({ fiveHour: v })} />
        </label>
        <label className="field">
          <span>Switch at weekly usage (%)</span>
          <NumInput integer min={50} max={100} value={st.thresholds.weekly} onChange={(v) => void window.turno.agents.setThresholds({ weekly: v })} />
        </label>
        <label className="field" style={{ gridColumn: '1 / -1' }}>
          <span>Which account goes first</span>
          <select value={st.thresholds.strategy ?? 'rank'} onChange={(e) => void window.turno.agents.setThresholds({ strategy: e.target.value as RankStrategy })}>
            <option value="rank">The order of this list</option>
            <option value="headroom">The one with the most quota left</option>
            <option value="reset-soonest">The one that resets soonest (use quota before it expires)</option>
          </select>
        </label>
      </div>
      <ol className="acct-list">
        {accounts.map((a, i) => {
          const u = st.usage[a.id]
          const installed = st.installed.includes(a.agent)
          return (
            <li key={a.id} data-acct={a.id} className={`acct ${a.enabled ? '' : 'off'}`}>
              <span className="acct-rank">{i + 1}</span>
              <span className="acct-main">
                <input
                  className="acct-label"
                  aria-label="Account name"
                  key={a.label} // nome trocado fora daqui (Check sign-in): remonta com o novo valor
                  defaultValue={a.label}
                  // conta de conexao: o nome vem de Settings › Connections (renomear aqui seria desfeito na proxima sincronia)
                  readOnly={!!a.connection}
                  title={a.connection ? 'Rename it in Settings › Connections' : undefined}
                  // com edicao pendente, Esc so desfaz o nome (data-esc-local); sem edicao, Esc fecha o Settings como sempre
                  onInput={(e) => e.currentTarget.toggleAttribute('data-esc-local', e.currentTarget.value !== a.label)}
                  onBlur={(e) => commitLabel(a, e.currentTarget, false)}
                  onKeyDown={(e) => {
                    // Enter salva e Esc desfaz, os dois sem tirar o foco do campo (teclado nao perde o lugar)
                    if (e.key === 'Enter') commitLabel(a, e.currentTarget, true)
                    if (e.key === 'Escape') {
                      e.stopPropagation()
                      e.currentTarget.value = a.label
                      e.currentTarget.removeAttribute('data-esc-local')
                      e.currentTarget.select()
                    }
                  }}
                />
                {/* tipo da conta e "opens next" lado a lado */}
                <span className="acct-badges">
                  {a.connection ? (
                    <span className="pill pill-warn acct-kind" title="Claude Code on this provider's API: billed by the provider per use (or its free quota)">API</span>
                  ) : (
                    <span className="pill pill-ok acct-kind" title="Sign-in with a subscription plan (5h and weekly limits)">Subscription</span>
                  )}
                  {st.best === a.id && <span className="pill pill-ok agent-best" title="The Agent button opens this account next">opens next</span>}
                </span>
                {(() => {
                  const sub = [
                    // sem repetir o que o nome ja diz (agente, e-mail)
                    a.connection ? 'Claude Code on this provider' : a.label.startsWith(agentDef(a.agent)?.name ?? a.agent) || a.label.startsWith('Claude') ? '' : (agentDef(a.agent)?.name ?? a.agent),
                    a.email && !a.label.includes(a.email) ? a.email : '',
                    installed ? '' : 'not installed',
                  ]
                    .filter(Boolean)
                    .join(' · ')
                  return sub ? <small className="muted">{sub}</small> : null
                })()}
                {st.signedOut.includes(a.id) && <small className="tone-warn">Not signed in: Turno skips it until you sign in.</small>}
                {(u?.fiveHour || u?.weekly) && (
                  <span className="acct-bars">
                    <Bar w={u.fiveHour} label="5h" />
                    <Bar w={u.weekly} label="7d" />
                  </span>
                )}
                {u && (u.state === 'exhausted' || u.state === 'blocked') && (
                  <small className={`tone-${usageTone(u)}`}>
                    {usageText(u)}
                    {u.state === 'exhausted' && (
                      <>
                        {' '}
                        <button className="link" onClick={() => void window.turno.agents.clearLimit(a.id).then(() => setTimeout(() => document.querySelector<HTMLElement>(`[data-acct="${a.id}"] .acct-label`)?.focus(), 120))}>Use it now</button>
                      </>
                    )}
                  </small>
                )}
              </span>
              <span className="acct-actions">
                <Switch checked={a.enabled} label={`Use ${a.label}`} onChange={(v) => void window.turno.agents.update(a.id, { enabled: v })} />
                <button className="icon-btn" data-dir="up" aria-label="Move up" title="Move up" disabled={i === 0} onClick={() => move(i, -1)}>↑</button>
                <button className="icon-btn" data-dir="down" aria-label="Move down" title="Move down" disabled={i === accounts.length - 1} onClick={() => move(i, 1)}>↓</button>
                {!a.connection && (a.home || loginExpired(u)) && <button className="btn small" onClick={() => void login(a.id, a.label)}>Sign in</button>}
                {!a.connection && (a.home || loginExpired(u)) && <button className="btn ghost small" onClick={() => void check(a.id)}>Check sign-in</button>}
                <button className="btn ghost small danger" onClick={() => void remove(a)}>Remove</button>
              </span>
            </li>
          )
        })}
        {!accounts.length && <li className="muted small">No accounts yet. Add one below: the sign-in already on this PC, a separate sign-in, or an API connection.</li>}
      </ol>
      <div className="row">
        <select id="acct-add" aria-label="Agent for the new account" value={adding} onMouseDown={() => void window.turno.agents.detect()} onChange={(e) => setAdding(e.target.value)}>
          <option value="">Add an account…</option>
          {/* nada entra sozinho: login deste PC, conta separada ou conexao de API, cada um adicionado aqui */}
          <optgroup label="Sign-in already on this PC">
            {AGENTS.filter((a) => st.installed.includes(a.id) && !accounts.some((x) => x.id === `default-${a.id}`)).map((a) => (
              <option key={a.id} value={`default:${a.id}`}>{a.name}</option>
            ))}
          </optgroup>
          <optgroup label="Separate sign-in (new account)">
            {multi.map((a) => <option key={a.id} value={`iso:${a.id}`}>{a.name}{st.installed.includes(a.id) ? '' : ' (not installed)'}</option>)}
          </optgroup>
          {conns.some((c) => c.kind === 'endpoint' && !accounts.some((x) => x.connection === c.id)) && (
            <optgroup label="API connection">
              {conns.filter((c) => c.kind === 'endpoint' && !accounts.some((x) => x.connection === c.id)).map((c) => (
                <option key={c.id} value={`conn:${c.id}`}>{c.name}</option>
              ))}
            </optgroup>
          )}
        </select>
        {selInstalled ? (
          <button className="btn" disabled={!adding} onClick={() => void add()}>Add account</button>
        ) : selDef?.install || selDef?.url ? (
          <button className="btn" onClick={install}>Install {selDef?.name}</button>
        ) : null}
      </div>
      {adding && !selInstalled && (
        <small className="tone-warn">
          {selDef?.name} isn't installed on this PC.{' '}
          {selDef && installCommandFor(selDef, !!window.turno.winBuild)
            ? `"Install ${selDef.name}" runs ${installCommandFor(selDef, !!window.turno.winBuild)} in a terminal; reopen this page when it finishes to add the account.`
            : 'Install its CLI from its site, then it shows up here.'}
        </small>
      )}
      <small className="muted">
        Only agents that keep their sign-in in a folder can have more than one account here ({AGENTS.filter((a) => a.homeVar).map((a) => a.name).join(', ')}). Rotating several accounts of the same provider may go against that provider's terms.
      </small>
    </section>
  )
}
