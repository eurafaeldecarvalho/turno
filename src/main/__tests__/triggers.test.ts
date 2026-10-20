import { describe, it, expect, vi } from 'vitest'
import { debounce, shouldFireOnExit, watchShouldSkip } from '../triggers'

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

describe('watchShouldSkip (anti-loop + respeita run pausada)', () => {
  const NOW = 1_000_000
  const COOL = 30_000
  it('sem run anterior: nao pula (pode disparar)', () => {
    expect(watchShouldSkip(undefined, NOW, COOL)).toBe(false)
  })
  it('run em andamento/pausada (ended_at null): PULA (nunca inicia outra)', () => {
    expect(watchShouldSkip({ ended_at: null }, NOW, COOL)).toBe(true)
  })
  it('run terminou dentro do cooldown: PULA (anti-loop por self-write)', () => {
    expect(watchShouldSkip({ ended_at: new Date(NOW - 10_000).toISOString() }, NOW, COOL)).toBe(true)
  })
  it('run terminou antes do cooldown: nao pula', () => {
    expect(watchShouldSkip({ ended_at: new Date(NOW - 60_000).toISOString() }, NOW, COOL)).toBe(false)
  })
})

describe('shouldFireOnExit', () => {
  it('dispara so quando o comando sai != 0', () => {
    expect(shouldFireOnExit(1)).toBe(true)
    expect(shouldFireOnExit(0)).toBe(false)
    expect(shouldFireOnExit(null)).toBe(false)
  })
})
