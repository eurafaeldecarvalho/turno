import type { AgentAccount, AgentSessionInfo, AgentsState } from '../../shared/types'
import { getAgentSession, getAgentSessions, getAgentsState, subscribeAgents } from './agentStore'
import { getActiveAgentKey } from './layout'
import { askConfirm, isConfirmOpen, onConfirmClosed } from './ConfirmDialog'
import { toast } from './Toast'
import { agentDef } from '../../shared/agents'

// a aba comeca a guardar o teclado ja no pedido (antes da troca chegar, o que fosse digitado ia para o Claude que fecha)
export const announceSwitch = (key: string | undefined): void => void (key && window.dispatchEvent(new CustomEvent('turno:agent-switching', { detail: key })))
// pedido desistido (confirmacao cancelada, mesma conta): a aba devolve o teclado
const cancelSwitch = (key: string | undefined): void => void (key && window.dispatchEvent(new CustomEvent('turno:agent-switch-cancel', { detail: key })))
function requestSwap(key: string, accountId: string): Promise<void> {
  announceSwitch(key)
  return window.turno.agents.swap(key, accountId).catch((e) => (cancelSwitch(key), Promise.reject(e)))
}

const errText = (e: unknown): string => String((e as Error)?.message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

// Aba entre turnos (pode trocar sem cortar nada). Pedido de permissao/entrada acontece NO MEIO do turno.
const betweenTurns = (s: AgentSessionInfo): boolean => s.status === 'idle' || s.status === 'parked' || s.status === 'error'

// Troca a conta de uma aba de agente (a focada por ultimo, se nenhuma for dada). A conversa continua na outra conta.
export async function switchAccount(accountId: string, key = getActiveAgentKey()): Promise<void> {
  if (!key || !getAgentSession(key)) return void toast('Open or focus an agent tab first, then switch its account.', 'warn')
  const s = getAgentSession(key)!
  waiting.delete(key) // escolha manual vence uma troca agendada pelo aviso de reset
  // (a paleta ja avisou a aba no clique: toda desistencia daqui para baixo devolve o teclado)
  if (s.accountId === accountId) return cancelSwitch(key)
  // o main ignora troca no meio de outra troca: avisa em vez de nao fazer nada
  if (s.status === 'swapping') return void (cancelSwitch(key), toast('This agent tab is already switching accounts. Try again in a moment.', 'warn'))
  const to = getAgentsState().accounts.find((a) => a.id === accountId)
  if (!to) return cancelSwitch(key)
  if (!betweenTurns(s)) {
    const ok = await askConfirm({
      title: 'Switch account',
      message: `The agent is in the middle of a turn. Switching to ${to.label} stops it now and continues the conversation there.`,
      confirmLabel: 'Switch now',
      danger: false,
    })
    if (!ok) return cancelSwitch(key)
  }
  await requestSwap(key, accountId).catch((e) => toast(errText(e), 'err'))
}

// Contas que dariam para usar agora (mesma regra do ranking: ligada, logada, agente instalado, fora do limite)
const usable = (st: AgentsState, a: AgentAccount): boolean =>
  a.enabled && !st.signedOut.includes(a.id) && (!st.installed.length || st.installed.includes(a.agent)) && ['ok', 'unknown'].includes(st.usage[a.id]?.state ?? 'unknown')

// Conta de rank melhor que voltou (o limite resetou): pergunta se as abas que estao numa conta pior vao para ela.
// Aba no meio de um turno so troca quando o turno termina.
const waiting = new Map<string, string>() // aba -> conta para onde vai quando ficar livre
let queue: Promise<void> = Promise.resolve() // um aviso por vez, sem atropelar outro popup aberto
export function watchAccountResets(): void {
  let prev = getAgentsState()
  subscribeAgents(() => {
    const st = getAgentsState()
    if (st !== prev) {
      // voltou de verdade: estava no limite, ou no aviso cujo horario de reset ja passou (subir o limiar no Settings
      // tambem tira do aviso, mas a conta continua gasta: isso nao e "voltou")
      const now = Date.now()
      const wasOut = (id: string): boolean => {
        const p = prev.usage[id]
        return p?.state === 'exhausted' || (p?.state === 'warning' && !!p.until && Date.parse(p.until) <= now + 61_000)
      }
      const back = st.accounts.filter((a) => usable(st, a) && wasOut(a.id))
      prev = st
      for (const a of back.sort((x, y) => x.rank - y.rank)) queue = queue.then(() => offer(a.id)).catch(() => {})
    }
    for (const [key, accountId] of waiting) {
      const s = getAgentSession(key)
      if (!s || s.accountId === accountId) waiting.delete(key)
      else if (betweenTurns(s)) {
        waiting.delete(key)
        // a conta pode ter esgotado enquanto o turno terminava (as outras abas ja foram para ela): nao manda para a parede
        const to = st.accounts.find((a) => a.id === accountId)
        if (to && usable(st, to)) void requestSwap(key, accountId).catch((e) => toast(errText(e), 'err'))
      }
    }
  })
}

const whenNoDialog = (): Promise<void> => new Promise((res) => (isConfirmOpen() ? onConfirmClosed(() => void whenNoDialog().then(res)) : res()))

async function offer(accountId: string): Promise<void> {
  await whenNoDialog()
  // tudo lido na hora de perguntar: um aviso anterior pode ter movido as abas
  const st = getAgentsState()
  const a = st.accounts.find((x) => x.id === accountId)
  // so agentes com hooks (Claude): os outros nao informam a sessao nem o fim do turno, e trocar recomecaria do zero
  if (!a || !usable(st, a) || agentDef(a.agent)?.usage !== 'claude') return
  const rank = (id: string): number => st.accounts.find((x) => x.id === id)?.rank ?? Infinity
  // so o mesmo agente: a conversa e retomada na outra conta (outro agente precisaria de nota de passagem)
  const tabs = getAgentSessions().filter((s) => s.agent === a.agent && s.accountId !== a.id && rank(s.accountId) > a.rank && !waiting.has(s.key))
  if (!tabs.length) return
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
    if (!cur || cur.accountId === a.id) continue
    if (!betweenTurns(cur)) waiting.set(s.key, a.id)
    else void requestSwap(s.key, a.id).catch((e) => toast(errText(e), 'err'))
  }
}
