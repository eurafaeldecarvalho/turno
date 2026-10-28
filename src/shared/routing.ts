// Nucleo do proxy de roteamento: o Claude Code aponta para UM endpoint do Turno; a cada request o Turno escolhe o
// melhor backend (assinatura Claude / API / gateway) e, se ele falhar, cai pro proximo mantendo o contexto (o cliente
// reenvia o historico a cada turno). Aqui mora a decisao critica de dinheiro/cota: SO trocar de backend quando a culpa
// e do BACKEND; erro da REQUISICAO (4xx de cliente) nao melhora noutro provedor — so queimaria todos.

import type { AgentAccount, Connection } from './types'

// Como um backend e chamado: assinatura Claude (forward Anthropic p/ api.anthropic.com), conexao Anthropic-compat
// (forward direto) ou conexao OpenAI-compat (passa pelo tradutor). O /route executa o plano na ordem, com fallback.
export type BackendKind = 'subscription' | 'anthropic' | 'openai'
export interface Backend {
  accountId: string
  kind: BackendKind
  connectionId?: string
  url?: string // baseUrl da conexao (ausente na assinatura: api.anthropic.com)
  model?: string
}

// Transforma as contas JA ordenadas (melhor->pior) nos backends roteaveis. Conexao que sumiu do settings e ignorada
// (nao da pra rotear sem baseUrl/credencial). Puro e testavel.
export function planBackends(ordered: AgentAccount[], connById: (id: string) => Connection | undefined): Backend[] {
  const out: Backend[] = []
  for (const a of ordered) {
    if (!a.connection) {
      out.push({ accountId: a.id, kind: 'subscription' })
      continue
    }
    const c = connById(a.connection)
    if (!c || c.kind !== 'endpoint' || !c.baseUrl) continue
    out.push({ accountId: a.id, kind: c.via === 'translate' ? 'openai' : 'anthropic', connectionId: c.id, url: c.baseUrl, model: c.model })
  }
  return out
}

export type BackendFailure = 'limit' | 'auth' | 'transient' | 'client'

// Classifica o status de uma tentativa de backend. Puro e testavel.
export function classifyBackendFailure(status: number): BackendFailure {
  if (!status || status === 408 || status === 409 || status >= 500) return 'transient' // rede/timeout/conflito/erro do servidor
  if (status === 429) return 'limit' // cota estourada
  if (status === 401 || status === 402 || status === 403) return 'auth' // token/credito/permissao do provedor
  return 'client' // 400/404/422... erro da propria requisicao
}

// Cair pro proximo backend? Tudo menos erro de cliente (e 2xx, claro).
export function shouldFallback(status: number): boolean {
  if (status >= 200 && status < 300) return false
  return classifyBackendFailure(status) !== 'client'
}

// Alguns backends escondem uma falha DELES num status de cliente (400/404) ou num 200 com corpo de erro: modelo
// desconhecido no gateway, crédito/cota esgotados, sobrecarga. Pela MENSAGEM dá pra reconhecer e cair pro próximo
// (a requisição é válida; quem falhou foi o backend). Puro e testável — só casa frases claras, não erro de requisição.
export function isBackendFaultMessage(message: string): boolean {
  return (
    /\b(no such model|unknown model|unsupported model|invalid model|model_not_found)\b/i.test(message) ||
    /\bmodel\b[^.]{0,40}\b(not found|not supported|unavailable|unknown|does not exist)\b/i.test(message) ||
    /\b(overloaded|over ?capacity|at capacity|temporarily unavailable|service unavailable|try again later)\b/i.test(message) ||
    // crédito/cota ESGOTADOS (contexto claro, não a palavra solta num nome de campo — senão mascararia um 400 de cliente)
    /\b(credit|quota|balance|funds?)\b[^.]{0,30}\b(low|empty|exceed\w*|exhaust\w*|deplet\w*|insufficient|reached|run out|used up)\b/i.test(message) ||
    /\b(insufficient|out of|no|ran out of)\b[^.]{0,20}\b(credit|quota|balance|funds?)\b/i.test(message) ||
    /\brate.?limit\w*\b[^.]{0,20}\b(exceed\w*|hit|reach\w*|too many)\b/i.test(message)
  )
}

// Vale SEGURAR a conta por um tempo (mark)? SÓ pelo status inequívoco de limite — 429 (rate limit) ou 402 (pagamento).
// Mensagem fuzzy NÃO marca (benchar uma conta sadia por engano é pior); a queda pro próximo já cobre a requisição.
export function isLimitLike(status: number): boolean {
  return status === 429 || status === 402
}
