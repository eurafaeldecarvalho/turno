import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { AGENTS, agentCommand, agentDef, isWallText, quoteArg, unavailableText, wallKind, parseReset } from '../../shared/agents'

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

describe('tipo de parede e horario de volta', () => {
  it('separa limite, credito e conta suspensa', () => {
    expect(wallKind("You've hit your usage limit. Try again at 3:05 PM.")).toBe('limit')
    expect(wallKind('Error: insufficient credits for this request')).toBe('credits')
    expect(wallKind('■ Your account has been suspended. Contact support.')).toBe('banned')
    expect(wallKind('+ expect(wallKind("Your account has been suspended"))')).toBeUndefined()
    // saida comum de programa nao e parede
    expect(wallKind('✓ rejects transfer with insufficient balance')).toBeUndefined()
    expect(wallKind('HTTP/1.1 402 Payment Required')).toBeUndefined()
    expect(wallKind('the account is suspended after 3 failed logins')).toBeUndefined()
  })
  it('le "in 1h 20m", "45 minutes" e "at 3:05 PM"', () => {
    const now = new Date(2026, 9, 22, 10, 0, 0).getTime()
    expect(parseReset('Try again in 1h 20m.', now)).toBe(new Date(now + 80 * 60_000).toISOString())
    expect(parseReset('Your limit resets in 45 minutes', now)).toBe(new Date(now + 45 * 60_000).toISOString())
    expect(new Date(parseReset('try again at 3:05 PM', now)!).getHours()).toBe(15)
    expect(new Date(parseReset('resets at 9:00', now)!).getDate()).toBe(23) // ja passou hoje: amanha
    expect(parseReset('limit reached', now)).toBeUndefined()
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

  it('estrategias: mais folga primeiro e a que reseta antes primeiro', async () => {
    const soon = new Date(Date.now() + 3600_000).toISOString()
    const later = new Date(Date.now() + 5 * 86_400_000).toISOString()
    writeFileSync(join(dir, 'accounts.json'), JSON.stringify({ accounts: [acc('a', 1), acc('b', 2)], thresholds: { fiveHour: 90, weekly: 95, strategy: 'headroom' } }))
    const m = await import('../accounts')
    m.recordUsage('a', { weekly: { pct: 70, resetsAt: later } })
    m.recordUsage('b', { weekly: { pct: 20, resetsAt: soon } })
    expect(m.pickAccount()?.id).toBe('b')
    m.setThresholds({ strategy: 'rank' })
    expect(m.pickAccount()?.id).toBe('a')
    m.setThresholds({ strategy: 'reset-soonest' })
    expect(m.pickAccount()?.id).toBe('b')
  })

  it('usage.json com data estragada e descartado sem quebrar', async () => {
    seed([acc('a', 1)])
    writeFileSync(join(dir, 'usage.json'), JSON.stringify({ a: { state: 'exhausted', until: 'garbage', weekly: { pct: 50, resetsAt: 'x' } } }))
    const m = await import('../accounts')
    m.agentsState() // carrega os arquivos, como o initAccounts na abertura
    const u = m.effectiveUsage('a')
    expect(u.until).toBeUndefined()
    expect(u.weekly).toEqual({ pct: 50 })
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

describe('conexoes (API) no ranking de contas', () => {
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'turno-acc-'))
    vi.resetModules()
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  const acc = (id: string, rank: number, extra: object = {}) => ({ id, agent: 'claude', label: id, rank, enabled: true, home: null, createdAt: '2026-01-01', ...extra })
  const seed = (accounts: unknown[]): void =>
    writeFileSync(join(dir, 'accounts.json'), JSON.stringify({ accounts, thresholds: { fiveHour: 90, weekly: 95 } }))
  const cohere = { id: 'cohere', name: 'Cohere', kind: 'endpoint' as const, baseUrl: 'https://api.cohere.com/compatibility/v1', model: 'command-a', via: 'translate' as const }
  const claudeMax = { id: 'claude-max', name: 'Claude', kind: 'claude' as const }
  const load = async (conns: unknown[]) => {
    const m = await import('../accounts')
    let list = conns
    m.setConnectionSource({ list: () => list as never, env: (c) => ({ ANTHROPIC_BASE_URL: `env-of-${c.id}` }) })
    return { m, setList: (l: unknown[]) => (list = l) }
  }

  it('deveEntrarNoFimDoRankingLigadaQuandoConexaoEndpointExiste', async () => {
    seed([acc('a', 1), acc('b', 2)])
    const { m } = await load([claudeMax, cohere])
    m.syncConnectionAccounts()
    const ids = m.agentsState().accounts.map((a) => a.id)
    expect(ids).toEqual(['a', 'b', 'conn-cohere'])
    expect(m.getAccount('conn-cohere')).toMatchObject({ agent: 'claude', connection: 'cohere', label: 'Cohere', enabled: true, home: null })
  })

  it('naoDeveDuplicarNemPerderRankOuDesligadoAoSincronizarDeNovo', async () => {
    seed([acc('conn-cohere', 1, { connection: 'cohere', label: 'Cohere', enabled: false }), acc('a', 2)])
    const { m } = await load([cohere])
    m.syncConnectionAccounts()
    m.syncConnectionAccounts()
    expect(m.agentsState().accounts.map((a) => [a.id, a.rank, a.enabled])).toEqual([['conn-cohere', 1, false], ['a', 2, true]])
  })

  it('deveSeguirNomeDaConexaoESairDoRankingQuandoConexaoSome', async () => {
    seed([acc('a', 1)])
    const { m, setList } = await load([cohere])
    m.syncConnectionAccounts()
    setList([{ ...cohere, name: 'Cohere trial' }])
    m.syncConnectionAccounts()
    expect(m.getAccount('conn-cohere')?.label).toBe('Cohere trial')
    setList([])
    m.syncConnectionAccounts()
    expect(m.getAccount('conn-cohere')).toBeUndefined()
  })

  it('deveTrocarParaConexaoQuandoAssinaturaDeRankSuperiorBateNoLimite', async () => {
    seed([acc('a', 1)])
    const { m } = await load([cohere])
    m.syncConnectionAccounts()
    expect(m.pickAccount({ agent: 'claude' })?.id).toBe('a')
    m.markAccount('a', 'exhausted', 'usage limit reached', new Date(Date.now() + 3600_000).toISOString())
    expect(m.pickAccount({ agent: 'claude' })?.id).toBe('conn-cohere')
  })

  it('deveApontarOAgenteParaOProvedorNoEnvDaContaDeConexao', async () => {
    seed([])
    const { m } = await load([cohere])
    m.syncConnectionAccounts()
    expect(m.accountEnv(m.getAccount('conn-cohere')!)).toEqual({ ANTHROPIC_BASE_URL: 'env-of-cohere' })
  })

  it('naoDeveEscolherContaDeConexaoQueNaoExisteMais', async () => {
    seed([acc('conn-velha', 1, { connection: 'velha' }), acc('a', 2)])
    const { m } = await load([])
    expect(m.signedIn(m.getAccount('conn-velha')!)).toBe(false)
    expect(m.pickAccount()?.id).toBe('a')
  })

  it('naoDeveImpedirOLoginPadraoDoClaudeQuandoSoHaContaDeConexao', async () => {
    seed([])
    const { m } = await load([cohere])
    m.syncConnectionAccounts()
    // claude "instalado": executavel falso num PATH so dele (o CI nao tem o Claude Code)
    const bin = join(dir, 'bin')
    mkdirSync(bin)
    writeFileSync(join(bin, 'claude'), '#!/bin/sh\n', { mode: 0o755 })
    writeFileSync(join(bin, 'claude.cmd'), '@echo off\r\n')
    const prev = { PATH: process.env.PATH, Path: process.env.Path }
    process.env.PATH = process.env.Path = [bin, prev.PATH ?? prev.Path].filter(Boolean).join(delimiter)
    try {
      await m.detectInstalled()
    } finally {
      process.env.PATH = prev.PATH
      process.env.Path = prev.Path
    }
    expect(m.getAccount('default-claude')).toBeDefined()
  })

  it('naoDeveMexerNoRankingQuandoSettingsNaoPodeSerLido', async () => {
    seed([acc('conn-cohere', 1, { connection: 'cohere', label: 'Cohere', enabled: false })])
    const { m } = await load([])
    m.setConnectionSource({ list: () => undefined, env: () => ({}) })
    m.syncConnectionAccounts()
    expect(m.getAccount('conn-cohere')).toMatchObject({ enabled: false, rank: 1 })
    expect(m.pickAccount()).toBeUndefined()
  })

  it('deveFalharEmVezDeRodarNaAssinaturaQuandoConexaoDaContaSumiu', async () => {
    seed([acc('conn-velha', 1, { connection: 'velha' })])
    const { m } = await load([])
    expect(() => m.accountEnv(m.getAccount('conn-velha')!)).toThrow(/velha/)
  })

  it('deveDesbloquearContaDeConexaoQuandoUsuarioEditaAsConexoes', async () => {
    seed([])
    const { m } = await load([cohere])
    m.syncConnectionAccounts()
    m.markAccount('conn-cohere', 'blocked', 'the provider rejected the API key')
    m.syncConnectionAccounts()
    expect(m.effectiveUsage('conn-cohere').state).toBe('blocked')
    m.syncConnectionAccounts({ edited: true })
    expect(m.effectiveUsage('conn-cohere').state).toBe('unknown')
  })

  it('naoDeveTrocarAssinaturaPertoDoLimitePorConexaoAbaixoDelaNoRanking', async () => {
    seed([acc('a', 1)])
    const { m } = await load([cohere])
    m.syncConnectionAccounts()
    m.recordUsage('a', { fiveHour: { pct: 92, resetsAt: new Date(Date.now() + 3600_000).toISOString() } })
    expect(m.effectiveUsage('a').state).toBe('warning')
    expect(m.pickAccount({ agent: 'claude' })).toBeUndefined() // troca no aviso: fica na assinatura
    expect(m.pickAccount({ agent: 'claude', allowWarning: true })?.id).toBe('a')
    m.markAccount('a', 'exhausted', 'usage limit reached', new Date(Date.now() + 3600_000).toISOString())
    expect(m.pickAccount({ agent: 'claude' })?.id).toBe('conn-cohere') // bateu no limite: agora sim
  })

  it('deveRespeitarConexaoQueOUsuarioPosAcimaDaAssinatura', async () => {
    seed([acc('conn-cohere', 1, { connection: 'cohere', label: 'Cohere' }), acc('a', 2)])
    const { m } = await load([cohere])
    expect(m.pickAccount({ agent: 'claude' })?.id).toBe('conn-cohere')
  })

  it('deveColocarALoginNovaDeAssinaturaAcimaDasConexoes', async () => {
    seed([])
    const { m } = await load([cohere])
    m.syncConnectionAccounts() // instalacao nova: a conexao entra antes de detectar o Claude
    const bin = join(dir, 'bin')
    mkdirSync(bin)
    writeFileSync(join(bin, 'claude'), '#!/bin/sh\n', { mode: 0o755 })
    writeFileSync(join(bin, 'claude.cmd'), '@echo off\r\n')
    const prev = { PATH: process.env.PATH, Path: process.env.Path }
    process.env.PATH = process.env.Path = [bin, prev.PATH ?? prev.Path].filter(Boolean).join(delimiter)
    try {
      await m.detectInstalled()
    } finally {
      process.env.PATH = prev.PATH
      process.env.Path = prev.Path
    }
    expect(m.agentsState().accounts.filter((a) => a.agent === 'claude').map((a) => a.id)).toEqual(['default-claude', 'conn-cohere'])
  })

  it('devePularConexaoLocalQueNaoSobeEUsarAProxima', async () => {
    const ollama = { id: 'ollama', name: 'Ollama', kind: 'endpoint' as const, baseUrl: 'http://localhost:11434', model: 'qwen', bootCommand: 'ollama serve' }
    seed([acc('conn-ollama', 1, { connection: 'ollama', label: 'Ollama' }), acc('conn-cohere', 2, { connection: 'cohere', label: 'Cohere' })])
    const { m } = await load([ollama, cohere])
    const tried: string[] = []
    const pick = await m.pickReadyAccount({ agent: 'claude', allowWarning: true }, async (c) => (tried.push(c.id), c.id !== 'ollama'))
    expect(pick?.id).toBe('conn-cohere')
    expect(tried).toEqual(['ollama']) // so sobe quem tem bootCommand
    expect(m.effectiveUsage('conn-ollama').state).toBe('exhausted')
  })

  it('deveRecusarRemoverContaDeConexaoPeloRanking', async () => {
    seed([])
    const { m } = await load([cohere])
    m.syncConnectionAccounts()
    expect(() => m.removeAccount('conn-cohere')).toThrow(/Connections/)
  })
})

describe('nome da conta padrao (sem "default sign-in")', () => {
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'turno-acc-'))
    vi.resetModules()
  })
  afterEach(() => {
    delete process.env.CLAUDE_CONFIG_DIR
    rmSync(dir, { recursive: true, force: true })
  })
  const acc = (id: string, label: string) => ({ id, agent: 'claude', label, rank: 1, enabled: true, home: null, createdAt: '2026-01-01' })
  const claudeLogin = (email?: string): void => {
    const home = join(dir, 'claude-home')
    mkdirSync(home, { recursive: true })
    process.env.CLAUDE_CONFIG_DIR = home
    writeFileSync(join(home, '.claude.json'), JSON.stringify(email ? { oauthAccount: { emailAddress: email } } : {}))
  }

  it('deveMostrarClaudeEOEmailDaAssinaturaNaContaPadrao', async () => {
    writeFileSync(join(dir, 'accounts.json'), JSON.stringify({ accounts: [acc('default-claude', 'Claude Code · default sign-in')] }))
    claudeLogin('eu@exemplo.com')
    const m = await import('../accounts')
    m.refreshLogin('default-claude')
    expect(m.getAccount('default-claude')).toMatchObject({ label: 'Claude · eu@exemplo.com', email: 'eu@exemplo.com' })
  })

  it('deveMostrarSoClaudeQuandoSemLogin', async () => {
    writeFileSync(join(dir, 'accounts.json'), JSON.stringify({ accounts: [acc('default-claude', 'Claude Code · default sign-in')] }))
    claudeLogin()
    const m = await import('../accounts')
    m.refreshLogin('default-claude')
    expect(m.getAccount('default-claude')?.label).toBe('Claude')
  })

  it('deveAcompanharTrocaDeEmailMasNuncaSobrescreverNomeDadoPeloUsuario', async () => {
    writeFileSync(join(dir, 'accounts.json'), JSON.stringify({ accounts: [{ ...acc('default-claude', 'Claude · velho@exemplo.com'), email: 'velho@exemplo.com' }, { ...acc('meu', 'Trabalho'), id: 'default-codex', agent: 'codex' }] }))
    claudeLogin('novo@exemplo.com')
    const m = await import('../accounts')
    m.refreshLogin('default-claude')
    expect(m.getAccount('default-claude')?.label).toBe('Claude · novo@exemplo.com')
    writeFileSync(join(dir, 'accounts.json'), JSON.stringify({ accounts: [{ ...acc('default-claude', 'Pessoal'), email: 'novo@exemplo.com' }] }))
    vi.resetModules()
    const m2 = await import('../accounts')
    m2.refreshLogin('default-claude')
    expect(m2.getAccount('default-claude')?.label).toBe('Pessoal')
  })
})

