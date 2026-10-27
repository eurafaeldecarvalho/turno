import { describe, it, expect } from 'vitest'
import { decodeBody, parseHookUrl } from '../claudeScripts'

describe('pedido do statusline/hook no servidor local do Turno', () => {
  it('deveLerTipoChaveContaEEvento', () => {
    expect(parseHookUrl('/hook/k1/conta%201/Stop')).toEqual({ kind: 'hook', key: 'k1', accountId: 'conta 1', event: 'Stop' })
    expect(parseHookUrl('/statusline/k1/acc')).toEqual({ kind: 'statusline', key: 'k1', accountId: 'acc', event: undefined })
  })
  it('naoDeveLancarComPercentMalformado (antes derrubava o pedido)', () => {
    expect(parseHookUrl('/hook/k1/%E0%A4%A/Stop')).toBeNull()
  })
  it('deveDecodificarAcentoQueChegouPartidoEmDoisPedacos', () => {
    const b = Buffer.from('{"cwd":"/x/ção"}', 'utf8')
    const cut = b.indexOf(0xa7) // no meio do "ç" (c3 a7)
    expect(decodeBody([b.subarray(0, cut), b.subarray(cut)])).toBe('{"cwd":"/x/ção"}')
  })
})
