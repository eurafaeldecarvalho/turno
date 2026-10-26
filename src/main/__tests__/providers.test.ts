import { describe, it, expect } from 'vitest'
import { resolveProviderEnv, effectiveModel, getConnection, findConnection, requireConnection, runConnection, DEFAULT_CONNECTIONS } from '../providers'
import type { Connection } from '../../shared/types'

const endpoint: Connection = {
  id: 'x',
  name: 'X',
  kind: 'endpoint',
  baseUrl: 'http://host:1234',
  model: 'my-model',
  token: 'tok',
}

describe('resolveProviderEnv', () => {
  it('connection do tipo claude nao injeta env de provider', () => {
    expect(resolveProviderEnv({ id: 'c', name: 'Claude', kind: 'claude' })).toEqual({})
  })

  it('API da propria Anthropic recebe a chave em ANTHROPIC_API_KEY (x-api-key), nao como Bearer', () => {
    const env = resolveProviderEnv({ ...endpoint, baseUrl: 'https://api.anthropic.com' }, 'sk-ant-api03-x')
    expect(env.ANTHROPIC_API_KEY).toBe('sk-ant-api03-x')
    expect(env.ANTHROPIC_AUTH_TOKEN).toBe('')
  })

  it('via tradutor: o agente recebe o endereco local, nunca a chave do provedor', () => {
    const env = resolveProviderEnv({ ...endpoint, via: 'translate' }, 'sk-provider')
    expect(env.ANTHROPIC_BASE_URL).not.toContain('host:1234')
    expect(JSON.stringify(env)).not.toContain('sk-provider')
  })

  it('endpoint mapeia baseUrl/model/token para as env ANTHROPIC_*', () => {
    const env = resolveProviderEnv(endpoint, 'tok')
    expect(env.ANTHROPIC_BASE_URL).toBe('http://host:1234')
    expect(env.ANTHROPIC_AUTH_TOKEN).toBe('tok')
    expect(env.ANTHROPIC_MODEL).toBe('my-model')
    expect(env.ANTHROPIC_DEFAULT_OPUS_MODEL).toBe('my-model')
    expect(env.ANTHROPIC_DEFAULT_SONNET_MODEL).toBe('my-model')
    expect(env.ANTHROPIC_DEFAULT_HAIKU_MODEL).toBe('my-model')
    expect(env.CLAUDE_CODE_SUBAGENT_MODEL).toBe('my-model')
  })

  it('extraEnv do connection sobrepoe o resolvido', () => {
    const env = resolveProviderEnv({ ...endpoint, extraEnv: { CLAUDE_CODE_MAX_CONTEXT_TOKENS: '131072' } }, 'tok')
    expect(env.CLAUDE_CODE_MAX_CONTEXT_TOKENS).toBe('131072')
  })

  it('preserva EXATAMENTE o env do preset Ollama legado (sem regressao)', () => {
    const ollama = DEFAULT_CONNECTIONS.find((c) => c.id === 'qwen-local')!
    expect(resolveProviderEnv(ollama, ollama.token)).toEqual({
      ANTHROPIC_BASE_URL: 'http://localhost:11434',
      ANTHROPIC_AUTH_TOKEN: 'ollama',
      ANTHROPIC_API_KEY: '',
      ANTHROPIC_MODEL: 'qwen3:14b',
      ANTHROPIC_DEFAULT_OPUS_MODEL: 'qwen3:14b',
      ANTHROPIC_DEFAULT_SONNET_MODEL: 'qwen3:14b',
      ANTHROPIC_DEFAULT_HAIKU_MODEL: 'qwen3:14b',
      CLAUDE_CODE_SUBAGENT_MODEL: 'qwen3:14b',
      CLAUDE_CODE_MAX_CONTEXT_TOKENS: '131072',
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
      API_TIMEOUT_MS: '1800000',
    })
  })
})

describe('effectiveModel', () => {
  it('endpoint usa o model do connection', () => {
    expect(effectiveModel(endpoint, 'req-model')).toBe('my-model')
  })
  it('claude usa o model do request', () => {
    expect(effectiveModel({ id: 'c', name: 'C', kind: 'claude' }, 'sonnet')).toBe('sonnet')
  })
})

describe('getConnection', () => {
  it('acha a connection por id', () => {
    expect(getConnection({ connections: DEFAULT_CONNECTIONS }, 'qwen-local').id).toBe('qwen-local')
  })
  it('id desconhecido cai na primeira connection', () => {
    expect(getConnection({ connections: DEFAULT_CONNECTIONS }, 'nao-existe').id).toBe(DEFAULT_CONNECTIONS[0].id)
  })
  it('sem connections cai num claude default', () => {
    expect(getConnection({ connections: [] }, 'x').kind).toBe('claude')
  })
})

describe('findConnection (sem fallback silencioso)', () => {
  it('id desconhecido -> undefined (nao mascara rodando noutro provedor)', () => {
    expect(findConnection({ connections: DEFAULT_CONNECTIONS }, 'nao-existe')).toBeUndefined()
  })
  it('acha por id', () => {
    expect(findConnection({ connections: DEFAULT_CONNECTIONS }, 'qwen-local')?.id).toBe('qwen-local')
  })
})

describe('requireConnection (guard central contra provedor errado)', () => {
  it('lanca para id desconhecido (fecha followUp/adhoc/runRoutine de uma vez no startRun)', () => {
    expect(() => requireConnection({ connections: DEFAULT_CONNECTIONS }, 'sumiu')).toThrow()
  })
  it('retorna a connection quando existe', () => {
    expect(requireConnection({ connections: DEFAULT_CONNECTIONS }, 'qwen-local').id).toBe('qwen-local')
  })
})

describe('runConnection (conta de conexao no ranking troca o provedor da run)', () => {
  const max = { id: 'claude-max', name: 'Claude', kind: 'claude' as const }
  const cohere = { id: 'cohere', name: 'Cohere', kind: 'endpoint' as const, baseUrl: 'https://x', model: 'command-a' }
  it('deveUsarAConexaoDoPerfilQuandoContaEAssinatura', () => {
    expect(runConnection(max, { connection: undefined }, [max, cohere])).toBe(max)
    expect(runConnection(max, undefined, [max, cohere])).toBe(max)
  })
  it('deveUsarAConexaoDaContaQuandoContaEConexaoDeApi', () => {
    expect(runConnection(max, { connection: 'cohere' }, [max, cohere])).toBe(cohere)
    expect(effectiveModel(runConnection(max, { connection: 'cohere' }, [max, cohere]), 'sonnet')).toBe('command-a')
  })
  it('deveRecusarQuandoConexaoDaContaFoiRemovida (nunca cai na assinatura em silencio)', () => {
    expect(() => runConnection(max, { connection: 'cohere' }, [max])).toThrow(/cohere/)
  })
})
