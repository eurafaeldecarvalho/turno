import { describe, it, expect } from 'vitest'
import { THEMES } from '../../../shared/themes'

// Contraste WCAG (mesma conta do themes.ts), para texto secundario pequeno continuar legivel em todo tema.
const lum = (hex: string): number => {
  const n = parseInt(hex.replace('#', '').slice(0, 6), 16)
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => {
    const v = c / 255
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2]
}
const ratio = (a: string, b: string): number => {
  const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m)
  return (x + 0.05) / (y + 0.05)
}

describe('texto secundario legivel em todos os temas', () => {
  for (const t of THEMES) {
    // contra o pior fundo onde o texto aparece (pagina, cards, campos); tema cujo proprio texto fica abaixo
    // de 4.5 (Solarized Light) so precisa empatar com ele
    const bgs = [t.ui.bg, t.ui.surface, t.ui.surface2, t.ui.surface3]
    const worst = (c: string): number => Math.min(...bgs.map((b) => ratio(c, b)))
    const min = Math.min(4.5, worst(t.ui.text))
    it(`${t.name}: muted, faint e cores de texto >= ${min.toFixed(2)}:1 em bg/surface/surface2/surface3`, () => {
      expect(worst(t.ui.muted)).toBeGreaterThanOrEqual(min - 0.01)
      expect(worst(t.ui.faint)).toBeGreaterThanOrEqual(min - 0.01)
      for (const c of [t.ui.accentText, t.ui.okText, t.ui.warnText, t.ui.errText, t.ui.runText]) expect(worst(c!)).toBeGreaterThanOrEqual(min - 0.01)
    })
  }
})