describe('settings.json da conta isolada acompanha o do usuario', () => {
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'turno-acc-'))
    vi.resetModules()
    process.env.CLAUDE_CONFIG_DIR = join(dir, 'user-claude')
    mkdirSync(process.env.CLAUDE_CONFIG_DIR)
    mkdirSync(join(dir, 'acc-home'))
  })
  afterEach(() => {
    delete process.env.CLAUDE_CONFIG_DIR
    rmSync(dir, { recursive: true, force: true })
  })
  const write = (p: string, obj: object, mtimeSec: number): void => {
    writeFileSync(p, JSON.stringify(obj))
    utimesSync(p, mtimeSec, mtimeSec)
  }

  it('deveLevarOFullscreenDoUsuarioParaAContaCriadaAntesDaMudanca', async () => {
    write(join(dir, 'acc-home', 'settings.json'), { theme: 'dark' }, 1_000)
    write(join(process.env.CLAUDE_CONFIG_DIR!, 'settings.json'), { theme: 'dark', tui: 'fullscreen' }, 2_000)
    const m = await import('../accounts')
    m.syncClaudeSettings(join(dir, 'acc-home'))
    expect(JSON.parse(readFileSync(join(dir, 'acc-home', 'settings.json'), 'utf8')).tui).toBe('fullscreen')
  })

  it('naoDeveSobrescreverQuandoACopiaDaContaEMaisNova', async () => {
    write(join(process.env.CLAUDE_CONFIG_DIR!, 'settings.json'), { tui: 'fullscreen' }, 1_000)
    write(join(dir, 'acc-home', 'settings.json'), { tui: 'default' }, 2_000)
    const m = await import('../accounts')
    m.syncClaudeSettings(join(dir, 'acc-home'))
    expect(JSON.parse(readFileSync(join(dir, 'acc-home', 'settings.json'), 'utf8')).tui).toBe('default')
  })
})

