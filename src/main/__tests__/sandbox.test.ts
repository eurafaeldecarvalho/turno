import { describe, it, expect } from 'vitest'
import { wrapForSandbox } from '../sandbox'
import { parseConfig } from '../routines'

describe('wrapForSandbox', () => {
  it("mode 'none' e no-op: comando e args intactos (prova do default DESLIGADO)", () => {
    expect(wrapForSandbox('claude', ['-p', '--verbose'], 'none')).toEqual({ cmd: 'claude', args: ['-p', '--verbose'] })
  })

  it("mode 'docker' envolve em docker run com o comando original dentro", () => {
    const w = wrapForSandbox('claude', ['-p'], 'docker', { image: 'img', cwd: '/repo' })
    expect(w.cmd).toBe('docker')
    expect(w.args[0]).toBe('run')
    expect(w.args).toContain('img')
    // o comando original aparece ao final
    expect(w.args.slice(-2)).toEqual(['claude', '-p'])
  })

  it("mode 'wsl' envolve em wsl com o comando original", () => {
    const w = wrapForSandbox('claude', ['-p'], 'wsl')
    expect(w.cmd).toBe('wsl')
    expect(w.args.slice(-2)).toEqual(['claude', '-p'])
  })
})

describe('schema: sandbox', () => {
  it('default do campo sandbox e "none" (desligado)', () => {
    expect(parseConfig({ name: 'x' }).sandbox).toBe('none')
  })
  it('aceita docker/wsl', () => {
    expect(parseConfig({ name: 'x', sandbox: 'docker' }).sandbox).toBe('docker')
  })
})
