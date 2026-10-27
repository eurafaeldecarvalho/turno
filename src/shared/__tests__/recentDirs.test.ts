import { describe, it, expect } from 'vitest'
import { pushRecentDir, recentWithoutDefault } from '../agents'

describe('pastas recentes do popup do New agent', () => {
  it('deveColocarAMaisRecentePrimeiroSemRepetir', () => {
    expect(pushRecentDir(['/a', '/b'], '/b')).toEqual(['/b', '/a'])
    expect(pushRecentDir(['/a'], '/c')).toEqual(['/c', '/a'])
  })
  it('deveGuardarNoMaximoCinco', () => {
    expect(pushRecentDir(['/1', '/2', '/3', '/4', '/5'], '/6')).toEqual(['/6', '/1', '/2', '/3', '/4'])
  })
  it('deveIgnorarPastaVaziaETratarBarraFinalComoAMesma', () => {
    expect(pushRecentDir(['/a'], '')).toEqual(['/a'])
    expect(pushRecentDir(['/a/'], '/a')).toEqual(['/a'])
  })
})

describe('recentes sem repetir a pasta padrao', () => {
  it('deveTirarAPastaPadraoDasRecentesMesmoComBarraNoFinal', () => {
    expect(recentWithoutDefault(['/home/eu/cnm', '/x'], '/home/eu/cnm/')).toEqual(['/x'])
    expect(recentWithoutDefault(['C:\\\\proj', 'C:\\\\y'], 'C:\\\\proj\\\\')).toEqual(['C:\\\\y'])
  })
})
