import type { RunRecord } from '../shared/types'

// "Turno da manha": consolida as runs de um periodo num resumo unico (em vez de N notificacoes).
export interface DigestRoutine {
  routine: string
  total: number
  ok: number
  failed: number
  skipped: number // runs puladas (ex. connection/provedor indisponivel) — nao e ok nem falha, mas sinaliza rotina parada
  costUsd: number
}
export interface Digest {
  fromIso: string
  toIso: string
  total: number
  routines: DigestRoutine[]
  empty: boolean
}

// Falha de verdade: erro/timeout/rate-limit/estouro de policy de abort ('aborted'). 'skipped' (pulado),
// 'stopped' (parado pelo usuario) e 'paused' (aguardando reset) NAO contam como falha; 'ok' tambem nao.
const FAILURE: ReadonlySet<RunRecord['status']> = new Set(['failed', 'timeout', 'idle_timeout', 'rate_limited', 'aborted'])
const isFailure = (s: RunRecord['status']): boolean => FAILURE.has(s)

export function buildDigest(runs: RunRecord[], from: Date, to: Date): Digest {
  const [lo, hi] = [from.getTime(), to.getTime()]
  const inWindow = runs.filter((r) => {
    const t = r.started_at ? Date.parse(r.started_at) : NaN
    return !Number.isNaN(t) && t >= lo && t <= hi
  })
  const map = new Map<string, DigestRoutine>()
  for (const r of inWindow) {
    const key = r.routine ?? 'ad-hoc'
    const g = map.get(key) ?? { routine: key, total: 0, ok: 0, failed: 0, skipped: 0, costUsd: 0 }
    g.total++
    if (r.status === 'ok') g.ok++
    else if (r.status === 'skipped') g.skipped++
    else if (isFailure(r.status)) g.failed++
    g.costUsd += r.cost_usd ?? 0
    map.set(key, g)
  }
  const routines = [...map.values()].sort((a, b) => b.total - a.total)
  return { fromIso: from.toISOString(), toIso: to.toISOString(), total: inWindow.length, routines, empty: inWindow.length === 0 }
}
