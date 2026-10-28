import type { AgentAccount, AccountUsage } from './types'

// Ordena as contas "do melhor para o pior" para o botao de auto-ordenacao em Agents & accounts. Espelha a ideia do
// OmniRoute (assinatura antes de API paga, mais cota sobrando primeiro, quota-aware), mas e um clique UNICO: reescreve
// a ordem manual da lista; depois o usuario ajusta na mao (ou nem usa). NAO e uma estrategia automatica continua.

export interface RankContext {
  usage: Record<string, AccountUsage | undefined>
  installed: string[] // ids de AGENTES instalados (ex. ['claude','codex'])
  signedOut: string[] // ids de CONTAS sem login
}

// Prontidao: 0 = pronta para usar agora; 1 = perto do limite (aviso); 2 = indisponivel (desligada, sem CLI, sem login,
// no limite ou bloqueada). Pior tier sempre depois, por mais "premium" que seja a conta.
function readiness(a: AgentAccount, c: RankContext): 0 | 1 | 2 {
  const u = c.usage[a.id]
  const unavailable = !a.enabled || !c.installed.includes(a.agent) || c.signedOut.includes(a.id) || u?.state === 'exhausted' || u?.state === 'blocked'
  if (unavailable) return 2
  return u?.state === 'warning' ? 1 : 0
}

const usedPct = (u?: AccountUsage): number => Math.max(u?.fiveHour?.pct ?? 0, u?.weekly?.pct ?? 0)

// Devolve os ids das contas na ordem melhor->pior. Puro e testavel; o chamador passa o resultado para agents.reorder.
export function sortAccountsBestToWorst(accounts: AgentAccount[], c: RankContext): string[] {
  return accounts
    .map((a, i) => ({
      id: a.id,
      // chave lexicografica: tier de prontidao, assinatura antes de API paga, mais cota sobrando, ordem manual atual, estabilidade
      key: [readiness(a, c), a.connection ? 1 : 0, usedPct(c.usage[a.id]), a.rank, i] as const,
    }))
    .sort((x, y) => {
      for (let k = 0; k < x.key.length; k++) if (x.key[k] !== y.key[k]) return x.key[k] - y.key[k]
      return 0
    })
    .map((x) => x.id)
}
