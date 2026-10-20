import { describe, it, expect } from 'vitest'
import { materializeRecipe, RECIPES } from '../recipes'

describe('recipes', () => {
  it('ha recipes no catalogo', () => {
    expect(RECIPES.length).toBeGreaterThan(0)
  })

  it('cada recipe materializa um config valido + prompt nao-vazio + id em kebab-case', () => {
    for (const r of RECIPES) {
      const d = materializeRecipe(r)
      expect(d.config.name.length, r.id).toBeGreaterThan(0)
      expect(d.prompt.trim().length, r.id).toBeGreaterThan(0)
      expect(d.id, r.id).toMatch(/^[a-z0-9][a-z0-9-]*$/)
    }
  })

  it('ids das recipes sao unicos', () => {
    const ids = RECIPES.map((r) => r.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('overrides sobrescrevem os defaults da recipe', () => {
    const d = materializeRecipe(RECIPES[0], { profile: 'qwen-local', timezone: 'UTC' })
    expect(d.config.profile).toBe('qwen-local')
    expect(d.config.timezone).toBe('UTC')
  })

  it('override invalido e rejeitado pela validacao do schema', () => {
    expect(() => materializeRecipe(RECIPES[0], { timeout_min: -5 as unknown as number })).toThrow()
  })
})
