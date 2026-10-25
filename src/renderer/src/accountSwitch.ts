import type { AgentAccount, AgentsState } from '../../shared/types'
import { getAgentSession, getAgentSessions, getAgentsState, subscribeAgents } from './agentStore'
import { getActiveAgentKey } from './layout'
import { askConfirm } from './ConfirmDialog'
import { toast } from './Toast'

const errText = (e: unknown): string => String((e as Error)?.message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

// Troca a conta de uma aba de agente (a focada por ultimo, se nenhuma for dada). A conversa continua na outra conta.
export async function switchAccount(accountId: string, key = getActiveAgentKey()): Promise<void> {
  if (!key || !getAgentSession(key)) return void toast('Open or focus an agent tab first, then switch its account.', 'warn')
  const s = getAgentSession(key)!
  if (s.accountId === accountId) return
  const to = getAgentsState().accounts.find((a) => a.id === accountId)
  if (!to) return
  if (s.status === 'working' || s.status === 'swapping') {
    const ok = await askConfirm({
      title: 'Switch account',
      message: `The agent is in the middle of a turn. Switching to ${to.label} stops it now and continues the conversation there.`,
      confirmLabel: 'Switch now',
      danger: false,
    })
    if (!ok) return
  }
  await window.turno.agents.swap(key, accountId).catch((e) => toast(errText(e), 'err'))
}

// Contas que dariam para usar agora (mesma regra do ranking: ligada, logada, agente instalado, fora do limite)
const usable = (st: AgentsState, a: AgentAccount): boolean =>
  a.enabled && !st.signedOut.includes(a.id) && (!st.installed.length || st.installed.includes(a.agent)) && ['ok', 'unknown'].includes(st.usage[a.id]?.state ?? 'unknown')

// Conta de rank melhor que voltou (o limite resetou): pergunta se as abas que estao numa conta pior vao para ela.
// Aba no meio de um turno so troca quando o turno termina.
const waiting = new Map<string, string>() // aba -> conta para onde vai quando ficar livre
export function watchAccountResets(): void {
  let prev = getAgentsState()
  subscribeAgents(() => {
    const st = getAgentsState()
    if (st !== prev) {
      const back = st.accounts.filter((a) => usable(st, a) && ['exhausted', 'warning'].includes(prev.usage[a.id]?.state ?? ''))
      prev = st
      for (const a of back.sort((x, y) => x.rank - y.rank)) void offer(st, a)
    }
    for (const [key, accountId] of waiting) {
      const s = getAgentSession(key)
      if (!s || s.accountId === accountId) waiting.delete(key)
      else if (s.status !== 'working' && s.status !== 'swapping') {
        waiting.delete(key)
        void window.turno.agents.swap(key, accountId).catch((e) => toast(errText(e), 'err'))
      }
    }
  })
}

const offered = new Set<string>()
async function offer(st: AgentsState, a: AgentAccount): Promise<void> {
  const rank = (id: string): number => st.accounts.find((x) => x.id === id)?.rank ?? Infinity
  // so o mesmo agente: a conversa e retomada na outra conta (outro agente precisaria de nota de passagem)
  const tabs = getAgentSessions().filter((s) => s.agent === a.agent && s.accountId !== a.id && rank(s.accountId) > a.rank && !waiting.has(s.key))
  if (!tabs.length) return
  const mark = `${a.id}:${tabs.map((s) => s.key).sort().join(',')}`
  if (offered.has(mark)) return
  offered.add(mark)
  const from = [...new Set(tabs.map((s) => st.accounts.find((x) => x.id === s.accountId)?.label ?? 'another account'))].join(', ')
  const ok = await askConfirm({
    title: 'Account available again',
    message: `${a.label} is available again (its limit reset) and is ranked above ${from}. Switch ${tabs.length === 1 ? 'the agent tab' : `the ${tabs.length} agent tabs`} to it? The conversation continues where it is; a tab in the middle of a turn switches when the turn ends.`,
    confirmLabel: 'Switch',
    danger: false,
  })
  if (!ok) return
  for (const s of tabs) {
    const cur = getAgentSession(s.key)
    if (!cur) continue
    if (cur.status === 'working' || cur.status === 'swapping') waiting.set(s.key, a.id)
    else void window.turno.agents.swap(s.key, a.id).catch((e) => toast(errText(e), 'err'))
  }
}
