import { describe, it, expect } from 'vitest'
import { classifyBackendFailure, shouldFallback, isBackendFaultMessage, isLimitLike } from '../routing'

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

describe('isBackendFaultMessage: 400/404 que na verdade e falha do backend', () => {
  it('casa modelo desconhecido, credito/cota ESGOTADOS, sobrecarga, rate-limit excedido', () => {
    for (const m of ['model xyz not found', 'unknown model', 'credit balance too low', 'insufficient quota', 'overloaded, try again', 'at capacity', 'rate limit exceeded']) expect(isBackendFaultMessage(m)).toBe(true)
  })
  it('NAO casa erro de requisicao — nem a palavra solta num nome de campo (nao mascara um 400 util)', () => {
    for (const m of ['bad request', 'invalid messages field', 'missing system prompt', 'temperature out of range', 'user field not found', 'quota field invalid', 'rate_limit field invalid', 'insufficient permissions']) expect(isBackendFaultMessage(m)).toBe(false)
  })
})

describe('isLimitLike: SO status inequivoco de limite marca a conta', () => {
  it('429 (rate limit) e 402 (pagamento) marcam', () => {
    expect(isLimitLike(429)).toBe(true)
    expect(isLimitLike(402)).toBe(true)
  })
  it('nenhum outro status marca (mensagem fuzzy nao bencha conta sadia)', () => {
    for (const s of [200, 400, 401, 403, 404, 408, 500, 503]) expect(isLimitLike(s)).toBe(false)
  })
})
