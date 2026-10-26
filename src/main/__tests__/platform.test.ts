import { describe, it, expect } from 'vitest'
import { defaultShell, preferredShell, resolveShell, savedShell } from '../platform'

describe('defaultShell (fallback puro por plataforma)', () => {
  it('Windows -> pwsh.exe', () => {
    expect(defaultShell('win32')).toBe('pwsh.exe')
  })
  it('macOS -> zsh', () => {
    expect(defaultShell('darwin')).toBe('zsh')
  })
  it('Linux -> bash', () => {
    expect(defaultShell('linux')).toBe('bash')
  })
})

describe('preferredShell (prefere $SHELL no POSIX)', () => {
  it('POSIX com $SHELL usa o $SHELL do usuario', () => {
    expect(preferredShell('linux', '/usr/bin/fish')).toBe('/usr/bin/fish')
  })
  it('POSIX sem $SHELL cai no default', () => {
    // '' (falsy) representa "sem SHELL" — passar undefined explicito acionaria o default do parametro.
    expect(preferredShell('linux', '')).toBe('bash')
  })
  it('Windows IGNORA $SHELL (usa pwsh)', () => {
    expect(preferredShell('win32', '/usr/bin/fish')).toBe('pwsh.exe')
  })
})

describe('resolveShell (shell salvo que nao existe nesta maquina cai no preferido)', () => {
  const only = (...paths: string[]) => (p: string): boolean => paths.includes(p)
  const linux = { platform: 'linux' as const, shellEnv: '/usr/bin/fish', pathEnv: '/usr/local/bin:/usr/bin:/bin' }

  it('deveCairNoShellDoUsuarioQuandoPwshExeSalvoNoLinux', () => {
    expect(resolveShell('pwsh.exe', { ...linux, exists: only('/usr/bin/fish') })).toBe('/usr/bin/fish')
  })
  it('deveCairNoShellDoUsuarioQuandoCaminhoAbsolutoNaoExiste', () => {
    expect(resolveShell('/usr/bin/turno', { ...linux, exists: only('/usr/bin/fish') })).toBe('/usr/bin/fish')
  })
  it('deveManterCaminhoAbsolutoQueExiste', () => {
    expect(resolveShell('/usr/bin/zsh', { ...linux, exists: only('/usr/bin/zsh', '/usr/bin/fish') })).toBe('/usr/bin/zsh')
  })
  it('deveManterNomeSoltoEncontradoNoPath', () => {
    expect(resolveShell('zsh', { ...linux, exists: only('/usr/bin/zsh') })).toBe('zsh')
  })
  it('deveUsarPreferidoQuandoNadaFoiPedido', () => {
    expect(resolveShell('', { ...linux, exists: only('/usr/bin/fish') })).toBe('/usr/bin/fish')
  })
  it('deveCairNoDefaultQuandoSHELLTambemNaoExiste', () => {
    expect(resolveShell('pwsh.exe', { ...linux, shellEnv: '/nao/existe', exists: only('/usr/bin/bash') })).toBe('bash')
  })
  it('naoDeveMexerNoWindows (ConPTY resolve pelo PATH do Windows)', () => {
    expect(resolveShell('pwsh.exe', { platform: 'win32', shellEnv: '', pathEnv: '', exists: () => false })).toBe('pwsh.exe')
  })
})

describe('savedShell (o que vale do settings: vazio = padrao do sistema)', () => {
  const only = (...paths: string[]) => (p: string): boolean => paths.includes(p)
  const linux = { platform: 'linux' as const, shellEnv: '/usr/bin/fish', pathEnv: '/usr/bin:/bin' }

  it('deveVirarPadraoDoSistemaQuandoShellSalvoNaoRodaAqui', () => {
    expect(savedShell('pwsh.exe', { ...linux, exists: only('/usr/bin/fish') })).toBe('')
  })
  it('deveManterEscolhaDoUsuarioQueRodaAqui', () => {
    expect(savedShell('/usr/bin/zsh', { ...linux, exists: only('/usr/bin/zsh') })).toBe('/usr/bin/zsh')
  })
  it('deveManterVazioComoPadraoDoSistema', () => {
    expect(savedShell('', { ...linux, exists: only('/usr/bin/fish') })).toBe('')
  })
  it('naoDeveMexerNoWindows', () => {
    expect(savedShell('pwsh.exe', { platform: 'win32', shellEnv: '', pathEnv: '', exists: () => false })).toBe('pwsh.exe')
  })
})
