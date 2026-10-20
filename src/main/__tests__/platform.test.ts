import { describe, it, expect } from 'vitest'
import { defaultShell, preferredShell } from '../platform'

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
