import { describe, it, expect } from 'vitest'
import catalog from '../providerCatalog.json'

const byId = (id: string) => catalog.providers.find((p) => p.id === id)

describe('gateways locais no catalogo', () => {
  it('OmniRoute entra como gateway local no formato OpenAI (via tradutor)', () => {
    expect(byId('omniroute')).toMatchObject({ kind: 'local', style: 'openai', baseUrl: 'http://localhost:20128/v1', free: true })
  })

  it('9router entra como gateway local no formato OpenAI', () => {
    expect(byId('9router')).toMatchObject({ kind: 'local', style: 'openai', baseUrl: 'http://localhost:20128/v1', free: true })
  })

  it('claude-code-router entra como gateway local no formato Anthropic (direto)', () => {
    expect(byId('claude-code-router')).toMatchObject({ kind: 'local', style: 'anthropic', baseUrl: 'http://127.0.0.1:3456/v1', free: true })
  })

  it('ids do catalogo continuam unicos', () => {
    const ids = catalog.providers.map((p) => p.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})
