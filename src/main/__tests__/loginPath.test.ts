import { describe, it, expect } from 'vitest'
import { mergePath, pathFromEnvDump } from '../env'

describe('mergePath: junta o PATH do processo com o do login shell', () => {
  it('acrescenta os diretorios do login shell que faltam, preservando a ordem do processo', () => {
    // Caso real: app aberto pela bandeja so tem /usr/bin:/bin; o login shell (fish) tem a pasta do nvm.
    expect(mergePath('/usr/bin:/bin', '/usr/bin:/home/eu/.local/share/nvm/v24/bin', '/home/eu', 'linux')).toBe(
      '/usr/bin:/bin:/home/eu/.local/share/nvm/v24/bin:/home/eu/.local/bin',
    )
  })
  it('sem extra, equivale a so garantir ~/.local/bin', () => {
    expect(mergePath('/usr/bin', '', '/home/eu', 'linux')).toBe('/usr/bin:/home/eu/.local/bin')
  })
  it('nao duplica dir que ja esta no processo (ignora barra final)', () => {
    expect(mergePath('/a/:/usr/bin', '/a:/b', '/home/eu', 'linux')).toBe('/a/:/usr/bin:/b:/home/eu/.local/bin')
  })
  it('no Windows usa ; e nao diferencia maiuscula ao deduplicar', () => {
    expect(mergePath('C:\\W', 'C:\\w;C:\\x', 'C:\\Users\\Eu', 'win32')).toBe('C:\\W;C:\\x;C:\\Users\\Eu\\.local\\bin')
  })
})

describe('pathFromEnvDump: le o PATH da saida do comando `env`', () => {
  it('pega a linha PATH entre varias variaveis', () => {
    expect(pathFromEnvDump('HOME=/home/eu\nPATH=/a:/b\nSHELL=/usr/bin/fish\n')).toBe('/a:/b')
  })
  it('aceita PATH em qualquer caixa', () => {
    expect(pathFromEnvDump('Path=/a:/b')).toBe('/a:/b')
  })
  it('nao confunde PATHEXT com PATH', () => {
    expect(pathFromEnvDump('PATHEXT=.COM;.EXE\n')).toBeUndefined()
  })
  it('devolve undefined quando nao ha PATH', () => {
    expect(pathFromEnvDump('HOME=/home/eu\n')).toBeUndefined()
  })
})
