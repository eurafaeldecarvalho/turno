import { useSyncExternalStore } from 'react'
import type { AccountUsage, AgentAccount, AgentSessionInfo, AgentsState } from '../../shared/types'
import { agentDef, backText, whenText } from '../../shared/agents'
export { whenText }

// Estado das contas de agentes (ranking, uso) e das conversas abertas (status por aba), vindo do main.
let state: AgentsState = { accounts: [], usage: {}, thresholds: { fiveHour: 90, weekly: 95 }, installed: [], signedOut: [] }
let sessions: AgentSessionInfo[] = []
const subs = new Set<() => void>()
const emit = (): void => subs.forEach((f) => f())

export async function initAgents(): Promise<void> {
  const [s, ss] = await Promise.all([window.turno.agents.state(), window.turno.agents.sessions()])
  state = s
  sessions = ss
  emit()
  window.turno.agents.onState((x) => ((state = x), emit()))
  window.turno.agents.onSessions((x) => ((sessions = x), emit()))
}

const sub = (cb: () => void): (() => void) => (subs.add(cb), () => subs.delete(cb))
export const subscribeAgents = sub
export const getAgentSessions = (): AgentSessionInfo[] => sessions
export const useAgents = (): AgentsState => useSyncExternalStore(sub, () => state)
export const useAgentSessions = (): AgentSessionInfo[] => useSyncExternalStore(sub, () => sessions)
export const getAgentsState = (): AgentsState => state
export const getAgentSession = (key: string): AgentSessionInfo | undefined => sessions.find((s) => s.key === key)

export const accountLabel = (a?: AgentAccount): string => (a ? a.label : 'unknown account')
export const agentName = (id: string): string => agentDef(id)?.name ?? id

// "5h 42% · 7d 61%" / "at limit until 14:00" / "" (sem dados ainda)
export function usageText(u?: AccountUsage): string {
  if (!u) return ''
  if (u.state === 'blocked') return u.reason ?? 'blocked'
  if (u.state === 'exhausted') return u.until ? `at limit until ${backText(u.until)}` : 'at limit'
  return [u.fiveHour && `5h ${u.fiveHour.pct}%`, u.weekly && `7d ${u.weekly.pct}%`].filter(Boolean).join(' · ')
}

// Tempo ate um horario: "2h 13m", "3d 4h 10m", "45m"
export function timeLeft(iso: string, now = Date.now()): string {
  const min = Math.ceil((Date.parse(iso) - now) / 60_000)
  if (!Number.isFinite(min) || min <= 0) return 'now'
  const d = Math.floor(min / 1440)
  const h = Math.floor((min % 1440) / 60)
  const m = min % 60
  return d ? `${d}d ${h}h ${m}m` : h ? `${h}h ${m}m` : `${m}m`
}

// Uso com o tempo ate o reset de cada janela: "5h 40% (2h 13m) · 7d 12% (3d 4h 10m)".
// Janela que ja resetou: o dado guardado esta velho, mostra "reset".
export function usageWithReset(u?: AccountUsage, now = Date.now()): string {
  if (!u || u.state === 'blocked' || u.state === 'exhausted') return usageText(u)
  const part = (label: string, w?: AccountUsage['fiveHour']): string => {
    if (!w) return ''
    if (w.resetsAt && Date.parse(w.resetsAt) <= now) return `${label} reset`
    return `${label} ${w.pct}%${w.resetsAt ? ` (${timeLeft(w.resetsAt, now)})` : ''}`
  }
  return [part('5h', u.fiveHour), part('7d', u.weekly)].filter(Boolean).join(' · ')
}

export const usageTone =(u?: AccountUsage): 'ok' | 'warn' | 'err' | 'idle' =>
  !u || u.state === 'unknown' ? 'idle' : u.state === 'ok' ? 'ok' : u.state === 'warning' ? 'warn' : 'err'

export const STATUS_TEXT: Record<AgentSessionInfo['status'], string> = {
  starting: 'starting',
  working: 'working',
  'needs-input': 'waiting for you',
  'needs-permission': 'needs permission',
  idle: 'done',
  error: 'error',
  swapping: 'switching account',
  parked: 'all accounts at limit',
}
export const needsYou = (s?: AgentSessionInfo): boolean => !!s && (s.status === 'needs-input' || s.status === 'needs-permission' || s.status === 'error' || s.status === 'parked')
