import { describe, it, expect } from 'vitest'
import { shouldAbortForBudget } from '../budget'

describe('shouldAbortForBudget', () => {
  it('sem limite definido nunca aborta', () => {
    expect(shouldAbortForBudget(999, undefined)).toBe(false)
  })
  it('gasto ACIMA do limite aborta', () => {
    expect(shouldAbortForBudget(0.51, 0.5)).toBe(true)
  })
  it('gasto no limite ou abaixo nao aborta', () => {
    expect(shouldAbortForBudget(0.5, 0.5)).toBe(false)
    expect(shouldAbortForBudget(0.1, 0.5)).toBe(false)
  })
  it('limite zero aborta a qualquer gasto positivo', () => {
    expect(shouldAbortForBudget(0.0001, 0)).toBe(true)
    expect(shouldAbortForBudget(0, 0)).toBe(false)
  })
})
