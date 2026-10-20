import { describe, it, expect } from 'vitest'
import { themeById, THEMES, type Theme } from '../themes'

const HEX6 = /^#[0-9a-fA-F]{6}$/
const HEX6_OR_8 = /^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/

// Temas novos que precisam existir (pesquisa de popularidade: VSCode Marketplace + terminais).
const NEW_IDS = [
  'gruvbox-dark', 'gruvbox-light', 'solarized-dark', 'solarized-light', 'monokai-pro',
  'one-light', 'github-dark', 'catppuccin-latte', 'catppuccin-frappe', 'catppuccin-macchiato',
  'night-owl', 'ayu-dark', 'ayu-mirage', 'rose-pine', 'everforest-dark', 'kanagawa-wave',
]

describe('themeById', () => {
  it('retorna o tema correspondente ao id', () => {
    expect(themeById('dracula').name).toBe('Dracula')
  })
  it('cai no primeiro tema quando o id nao existe', () => {
    expect(themeById('nao-existe')).toBe(THEMES[0])
  })
})

describe('catalogo de temas', () => {
  it('ids sao unicos', () => {
    const ids = THEMES.map((t) => t.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('inclui todos os temas populares novos', () => {
    const ids = new Set(THEMES.map((t) => t.id))
    for (const id of NEW_IDS) expect(ids, `faltando ${id}`).toContain(id)
  })

  it('accent nao colide com o texto (legibilidade)', () => {
    for (const t of THEMES) expect(t.ui.accent.toLowerCase(), t.id).not.toBe(t.ui.text.toLowerCase())
  })

  it('toda cor de UI e hex de 6 digitos', () => {
    for (const t of THEMES)
      for (const [k, v] of Object.entries(t.ui)) expect(v, `${t.id}.ui.${k}`).toMatch(HEX6)
  })

  it('paleta do terminal tem hex valido em todos os campos', () => {
    const base: Array<keyof Theme['term']> = [
      'background', 'foreground', 'cursor',
      'black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white',
      'brightBlack', 'brightRed', 'brightGreen', 'brightYellow', 'brightBlue', 'brightMagenta', 'brightCyan', 'brightWhite',
    ]
    for (const t of THEMES) {
      for (const k of base) expect(t.term[k], `${t.id}.term.${k}`).toMatch(HEX6)
      // selectionBackground/cursorAccent podem ter alpha (#rrggbbaa)
      expect(t.term.selectionBackground, `${t.id}.term.selectionBackground`).toMatch(HEX6_OR_8)
      if (t.term.cursorAccent) expect(t.term.cursorAccent, `${t.id}.term.cursorAccent`).toMatch(HEX6_OR_8)
    }
  })
})
