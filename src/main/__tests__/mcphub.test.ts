import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let dir = ''
const vault = new Map<string, string>()
vi.mock('electron', () => ({ app: { getPath: () => dir } }))
vi.mock('../secrets', () => ({
  getSecret: (k: string) => vault.get(k) ?? null,
  setSecret: (k: string, v: string) => void vault.set(k, v),
  deleteSecret: (k: string) => void vault.delete(k),
}))
vi.mock('../sidebar', () => ({ getSidebar: () => ({ collapsed: {}, folders: [{ id: 'f1', name: 'F', items: [], mcp: ['gh'], context: 'linha 1\nlinha 2' }] }) }))

describe('hub de MCP', () => {
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'turno-mcp-'))
    vault.clear()
    vi.resetModules()
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('config so com placeholders; o segredo vai pelo env do processo', async () => {
    const m = await import('../mcphub')
    m.saveMcp({ id: 'gh', name: 'GitHub', transport: 'http', url: 'https://api.example/mcp', headers: { Authorization: 'Bearer ${GITHUB_TOKEN}' }, secrets: ['GITHUB_TOKEN'] }, { GITHUB_TOKEN: 'ghp_secret' })
    const r = m.routineMcpArgs('r1', ['gh', 'nao-existe'], true)
    const file = r.args[r.args.indexOf('--mcp-config') + 1]
    const cfg = readFileSync(file, 'utf8')
    expect(cfg).not.toContain('ghp_secret')
    expect(JSON.parse(cfg).mcpServers['turno-gh'].headers.Authorization).toBe('Bearer ${TURNO_MCP_GH_GITHUB_TOKEN}')
    expect(r.env).toEqual({ TURNO_MCP_GH_GITHUB_TOKEN: 'ghp_secret' })
    expect(r.args).toContain('--strict-mcp-config')
  })

  it('segredo na URL e nos argumentos tambem vira placeholder do env', async () => {
    const m = await import('../mcphub')
    m.saveMcp({ id: 'web', name: 'Web', transport: 'http', url: 'https://a/${TOKEN}/mcp', secrets: ['TOKEN'] }, { TOKEN: 't1' })
    m.saveMcp({ id: 'loc', name: 'Loc', transport: 'stdio', command: 'node', args: ['x.js', '--k=${KEY}'], secrets: ['KEY'] }, { KEY: 'k1' })
    const r = m.routineMcpArgs('r3', ['web', 'loc'], false)
    const cfg = JSON.parse(readFileSync(r.args[r.args.indexOf('--mcp-config') + 1], 'utf8'))
    expect(cfg.mcpServers['turno-web'].url).toBe('https://a/${TURNO_MCP_WEB_TOKEN}/mcp')
    expect(cfg.mcpServers['turno-loc'].args).toEqual(['x.js', '--k=${TURNO_MCP_LOC_KEY}'])
    expect(JSON.stringify(cfg)).not.toMatch(/t1|k1/)
  })

  it('editar para um nome repetido e recusado', async () => {
    const m = await import('../mcphub')
    m.saveMcp({ id: '', name: 'Sentry', transport: 'http', url: 'https://a/mcp' })
    const b = m.saveMcp({ id: '', name: 'Sentry', transport: 'http', url: 'https://a/mcp' })
    expect(() => m.saveMcp({ ...b, name: 'sentry' })).toThrow(/already named/)
  })

  it('id desconhecido nunca amplia e lista vazia nao gera --mcp-config', async () => {
    const m = await import('../mcphub')
    expect(m.routineMcpArgs('r2', ['x'], false).args).toEqual([])
  })

  it('aba de pasta recebe os MCPs e o cartao da pasta; --mcp-config nunca e o ultimo argumento solto', async () => {
    const m = await import('../mcphub')
    m.saveMcp({ id: 'gh', name: 'GitHub', transport: 'stdio', command: 'npx', args: ['-y', 'x'] })
    const x = m.claudeLaunchExtras({ key: 'k1', folderId: 'f1' })
    expect(x.args).toMatch(/^--mcp-config ".+k1\.mcp\.json" --append-system-prompt-file ".+k1\.context\.md"$/)
  })

  it('cartao de contexto corta em 15 linhas', async () => {
    const m = await import('../mcphub')
    const card = m.cardText(Array.from({ length: 30 }, (_, i) => `l${i}`).join('\n'))
    expect(card.split('\n').length).toBe(16) // cabecalho + 15
  })

  it('segredo que sai da lista e apagado; nome de segredo invalido e recusado', async () => {
    const m = await import('../mcphub')
    m.saveMcp({ id: 'gh', name: 'GitHub', transport: 'http', url: 'https://a/mcp', secrets: ['GITHUB_TOKEN'] }, { GITHUB_TOKEN: 'v1' })
    expect(vault.get('mcp:gh:GITHUB_TOKEN')).toBe('v1')
    m.saveMcp({ id: 'gh', name: 'GitHub', transport: 'http', url: 'https://a/mcp', secrets: ['OTHER'] })
    expect(vault.has('mcp:gh:GITHUB_TOKEN')).toBe(false)
    expect(() => m.saveMcp({ id: 'gh', name: 'GitHub', transport: 'http', url: 'https://a/mcp', secrets: ['GH TOKEN'] })).toThrow(/secret name/)
  })

  it('servidor novo com o mesmo nome ganha outro id (nao sobrescreve)', async () => {
    const m = await import('../mcphub')
    m.saveMcp({ id: '', name: 'Sentry', transport: 'http', url: 'https://a/mcp' })
    const b = m.saveMcp({ id: '', name: 'Sentry', transport: 'http', url: 'https://b/mcp' })
    expect(b.id).toBe('sentry-2')
    expect(b.name).toBe('Sentry 2')
  })

  it('id de servidor removido nunca volta (pasta/rotina que o citava nao ganha o servidor novo)', async () => {
    const m = await import('../mcphub')
    m.saveMcp({ id: '', name: 'GitHub', transport: 'http', url: 'https://a/mcp' })
    m.removeMcp('github')
    expect(m.saveMcp({ id: '', name: 'GitHub', transport: 'http', url: 'https://a/mcp' }).id).toBe('github-2')
  })

  it('valida id, URL e comando', async () => {
    const m = await import('../mcphub')
    expect(() => m.saveMcp({ id: 'Bad Id', name: 'x', transport: 'http', url: 'https://a' })).toThrow(/id/)
    expect(() => m.saveMcp({ id: 'a', name: 'x', transport: 'http', url: 'ftp://a' })).toThrow(/URL/)
    expect(() => m.saveMcp({ id: 'a', name: 'x', transport: 'stdio' })).toThrow(/command/)
  })
})
