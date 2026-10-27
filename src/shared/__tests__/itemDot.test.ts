import { describe, it, expect } from 'vitest'
import { itemDot } from '../itemDot'

describe('bolinha do item da pasta na sidebar = bolinha da aba', () => {
  it('deveMostrarOStatusDoAgenteIgualAAba (laranja pulsando quando trabalhando)', () => {
    expect(itemDot('open', 'working')).toEqual({ kind: 'status', status: 'working' })
    expect(itemDot('open', 'idle')).toEqual({ kind: 'status', status: 'idle' })
    expect(itemDot('open', 'needs-permission')).toEqual({ kind: 'status', status: 'needs-permission' })
  })
  it('deveSeguirAAbaQuandoOAgenteAindaEstaAbrindo (a aba nao mostra bolinha)', () => {
    expect(itemDot('open', 'starting')).toBeNull()
  })
  it('deveMostrarAbertoOuEmSegundoPlanoQuandoNaoEAgente', () => {
    expect(itemDot('open', undefined)).toEqual({ kind: 'live', state: 'open' })
    expect(itemDot('hidden', undefined)).toEqual({ kind: 'live', state: 'hidden' })
  })
  it('naoDeveMostrarNadaQuandoFechado', () => {
    expect(itemDot(undefined, undefined)).toBeNull()
  })
})
