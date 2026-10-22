import { describe, it, expect, afterEach, vi } from 'vitest'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let home = ''
vi.mock('node:os', async (orig) => ({ ...(await orig<typeof import('node:os')>()), homedir: () => home }))

describe('confianca na pasta: so copiada de outra conta, nunca criada', () => {
  afterEach(() => {
    rmSync(home, { recursive: true, force: true })
    vi.resetModules()
  })
  const setup = (): { repo: string; acc: string; other: string } => {
    home = mkdtempSync(join(tmpdir(), 'turno-trust-'))
    const repo = join(home, 'repo')
    const acc = join(home, 'acc')
    const other = join(home, 'other')
    for (const d of [repo, acc, other]) mkdirSync(d)
    writeFileSync(join(home, '.claude.json'), JSON.stringify({ projects: {} }))
    writeFileSync(join(acc, '.claude.json'), JSON.stringify({ projects: {} }))
    writeFileSync(join(other, '.claude.json'), JSON.stringify({ projects: {} }))
    return { repo, acc, other }
  }
  const trusted = (file: string, dir: string): boolean =>
    Object.entries(JSON.parse(readFileSync(file, 'utf8')).projects ?? {}).some(([k, v]) => k.toLowerCase() === dir.replace(/\\/g, '/').toLowerCase() && (v as { hasTrustDialogAccepted?: boolean }).hasTrustDialogAccepted === true)

  it('pasta nova nao vira confiavel em conta nenhuma', async () => {
    delete process.env.CLAUDE_CONFIG_DIR
    const { repo, acc } = setup()
    const { prepareClaude } = await import('../claudeprep')
    prepareClaude(repo, false)
    prepareClaude(repo, false, acc)
    expect(trusted(join(home, '.claude.json'), repo)).toBe(false)
    expect(trusted(join(acc, '.claude.json'), repo)).toBe(false)
  })
  it('confianca dada em outra conta e copiada para a conta da troca', async () => {
    delete process.env.CLAUDE_CONFIG_DIR
    const { repo, acc, other } = setup()
    writeFileSync(join(other, '.claude.json'), JSON.stringify({ projects: { [repo.replace(/\\/g, '/')]: { hasTrustDialogAccepted: true } } }))
    const { prepareClaude } = await import('../claudeprep')
    prepareClaude(repo, false, acc, [join(other, '.claude.json')])
    expect(trusted(join(acc, '.claude.json'), repo)).toBe(true)
  })
  it('a pasta do usuario nunca e gravada como confiavel', async () => {
    delete process.env.CLAUDE_CONFIG_DIR
    const { acc } = setup()
    writeFileSync(join(home, '.claude.json'), JSON.stringify({ projects: { [home.replace(/\\/g, '/')]: { hasTrustDialogAccepted: true } } }))
    const { prepareClaude } = await import('../claudeprep')
    prepareClaude(undefined, false, acc)
    expect(trusted(join(acc, '.claude.json'), home)).toBe(false)
  })
})
