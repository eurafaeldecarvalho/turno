import { describe, it, expect } from 'vitest'
import { classifyBackendFailure, shouldFallback } from '../routing'

// O proxy de roteamento tenta o melhor backend e, se ELE falhar, cai pro proximo mantendo o contexto. A decisao
// critica (custa dinheiro/cota): so cair pro proximo quando a culpa e do BACKEND; erro da REQUISICAO nao adianta
// trocar de provedor (so queimaria todos). classifyBackendFailure e o oraculo puro disso.
describe('classifyBackendFailure', () => {
  it('429 = limite do backend', () => expect(classifyBackendFailure(429)).toBe('limit'))
  it('401/402/403 = auth/credito do backend', () => {
    expect(classifyBackendFailure(401)).toBe('auth')
    expect(classifyBackendFailure(402)).toBe('auth')
    expect(classifyBackendFailure(403)).toBe('auth')
  })
  it('5xx e timeout = transitorio do backend', () => {
    expect(classifyBackendFailure(500)).toBe('transient')
    expect(classifyBackendFailure(503)).toBe('transient')
    expect(classifyBackendFailure(408)).toBe('transient')
  })
  it('sem status (erro de rede) = transitorio', () => expect(classifyBackendFailure(0)).toBe('transient'))
  it('4xx de cliente (400/404/422) = erro da REQUISICAO, nao do backend', () => {
    expect(classifyBackendFailure(400)).toBe('client')
    expect(classifyBackendFailure(404)).toBe('client')
    expect(classifyBackendFailure(422)).toBe('client')
  })
})

describe('shouldFallback: cair pro proximo backend?', () => {
  it('cai no limite, auth e transitorio', () => {
    for (const s of [429, 401, 500, 503, 0, 408]) expect(shouldFallback(s)).toBe(true)
  })
  it('NAO cai em erro de cliente (so queimaria os outros backends)', () => {
    for (const s of [400, 404, 422]) expect(shouldFallback(s)).toBe(false)
  })
  it('200 nunca e fallback', () => expect(shouldFallback(200)).toBe(false))
})
