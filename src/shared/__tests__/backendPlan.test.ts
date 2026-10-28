import { describe, it, expect } from 'vitest'
import { planBackends } from '../routing'
import type { AgentAccount, Connection } from '../types'

const acc = (id: string, over: Partial<AgentAccount> = {}): AgentAccount =>
  ({ id, agent: 'claude', label: id, enabled: true, home: null, rank: 0, createdAt: '2026-01-01', ...over }) as AgentAccount
const conn = (id: string, over: Partial<Connection> = {}): Connection =>
  ({ id, name: id, kind: 'endpoint', baseUrl: `https://${id}/v1`, model: `${id}-model`, ...over }) as Connection

describe('planBackends: contas ordenadas -> backends roteaveis', () => {
  it('conta sem conexao = assinatura (forward Anthropic direto)', () => {
    expect(planBackends([acc('sub')], () => undefined)).toEqual([{ accountId: 'sub', kind: 'subscription' }])
  })
  it('conexao via=translate = backend OpenAI (passa pelo tradutor)', () => {
    const c = conn('groq', { via: 'translate' })
    expect(planBackends([acc('a', { connection: 'groq' })], () => c)).toEqual([
      { accountId: 'a', kind: 'openai', connectionId: 'groq', url: 'https://groq/v1', model: 'groq-model' },
    ])
  })
  it('conexao direta/gateway = backend Anthropic', () => {
    const c = conn('ccr', { via: 'direct' })
    expect(planBackends([acc('a', { connection: 'ccr' })], () => c)).toEqual([
      { accountId: 'a', kind: 'anthropic', connectionId: 'ccr', url: 'https://ccr/v1', model: 'ccr-model' },
    ])
  })
  it('conexao que sumiu do settings = backend ignorado (nao roteavel)', () => {
    expect(planBackends([acc('a', { connection: 'foi' })], () => undefined)).toEqual([])
  })
  it('preserva a ordem recebida (melhor->pior ja veio ordenado)', () => {
    const c = conn('x', { via: 'direct' })
    const out = planBackends([acc('sub'), acc('a', { connection: 'x' })], () => c)
    expect(out.map((b) => b.accountId)).toEqual(['sub', 'a'])
  })
})
