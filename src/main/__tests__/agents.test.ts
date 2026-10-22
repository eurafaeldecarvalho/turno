import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AGENTS, agentCommand, agentDef, isWallText, quoteArg, unavailableText } from '../../shared/agents'

let dir = ''
vi.mock('electron', () => ({ app: { getPath: () => dir } }))

describe('catalogo de agentes', () => {
  it('todo agente tem id unico, nome e comando', () => {
    const ids = AGENTS.map((a) => a.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const a of AGENTS) expect(a.name && a.cmd).toBeTruthy()
  })

  it('prompt vai no comando conforme o estilo do agente', () => {
    expect(agentCommand(agentDef('claude')!, { prompt: 'faz isso' }).command).toBe('claude "faz isso"')
    expect(agentCommand(agentDef('gemini')!, { prompt: 'x' }).command).toBe('gemini -i "x"')
    const kiro = agentCommand(agentDef('kiro')!, { prompt: 'y' })
    expect(kiro.command).toBe('kiro-cli chat --tui')
    expect(kiro.typeAfter).toBe('y')
  })

  it('resume usa o comando do agente e os extras vem antes do prompt', () => {
    const c = agentCommand(agentDef('claude')!, { resumeId: 'abc', prompt: 'continue', extraArgs: '--settings "f.json"' })
    expect(c.command).toBe('claude --resume abc --settings "f.json" "continue"')
    expect(agentCommand(agentDef('codex')!, { resumeId: 'r1' }).command).toBe('codex resume r1')
  })

  it('aspas internas e quebras de linha nao quebram o comando', () => {
    expect(quoteArg('diga "oi"\nagora')).toBe(`"diga 'oi' agora"`)
  })

  it('nada dentro das aspas e interpretado pelo shell (titulo de issue malicioso)', () => {
    const q = quoteArg('Fix $(Write-Output X) `n bug \u201D; calc; \u201C %PATH% !x! C:\\dir\\')
    expect(q).not.toMatch(/[$`%!\u201C\u201D]/)
    expect(q.slice(1, -1)).not.toContain('"')
    expect(q.endsWith('\\"')).toBe(false)
  })
})

describe('texto de "nenhuma conta disponivel" (o mesmo no botao, no Chat e no main)', () => {
  const acc = (id: string, enabled = true) => ({ id, label: id, enabled })
  it('cobre desligadas, sem login, mistura de limite e bloqueio', () => {
    expect(unavailableText([acc('a', false)], {}, [])).toMatch(/turned off/)
    expect(unavailableText([acc('a')], {}, ['a'])).toMatch(/signed in yet/)
    expect(unavailableText([acc('a')], { a: { state: 'warning' } }, [])).toBe('')
    const t = unavailableText([acc('a'), acc('b'), acc('c')], { a: { state: 'exhausted', until: new Date(Date.now() + 3600_000).toISOString() }, b: { state: 'blocked', reason: 'login expired: sign in again' }, c: { state: 'blocked', reason: 'account on hold: check your plan or billing' } }, [])
    expect(t).toMatch(/back at/)
    expect(t).toMatch(/b needs a new sign-in/)
    expect(t).toMatch(/c: account on hold/)
  })
})

describe('texto de parede (limite) nos agentes sem hooks', () => {
  it('reconhece as frases fortes', () => {
    expect(isWallText("You've hit your usage limit. Resets at 3pm")).toBe(true)
    expect(isWallText('Error: RESOURCE_EXHAUSTED quota')).toBe(true)
    expect(isWallText('UsageLimitExceeded: try later')).toBe(true)
    expect(isWallText("You've hit your usage limit. Upgrade to Pro (https://chatgpt.com/explore/pro), visit https://chatgpt.com/codex/settings/usage to purchase more credits or try again at 3:05 PM.")).toBe(true)
  })
  it('ignora contexto, tokens e linhas longas (falsos positivos)', () => {
    expect(isWallText('context window limit reached')).toBe(false)
    expect(isWallText('max tokens exceeded, usage limit reached')).toBe(false)
    expect(isWallText('x'.repeat(500) + ' usage limit reached')).toBe(false)
  })
  it('ignora diff, grep e codigo que so citam a frase', () => {
    expect(isWallText(`+    expect(isWallText("You've hit your usage limit")).toBe(true)`)).toBe(false)
    expect(isWallText('src/main/gemini.ts:12:  if (e.status === RESOURCE_EXHAUSTED) retry()')).toBe(false)
    expect(isWallText('> quota exceeded is handled by the retry layer')).toBe(false)
    expect(isWallText('The README explains what happens when you see a long story about how usage limit reached in our app')).toBe(false)
    expect(isWallText('■ You’ve hit your usage limit. Try again at 3:05 PM.')).toBe(true)
  })
})

describe('ranking de contas', () => {
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'turno-acc-'))
    vi.resetModules()
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  const seed = (accounts: unknown[]): void =>
    writeFileSync(join(dir, 'accounts.json'), JSON.stringify({ accounts, thresholds: { fiveHour: 90, weekly: 95 } }))
  const acc = (id: string, rank: number, extra: object = {}) => ({ id, agent: 'claude', label: id, rank, enabled: true, home: null, createdAt: '2026-01-01', ...extra })

  it('escolhe a de menor rank com folga e pula as esgotadas, desligadas e no limiar', async () => {
    seed([acc('a', 1), acc('b', 2), acc('c', 3), acc('d', 4, { enabled: false })])
    const m = await import('../accounts')
    expect(m.pickAccount()?.id).toBe('a')
    m.markAccount('a', 'exhausted', 'limit', new Date(Date.now() + 3600_000).toISOString())
    expect(m.pickAccount()?.id).toBe('b')
    m.recordUsage('b', { fiveHour: { pct: 92, resetsAt: new Date(Date.now() + 3600_000).toISOString() } })
    expect(m.effectiveUsage('b').state).toBe('warning')
    expect(m.pickAccount()?.id).toBe('c')
    expect(m.pickAccount({ exclude: ['c'] })).toBeUndefined()
    // abrir com todas no limiar: ainda tem cota, usa a melhor delas em vez de recusar
    expect(m.pickAccount({ exclude: ['c'], allowWarning: true })?.id).toBe('b')
  })

  it('esgotada volta a valer depois do reset', async () => {
    seed([acc('a', 1)])
    const m = await import('../accounts')
    m.markAccount('a', 'exhausted', 'limit', new Date(Date.now() - 5 * 60_000).toISOString())
    expect(m.pickAccount()?.id).toBe('a')
  })

  it('excludeAgent tira um fornecedor inteiro (conta suspensa)', async () => {
    seed([acc('a', 1), { ...acc('x', 2), agent: 'codex' }])
    const m = await import('../accounts')
    expect(m.pickAccount({ excludeAgent: 'claude' })?.id).toBe('x')
  })

  it('env de conta isolada aponta a pasta e limpa credenciais de API herdadas', async () => {
    seed([])
    const m = await import('../accounts')
    const env = m.accountEnv({ ...acc('z', 1), home: 'C:/p/home' } as never)
    expect(env).toMatchObject({ CLAUDE_CONFIG_DIR: 'C:/p/home', ANTHROPIC_API_KEY: '', ANTHROPIC_AUTH_TOKEN: '' })
    expect(m.accountEnv(acc('d', 1) as never)).toEqual({})
  })
})
