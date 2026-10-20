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

  it("mode 'docker' encaminha as env vars do provedor com -e KEY (senao o claude roda sem provedor)", () => {
    const w = wrapForSandbox('claude', ['-p'], 'docker', { image: 'img', env: ['ANTHROPIC_BASE_URL', 'ANTHROPIC_AUTH_TOKEN'] })
    // passa-through do env do processo host para o container
    expect(w.args).toContain('-e')
    expect(w.args).toContain('ANTHROPIC_BASE_URL')
    expect(w.args).toContain('ANTHROPIC_AUTH_TOKEN')
  })

  it("mode 'wsl' envolve em wsl com o comando original", () => {
    const w = wrapForSandbox('claude', ['-p'], 'wsl')
    expect(w.cmd).toBe('wsl')
    expect(w.args.slice(-2)).toEqual(['claude', '-p'])
  })

  it("mode 'wsl' seta WSLENV para repassar as env vars ao Linux", () => {
    const w = wrapForSandbox('claude', ['-p'], 'wsl', { env: ['ANTHROPIC_BASE_URL', 'TURNO_RUN_ID'] })
    expect(w.env?.WSLENV).toBe('ANTHROPIC_BASE_URL:TURNO_RUN_ID')
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
