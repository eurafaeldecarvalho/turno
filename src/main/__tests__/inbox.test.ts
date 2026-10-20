import { describe, it, expect } from 'vitest'
import { matchAllowlist, PendingInbox } from '../inbox'

describe('matchAllowlist', () => {
  it('regra so com nome casa pelo nome da tool', () => {
    expect(matchAllowlist('Read', undefined, ['Read'])).toBe(true)
    expect(matchAllowlist('Edit', undefined, ['Read'])).toBe(false)
  })
  it('regra com padrao casa o comando (glob)', () => {
    expect(matchAllowlist('Bash', 'git status', ['Bash(git *)'])).toBe(true)
    expect(matchAllowlist('Bash', 'rm -rf /', ['Bash(git *)'])).toBe(false)
  })
  it('regra com padrao exige comando', () => {
    expect(matchAllowlist('Bash', undefined, ['Bash(git *)'])).toBe(false)
  })
  it('sem regras nao casa nada', () => {
    expect(matchAllowlist('Read', undefined, [])).toBe(false)
  })
})

describe('PendingInbox', () => {
  const item = (id: string, runId: string) => ({ id, runId, tool: 'Bash', what: 'ls' })

  it('add/get/all', () => {
    const q = new PendingInbox()
    q.add(item('a', 'r1'))
    q.add(item('b', 'r1'))
    expect(q.all()).toHaveLength(2)
    expect(q.get('a')?.runId).toBe('r1')
  })
  it('resolve remove e devolve o item', () => {
    const q = new PendingInbox()
    q.add(item('a', 'r1'))
    expect(q.resolve('a')?.id).toBe('a')
    expect(q.get('a')).toBeUndefined()
    expect(q.resolve('a')).toBeUndefined()
  })
  it('resolveRun resolve todos de uma run em lote', () => {
    const q = new PendingInbox()
    q.add(item('a', 'r1'))
    q.add(item('b', 'r1'))
    q.add(item('c', 'r2'))
    const done = q.resolveRun('r1')
    expect(done.map((i) => i.id).sort()).toEqual(['a', 'b'])
    expect(q.all().map((i) => i.id)).toEqual(['c'])
  })
})
