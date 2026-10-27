import { describe, it, expect } from 'vitest'
import { withUserBin, claudeInstallCommand } from '../env'

describe('PATH com a pasta onde o instalador oficial poe o claude', () => {
  it('deveAcrescentarLocalBinNoLinuxQuandoFalta (Turno aberto pelo menu antes de relogar)', () => {
    expect(withUserBin('/usr/bin:/bin', '/home/eu', 'linux')).toBe('/usr/bin:/bin:/home/eu/.local/bin')
  })
  it('naoDeveDuplicarQuandoJaEstaNoPath', () => {
    expect(withUserBin('/home/eu/.local/bin:/usr/bin', '/home/eu', 'linux')).toBe('/home/eu/.local/bin:/usr/bin')
    expect(withUserBin('/usr/bin:/home/eu/.local/bin/', '/home/eu', 'darwin')).toBe('/usr/bin:/home/eu/.local/bin/')
  })
  it('deveUsarPontoEVirgulaEBarraInvertidaNoWindowsSemDiferenciarMaiuscula', () => {
    expect(withUserBin('C:\\Windows\\system32', 'C:\\Users\\Eu', 'win32')).toBe('C:\\Windows\\system32;C:\\Users\\Eu\\.local\\bin')
    expect(withUserBin('c:\\users\\eu\\.local\\bin;C:\\x', 'C:\\Users\\Eu', 'win32')).toBe('c:\\users\\eu\\.local\\bin;C:\\x')
  })
  it('deveFuncionarComPathVazio', () => {
    expect(withUserBin('', '/home/eu', 'linux')).toBe('/home/eu/.local/bin')
  })
})

describe('instalador oficial do Claude Code (sem Node)', () => {
  it('deveUsarOScriptNativoDeCadaSistema', () => {
    expect(claudeInstallCommand('linux')).toBe('curl -fsSL https://claude.ai/install.sh | bash')
    expect(claudeInstallCommand('darwin')).toBe('curl -fsSL https://claude.ai/install.sh | bash')
    expect(claudeInstallCommand('win32')).toBe('irm https://claude.ai/install.ps1 | iex')
  })
})
