// Politica de parada agnostica: o usuario escolhe QUANDO abortar/pausar uma run.
// Thresholds (cost/steps/duration) sao avaliados contra metricas acumuladas do stream.
// session_limit/weekly_limit reagem ao evento de rate-limit do CLI (five_hour/seven_day) -> acao = pausar e retomar no reset.
export type AbortPolicy =
  | { kind: 'cost_usd'; limit: number }
  | { kind: 'steps'; limit: number }
  | { kind: 'duration_min'; limit: number }
  | { kind: 'session_limit' }
  | { kind: 'weekly_limit' }

export interface AbortMetrics {
  costUsd: number
  steps: number
  durationMin: number
}

// Aborta se QUALQUER policy de threshold estourar. Retorna o motivo (texto curto) do primeiro que bateu.
export function evaluateThresholds(m: AbortMetrics, policies: AbortPolicy[]): { abort: boolean; reason?: string } {
  for (const p of policies) {
    if (p.kind === 'cost_usd' && m.costUsd > p.limit) return { abort: true, reason: `custo $${m.costUsd.toFixed(4)} passou do teto $${p.limit}` }
    if (p.kind === 'steps' && m.steps > p.limit) return { abort: true, reason: `${m.steps} passos passaram do teto ${p.limit}` }
    if (p.kind === 'duration_min' && m.durationMin > p.limit) return { abort: true, reason: `${m.durationMin.toFixed(1)}min passou do teto ${p.limit}min` }
  }
  return { abort: false }
}

// Mapeia o rateLimitType do stream do CLI para a policy correspondente, se habilitada.
const RL_MAP: Record<string, 'session_limit' | 'weekly_limit'> = { five_hour: 'session_limit', seven_day: 'weekly_limit' }
export function matchedRateLimit(rateLimitType: string, policies: AbortPolicy[]): 'session_limit' | 'weekly_limit' | undefined {
  const want = RL_MAP[rateLimitType]
  if (!want) return undefined
  return policies.some((p) => p.kind === want) ? want : undefined
}

export interface RateLimitInfo {
  rateLimitType: string
  resetsAt?: number // unix segundos
  rejected: boolean // status === 'rejected' (bateu de verdade); allowed/allowed_warning NAO pausam
}

// Acha recursivamente o objeto de rate-limit (tem a chave rateLimitType) no evento do stream.
function findRateLimit(o: unknown): Record<string, unknown> | undefined {
  if (o && typeof o === 'object') {
    const rec = o as Record<string, unknown>
    if (typeof rec.rateLimitType === 'string') return rec
    for (const v of Array.isArray(o) ? o : Object.values(rec)) {
      const r = findRateLimit(v)
      if (r) return r
    }
  }
  return undefined
}

// Extrai o rate-limit de uma linha do stream. undefined se a linha nao for JSON ou nao tiver rateLimitType.
export function parseRateLimit(line: string): RateLimitInfo | undefined {
  if (!line.includes('"rateLimitType"')) return undefined
  let e: unknown
  try {
    e = JSON.parse(line)
  } catch {
    return undefined
  }
  const rl = findRateLimit(e)
  if (!rl) return undefined
  return {
    rateLimitType: rl.rateLimitType as string,
    resetsAt: typeof rl.resetsAt === 'number' ? rl.resetsAt : undefined,
    rejected: rl.status === 'rejected',
  }
}

// Custo ja gasto na conversa inteira (soma dos segmentos anteriores). Usado p/ o teto cost_usd ser CUMULATIVO
// atraves de pausas/retomadas — senao cada --resume recomecaria o orcamento do zero (overspend).
export function priorCost(runs: Array<{ cost_usd: number | null }>): number {
  return runs.reduce((s, r) => s + (r.cost_usd ?? 0), 0)
}

// Lista final de policies da rotina: as declaradas + budget_usd legado como acucar de cost_usd (sem duplicar).
export function policiesFromConfig(config: { abort?: AbortPolicy[]; budget_usd?: number }): AbortPolicy[] {
  const list = [...(config.abort ?? [])]
  if (config.budget_usd != null && !list.some((p) => p.kind === 'cost_usd')) list.push({ kind: 'cost_usd', limit: config.budget_usd })
  return list
}
