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
