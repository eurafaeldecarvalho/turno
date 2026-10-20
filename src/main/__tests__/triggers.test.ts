import { describe, it, expect, vi } from 'vitest'
import { debounce, shouldFireOnExit } from '../triggers'

describe('debounce', () => {
  it('coalesce N chamadas na janela em 1 disparo', () => {
    vi.useFakeTimers()
    const fn = vi.fn()
    const d = debounce(fn, 100)
    d()
    d()
    d()
    expect(fn).not.toHaveBeenCalled()
    vi.advanceTimersByTime(100)
    expect(fn).toHaveBeenCalledTimes(1)
    vi.useRealTimers()
  })
})

describe('shouldFireOnExit', () => {
  it('dispara so quando o comando sai != 0', () => {
    expect(shouldFireOnExit(1)).toBe(true)
    expect(shouldFireOnExit(0)).toBe(false)
    expect(shouldFireOnExit(null)).toBe(false)
  })
})
