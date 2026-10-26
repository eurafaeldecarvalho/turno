import { describe, it, expect } from 'vitest'
import { agentStartCwd, startFolderLabel } from '../agents'

describe('pasta inicial do agente', () => {
  it('deveUsarAPastaInicialQuandoOAgenteAbreSemPastaPropria', () => {
    expect(agentStartCwd(undefined, '/home/eu/cnm')).toBe('/home/eu/cnm')
  })
  it('deveManterAPastaPedidaPelaOrigem (Tasks, pasta da barra lateral)', () => {
    expect(agentStartCwd('/repo/x', '/home/eu/cnm')).toBe('/repo/x')
  })
  it('deveCairNaHomeQuandoNaoHaPastaInicial', () => {
    expect(agentStartCwd(undefined, '')).toBeUndefined()
    expect(agentStartCwd(undefined, '   ')).toBeUndefined()
    expect(agentStartCwd(undefined, undefined)).toBeUndefined()
  })
  it('deveMostrarSoONomeDaPastaNoRodape', () => {
    expect(startFolderLabel('/home/eu/cnm/')).toBe('cnm')
    expect(startFolderLabel('C:\\Users\\eu\\proj')).toBe('proj')
    expect(startFolderLabel('')).toBe('home')
  })
})
