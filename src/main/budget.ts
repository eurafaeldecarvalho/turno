// Guarda de orcamento por run: mata o run quando o custo acumulado passa do teto.
// Sem teto (undefined) nunca aborta. Custo vem do total_cost_usd dos eventos 'result' do stream.
// LIMITACAO: o teto so atua em provedores que reportam total_cost_usd (precificacao Anthropic).
// Endpoints que nao reportam custo (Ollama local, alguns proxies) tem o teto inoperante — ok p/ local
// gratis, mas um proxy PAGO sem custo reportado nao e protegido. Medir com run real antes de confiar.
export function shouldAbortForBudget(spentUsd: number, limitUsd?: number): boolean {
  if (limitUsd == null) return false
  return spentUsd > limitUsd
}
