import { describe, it, expect } from 'vitest'
import { fanOut } from '../fanout'

describe('fanOut', () => {
  it('coleta resultados tolerando falha parcial (allSettled), ordem preservada', async () => {
    const res = await fanOut<number>([
      () => Promise.resolve(1),
      () => Promise.reject(new Error('boom')),
      () => Promise.resolve(3),
    ])
    expect(res).toHaveLength(3)
    expect(res[0]).toMatchObject({ index: 0, value: 1 })
    expect(res[1].error).toContain('boom')
    expect(res[1].value).toBeUndefined()
    expect(res[2]).toMatchObject({ index: 2, value: 3 })
  })

  it('1 agente falhar nao derruba os outros', async () => {
    const res = await fanOut<string>([() => Promise.reject(new Error('x')), () => Promise.resolve('ok')])
    expect(res.filter((r) => r.value !== undefined)).toHaveLength(1)
    expect(res.filter((r) => r.error)).toHaveLength(1)
  })
})
