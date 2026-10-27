import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// o limite de file watchers do Linux esgotado (ENOSPC) nao pode derrubar o app: o watch vira verificacao periodica
vi.mock('node:fs', async (orig) => {
  const real = await orig<typeof import('node:fs')>()
  return {
    ...real,
    watch: () => {
      const e = new Error('ENOSPC: System limit for number of file watchers reached') as NodeJS.ErrnoException
      e.code = 'ENOSPC'
      throw e
    },
  }
})

const { watchRoutines } = await import('../routines')

let root: string
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'turno-watch-'))
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
  rmSync(root, { recursive: true, force: true })
})

describe('watchRoutines sem file watchers disponiveis', () => {
  it('nao lanca quando o sistema recusa o watch (ENOSPC)', () => {
    const w = watchRoutines(root, () => {})
    expect(typeof w.close).toBe('function')
    w.close()
  })

  it('percebe uma rotina nova por verificacao periodica', () => {
    const onChange = vi.fn()
    const w = watchRoutines(root, onChange)
    mkdirSync(join(root, 'nova'))
    writeFileSync(join(root, 'nova', 'ROUTINE.md'), '---\nname: nova\n---\nx\n')
    vi.advanceTimersByTime(6000)
    expect(onChange).toHaveBeenCalled()
    w.close()
  })

  it('percebe a edicao de um ROUTINE.md existente', () => {
    mkdirSync(join(root, 'r1'))
    const f = join(root, 'r1', 'ROUTINE.md')
    writeFileSync(f, '---\nname: r1\n---\nx\n')
    const onChange = vi.fn()
    const w = watchRoutines(root, onChange)
    vi.advanceTimersByTime(6000)
    expect(onChange).not.toHaveBeenCalled()
    utimesSync(f, new Date(), new Date(Date.now() + 60_000))
    vi.advanceTimersByTime(6000)
    expect(onChange).toHaveBeenCalledTimes(1)
    w.close()
  })
})
