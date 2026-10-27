import type { AgentTabStatus } from './types'

// Bolinha de um item de pasta na sidebar. Item aberto numa aba de agente: a MESMA da aba (verde parado, laranja pulsando
// trabalhando...); a aba nao mostra nada enquanto o agente abre, e o item tambem nao. Sem agente: aberto / em segundo plano.
export type ItemDot = { kind: 'status'; status: AgentTabStatus } | { kind: 'live'; state: 'open' | 'hidden' } | null
export function itemDot(live: 'open' | 'hidden' | undefined, status: AgentTabStatus | undefined): ItemDot {
  if (status) return status === 'starting' ? null : { kind: 'status', status }
  return live ? { kind: 'live', state: live } : null
}
