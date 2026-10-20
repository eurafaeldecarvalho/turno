import { describe, it, expect } from 'vitest'
import { classifyPreflight } from '../doctor'

describe('classifyPreflight (claude)', () => {
  it('sem binario -> missing_binary', () => {
    expect(classifyPreflight({ kind: 'claude', hasBinary: false }).state).toBe('missing_binary')
  })
  it('binario ok mas deslogado -> not_logged_in', () => {
    expect(classifyPreflight({ kind: 'claude', hasBinary: true, loggedIn: false }).state).toBe('not_logged_in')
  })
  it('binario + logado -> ok', () => {
    expect(classifyPreflight({ kind: 'claude', hasBinary: true, loggedIn: true }).state).toBe('ok')
  })
})

describe('classifyPreflight (endpoint)', () => {
  it('alcancavel -> ok', () => {
    expect(classifyPreflight({ kind: 'endpoint', reachable: true }).state).toBe('ok')
  })
  it('servidor local fora do ar -> unhealthy (da pra subir)', () => {
    expect(classifyPreflight({ kind: 'endpoint', reachable: false, local: true }).state).toBe('unhealthy')
  })
  it('endpoint remoto sem resposta -> endpoint_unreachable (nunca "instalar")', () => {
    expect(classifyPreflight({ kind: 'endpoint', reachable: false, local: false }).state).toBe('endpoint_unreachable')
  })
})
