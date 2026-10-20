import { describe, it, expect } from 'vitest'
import { defaultShell } from '../platform'

describe('defaultShell (por plataforma)', () => {
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
