import { describe, it, expect } from 'vitest'
import { renderStatusline } from '../statusline'

// eslint-disable-next-line no-control-regex
const plain = (s: string): string => s.replace(/\x1b\[[0-9;]*m/g, '')
const now = Date.parse('2026-10-27T12:00:00Z')
const sec = (iso: string): number => Date.parse(iso) / 1000

describe('rodape do Claude nas abas do Turno (estilo Orca)', () => {
  const payload = {
    model: { display_name: 'Opus 5 (1M context)' },
    effort: { level: 'high' },
    rate_limits: {
      five_hour: { used_percentage: 13, resets_at: sec('2026-10-27T15:54:00Z') },
      seven_day: { used_percentage: 90.4, resets_at: sec('2026-10-29T07:00:00Z') },
    },
  }
  it('deveDesenharModeloEsforcoContaEBarrasDe5hE7dNaMoldura', () => {
    expect(plain(renderStatusline(payload, 'rafael.silva', now)).split('\n')).toEqual([
      '╭ Opus 5 1M   HIGH   ·  rafael.silva',
      '│ 5h   ━━━━━━━━━━━━━━    13%   ↺ 3h54m',
      '╰ 7d   ━━━━━━━━━━━━━━    90%   ↺ 1d19h',
      '', // linha em branco no fim: as barras nao encostam na caixa de texto
      '',
    ])
  })
  it('deveUsarAsCoresDoRodapeAntigo (calmo, morno, quente)', () => {
    const out = renderStatusline(payload, '', now)
    expect(out).toContain('\x1b[38;5;108m━') // 13% = calmo
    expect(out).toContain('\x1b[38;5;173m━') // 90% = quente
    expect(out).toContain('\x1b[48;5;179m') // pilula HIGH
  })
  it('deveMostrarSoOModeloComRegraSimplesQuandoAindaNaoHaUso (conexao de API, antes da 1a resposta)', () => {
    expect(plain(renderStatusline({ model: { display_name: 'command-a' } }, 'Cohere', now)).split('\n')).toEqual(['▏ command-a  ·  Cohere', '', ''])
  })
  it('naoDeveQuebrarComPayloadVazioOuEstranho', () => {
    expect(renderStatusline({}, '', now)).toBe('')
    expect(plain(renderStatusline({ rate_limits: { five_hour: { used_percentage: 250 } } }, '', now))).toContain('100%')
  })
})

describe('rodape: texto de fora nao vira comando de terminal', () => {
  it('deveTirarCaracteresDeControleDoModeloEsforcoEConta', () => {
    const out = renderStatusline({ model: { display_name: 'Opus\x1b]0;PWN\x07\n\x1b[2J' }, effort: { level: 'hi\x1b[31m' } }, 'ac\x1b[H', now)
    expect(out).not.toMatch(/\x1b\]|\x07|\x1b\[2J|\x1b\[H|\x1b\[31M/)
    expect(plain(out).split('\n')).toHaveLength(3) // uma linha so + o fim: o \n do nome nao quebra a moldura
  })
  it('deveEncurtarNomesMuitoLongos', () => {
    expect(plain(renderStatusline({ model: { display_name: 'x'.repeat(500) } }, '', now)).length).toBeLessThan(80)
  })
  it('deveEntenderResetEmMilissegundos', () => {
    const ms = Date.parse('2026-10-27T15:54:00Z')
    expect(plain(renderStatusline({ rate_limits: { five_hour: { used_percentage: 10, resets_at: ms } } }, '', now))).toContain('↺ 3h54m')
  })
})
