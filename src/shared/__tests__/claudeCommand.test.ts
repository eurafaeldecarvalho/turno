import { describe, it, expect } from 'vitest'
import { defaultPermissionMode } from '../claudeCommand'

describe('modo de permissao do Claude aberto pelo Turno', () => {
  it('deveAbrirOClaudeEmAutoMode', () => {
    expect(defaultPermissionMode('claude')).toBe('claude --permission-mode auto')
    expect(defaultPermissionMode('claude --resume abc')).toBe('claude --permission-mode auto --resume abc')
  })
  it('deveValerParaClaudeEmQualquerPosicaoDeComando', () => {
    expect(defaultPermissionMode('cd x; claude')).toBe('cd x; claude --permission-mode auto')
    expect(defaultPermissionMode('& claude.exe')).toBe('& claude.exe --permission-mode auto')
  })
  it('deveRespeitarModoJaEscolhidoNoComando', () => {
    expect(defaultPermissionMode('claude --permission-mode plan')).toBe('claude --permission-mode plan')
    expect(defaultPermissionMode('claude --dangerously-skip-permissions')).toBe('claude --dangerously-skip-permissions')
  })
  it('naoDeveMexerNoTextoEntreAspasNemEmOutrosComandos', () => {
    expect(defaultPermissionMode('claude "rode claude --permission-mode plan"')).toBe('claude --permission-mode auto "rode claude --permission-mode plan"')
    expect(defaultPermissionMode('echo "claude"')).toBe('echo "claude"')
    expect(defaultPermissionMode('ls')).toBe('ls')
  })
})
