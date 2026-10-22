import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { DEFAULT_CONNECTIONS, resolveProviderEnv } from '../providers'

const SRC = join(__dirname, '..', '..')
const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((f) => {
    const p = join(dir, f)
    return statSync(p).isDirectory() ? files(p) : /\.(ts|tsx)$/.test(f) ? [p] : []
  })

describe('modelo do terminal vem da conexao (sem nome de modelo fixo)', () => {
  it('mudar conn.model muda o modelo que o terminal recebe', () => {
    const base = DEFAULT_CONNECTIONS.find((c) => c.id === 'qwen-local')!
    for (const model of ['qwen3:14b', 'outro-modelo:7b']) {
      const env = resolveProviderEnv({ ...base, model }, 'ollama')
      expect(env.ANTHROPIC_MODEL).toBe(model)
      expect(env.ANTHROPIC_DEFAULT_SONNET_MODEL).toBe(model)
      expect(env.CLAUDE_CODE_SUBAGENT_MODEL).toBe(model)
    }
  })

  it('nenhum comando de agente/retomada passa --model com nome fixo (passaria por cima do env)', () => {
    const store = readFileSync(join(SRC, 'renderer', 'src', 'sidebarStore.ts'), 'utf8')
    expect(store).not.toMatch(/--model [a-z0-9][\w.:-]*/i)
  })

  it("'qwen3.6' nao aparece em lugar nenhum do src", () => {
    const hits = files(SRC).filter((f) => !f.endsWith('modelFromConnection.test.ts') && readFileSync(f, 'utf8').includes('qwen3' + '.6'))
    expect(hits).toEqual([])
  })
})
