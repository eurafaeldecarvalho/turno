import { describe, it, expect } from 'vitest'
import { resolveProviderEnv, effectiveModel, getConnection, findConnection, requireConnection, DEFAULT_CONNECTIONS } from '../providers'
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
      ANTHROPIC_MODEL: 'qwen3.6:35b',
      ANTHROPIC_DEFAULT_OPUS_MODEL: 'qwen3.6:35b',
      ANTHROPIC_DEFAULT_SONNET_MODEL: 'qwen3.6:35b',
      ANTHROPIC_DEFAULT_HAIKU_MODEL: 'qwen3.6:35b',
      CLAUDE_CODE_SUBAGENT_MODEL: 'qwen3.6:35b',
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
