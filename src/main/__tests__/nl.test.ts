import { describe, it, expect } from 'vitest'
import { buildNlPrompt, parseSuggestion } from '../nl'

describe('buildNlPrompt', () => {
  it('inclui o pedido e o output/erro no contexto', () => {
    const p = buildNlPrompt({ ask: 'explain this error', lastCommand: 'npm run build', output: 'ERR! missing script' })
    expect(p).toContain('explain this error')
    expect(p).toContain('npm run build')
    expect(p).toContain('ERR! missing script')
  })
})

describe('parseSuggestion', () => {
  it('extrai o comando do bloco cercado e a explicacao', () => {
    const raw = 'You can list files:\n```sh\nls -la\n```'
    const s = parseSuggestion(raw)
    expect(s.command).toBe('ls -la')
    expect(s.explanation).toContain('You can list files')
  })
  it('sem bloco de comando -> command null (UI nao oferece Execute)', () => {
    const s = parseSuggestion('I cannot find a safe command for that.')
    expect(s.command).toBeNull()
    expect(s.explanation).toContain('cannot find')
  })
})
