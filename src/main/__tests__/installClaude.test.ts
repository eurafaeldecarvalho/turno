import { describe, it, expect, vi } from 'vitest'

// execFile simulado: conta as chamadas e so termina quando o teste manda (nenhum instalador de verdade roda)
const calls: Array<(err: Error | null, out: string, errOut: string) => void> = []
vi.mock('node:child_process', () => ({
  execFile: (_f: string, _a: string[], _o: unknown, cb: (err: Error | null, out: string, errOut: string) => void) => void calls.push(cb),
}))

describe('instalacao do Claude pela introducao', () => {
  it('naoDeveRodarDoisInstaladoresAoMesmoTempo', async () => {
    const { installClaude } = await import('../onboarding')
    const a = installClaude()
    const b = installClaude()
    expect(calls).toHaveLength(1)
    calls[0](null, 'ok', '')
    expect(await a).toEqual(await b)
    // terminou: um pedido novo instala de novo
    void installClaude()
    expect(calls).toHaveLength(2)
  })
})
