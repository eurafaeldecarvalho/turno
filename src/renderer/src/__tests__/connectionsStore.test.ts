import { describe, it, expect } from 'vitest'
import { connectionsReducer, validateConnectionForm, newConnectionId } from '../connectionsStore'
import type { Connection } from '../../../shared/types'

const claude: Connection = { id: 'claude-max', name: 'Claude', kind: 'claude' }
const ollama: Connection = { id: 'qwen-local', name: 'Ollama', kind: 'endpoint', baseUrl: 'http://localhost:11434', model: 'qwen3:14b' }

describe('connectionsReducer', () => {
  it('add anexa a connection', () => {
    const list = connectionsReducer([claude], { type: 'add', conn: ollama })
    expect(list).toHaveLength(2)
    expect(list[1].id).toBe('qwen-local')
  })
  it('update aplica o patch pela id', () => {
    const list = connectionsReducer([ollama], { type: 'update', id: 'qwen-local', patch: { model: 'llama3' } })
    expect(list[0].model).toBe('llama3')
  })
  it('remove apaga pela id', () => {
    const list = connectionsReducer([claude, ollama], { type: 'remove', id: 'qwen-local' })
    expect(list.map((c) => c.id)).toEqual(['claude-max'])
  })
})

describe('validateConnectionForm', () => {
  it('endpoint exige baseUrl e model', () => {
    expect(validateConnectionForm({ name: 'X', kind: 'endpoint' })).toBeTruthy()
    expect(validateConnectionForm({ name: 'X', kind: 'endpoint', baseUrl: 'http://h', model: 'm' })).toBeNull()
  })
  it('claude dispensa baseUrl/model', () => {
    expect(validateConnectionForm({ name: 'Claude', kind: 'claude' })).toBeNull()
  })
  it('nome vazio e invalido', () => {
    expect(validateConnectionForm({ name: '', kind: 'claude' })).toBeTruthy()
  })
})

describe('newConnectionId', () => {
  it('gera id unico que nao colide', () => {
    const id = newConnectionId([claude, ollama], 'claude-max')
    expect([claude.id, ollama.id]).not.toContain(id)
  })
})
