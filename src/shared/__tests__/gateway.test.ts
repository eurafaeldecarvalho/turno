import { describe, it, expect } from 'vitest'
import { gatewaySetup, gatewayDashboard } from '../gateway'

describe('gatewaySetup: passo de instalar+subir um gateway local do catalogo', () => {
  it('junta install e boot com && quando os dois existem', () => {
    const g = gatewaySetup({ id: 'omniroute', name: 'OmniRoute', install: 'npm install -g omniroute', boot: 'omniroute', dashboardUrl: 'http://localhost:20128' })
    expect(g).toEqual({ command: 'npm install -g omniroute && omniroute', dashboardUrl: 'http://localhost:20128' })
  })
  it('usa so o boot quando nao ha comando de install', () => {
    expect(gatewaySetup({ id: 'x', name: 'X', boot: 'x serve' })).toEqual({ command: 'x serve', dashboardUrl: undefined })
  })
  it('devolve null quando o preset nao tem boot (gateway nao auto-iniciavel: o usuario sobe na mao)', () => {
    expect(gatewaySetup({ id: 'y', name: 'Y', install: 'npm i -g y' })).toBeNull()
    expect(gatewaySetup({ id: 'z', name: 'Z' })).toBeNull()
  })
})

describe('gatewayDashboard: painel do gateway para abrir DENTRO do Turno', () => {
  it('devolve url e titulo quando ha dashboardUrl', () => {
    expect(gatewayDashboard({ id: 'omniroute', name: 'OmniRoute', dashboardUrl: 'http://localhost:20128' })).toEqual({
      url: 'http://localhost:20128',
      title: 'OmniRoute dashboard',
    })
  })
  it('devolve null quando o gateway nao tem painel', () => {
    expect(gatewayDashboard({ id: 'x', name: 'X' })).toBeNull()
  })
})
