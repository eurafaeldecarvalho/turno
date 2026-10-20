import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest'
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Estado mutavel compartilhado com o mock de electron (hoisted roda antes dos imports).
const h = vi.hoisted(() => ({ dir: '', available: true }))

vi.mock('electron', () => ({
  app: { getPath: () => h.dir },
  safeStorage: {
    isEncryptionAvailable: () => h.available,
    // Cifra fake reversivel (prefixo ENC::) so para o teste.
    encryptString: (s: string) => Buffer.from('ENC::' + s, 'utf8'),
    decryptString: (b: Buffer) => b.toString('utf8').slice(5),
  },
}))

import { setSecret, getSecret, hasSecret, deleteSecret } from '../secrets'

const SECRET = 'sk-super-secreto-123'

beforeAll(() => {
  h.dir = mkdtempSync(join(tmpdir(), 'turno-secrets-'))
})
beforeEach(() => {
  h.available = true
  writeFileSync(join(h.dir, 'secrets.json'), '{}')
})

describe('secrets', () => {
  it('get de chave inexistente retorna null', () => {
    expect(getSecret('nao-existe')).toBeNull()
  })

  it('set e depois get fazem roundtrip', () => {
    setSecret('tok', SECRET)
    expect(getSecret('tok')).toBe(SECRET)
  })

  it('o arquivo salvo NAO contem o segredo em texto puro', () => {
    setSecret('tok', SECRET)
    const raw = readFileSync(join(h.dir, 'secrets.json'), 'utf8')
    expect(raw).not.toContain(SECRET)
  })

  it('hasSecret e deleteSecret', () => {
    setSecret('tok', SECRET)
    expect(hasSecret('tok')).toBe(true)
    deleteSecret('tok')
    expect(hasSecret('tok')).toBe(false)
    expect(getSecret('tok')).toBeNull()
  })

  it('sem cofre disponivel, set lanca e nao grava em texto puro', () => {
    h.available = false
    expect(() => setSecret('tok', SECRET)).toThrow()
    const raw = readFileSync(join(h.dir, 'secrets.json'), 'utf8')
    expect(raw).not.toContain(SECRET)
  })
})