describe('refreshLogin sem efeito colateral', () => {
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'turno-acc-'))
    vi.resetModules()
    process.env.CLAUDE_CONFIG_DIR = join(dir, 'user-claude')
    mkdirSync(process.env.CLAUDE_CONFIG_DIR)
    writeFileSync(join(process.env.CLAUDE_CONFIG_DIR, '.claude.json'), JSON.stringify({ oauthAccount: { emailAddress: 'eu@exemplo.com' } }))
  })
  afterEach(() => {
    delete process.env.CLAUDE_CONFIG_DIR
    rmSync(dir, { recursive: true, force: true })
  })

  it('naoDeveCarimbarEmailDaAssinaturaNaContaDeConexao', async () => {
    writeFileSync(join(dir, 'accounts.json'), JSON.stringify({ accounts: [{ id: 'conn-cohere', agent: 'claude', connection: 'cohere', label: 'Cohere', rank: 1, enabled: true, home: null, createdAt: 'x' }] }))
    const m = await import('../accounts')
    m.setConnectionSource({ list: () => [{ id: 'cohere', name: 'Cohere', kind: 'endpoint' }], env: () => ({}) })
    expect(m.refreshLogin('conn-cohere')).toBe(true)
    expect(m.getAccount('conn-cohere')?.label).toBe('Cohere')
    expect(m.getAccount('conn-cohere')?.email).toBeUndefined()
  })

})
