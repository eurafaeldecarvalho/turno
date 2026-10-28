import { app } from 'electron'
import { execFile } from 'node:child_process'
import { copyFileSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { AccountUsage, AgentAccount, AgentsState, Connection, RankStrategy, UsageWindow } from '../shared/types'
import { AGENTS, agentDef } from '../shared/agents'
import { sortAccountsBestToWorst } from '../shared/accountRank'
import { planBackends, type Backend } from '../shared/routing'
import { readJson, writeJsonAtomic } from './jsonStore'
import { childEnv, loginShellPath, mergePath, withUserBin } from './env'

// Registro de contas de agentes (botao Agent). Uma conta = um agente CLI + uma pasta de config isolada
// (CLAUDE_CONFIG_DIR, CODEX_HOME...). O login e feito pelo proprio CLI, num terminal visivel: o Turno nunca le,
// copia ou guarda token de assinatura. home null = a pasta padrao do usuario ("login padrao").
const file = (): string => join(app.getPath('userData'), 'accounts.json')
const usageFile = (): string => join(app.getPath('userData'), 'usage.json')
export const profilesDir = (): string => join(app.getPath('userData'), 'profiles')

interface Store {
  accounts: AgentAccount[]
  thresholds: { fiveHour: number; weekly: number; strategy?: RankStrategy }
}
const DEFAULT_THRESHOLDS = { fiveHour: 90, weekly: 95 }

let store: Store | undefined
let blocked = false
let usage: Record<string, AccountUsage> = {}
let installed: Set<string> | undefined
let onChange: (s: AgentsState) => void = () => {}

// usage.json e cache: valor estragado (data invalida, estado desconhecido) e descartado em vez de quebrar a tela
const STATES = ['ok', 'warning', 'exhausted', 'blocked', 'unknown']
const okDate = (v: unknown): v is string => typeof v === 'string' && !Number.isNaN(Date.parse(v))
function sanitizeUsage(raw: Record<string, unknown>): Record<string, AccountUsage> {
  const out: Record<string, AccountUsage> = {}
  for (const [id, v] of Object.entries(raw)) {
    if (!v || typeof v !== 'object') continue
    const u = { ...(v as AccountUsage) }
    if (!STATES.includes(u.state)) u.state = 'unknown'
    if (u.until !== undefined && !okDate(u.until)) delete u.until
    for (const k of ['fiveHour', 'weekly'] as const) {
      const w = u[k]
      if (w && (typeof w !== 'object' || typeof w.pct !== 'number' || !Number.isFinite(w.pct))) delete u[k]
      else if (w) {
        const pct = Math.min(100, Math.max(0, w.pct))
        u[k] = w.resetsAt !== undefined && !okDate(w.resetsAt) ? { pct } : { ...w, pct }
      }
    }
    out[id] = u
  }
  return out
}

function load(): Store {
  if (store) return store
  const r = readJson<Partial<Store>>(file())
  blocked = !r.ok
  const d = (r.ok && r.data) || {}
  const accounts = Array.isArray(d.accounts) ? d.accounts.filter((a) => a && typeof a.id === 'string' && typeof a.agent === 'string') : []
  store = { accounts, thresholds: { ...DEFAULT_THRESHOLDS, ...(d.thresholds ?? {}) } }
  const u = readJson<Record<string, AccountUsage>>(usageFile())
  usage = sanitizeUsage((u.ok && u.data) || {})
  return store
}

function save(): void {
  if (blocked) throw new Error("accounts.json couldn't be read when Turno started; account changes aren't saved until it can be read")
  writeJsonAtomic(file(), store)
  emit()
}

let usageTimer: ReturnType<typeof setTimeout> | undefined
function saveUsageSoon(): void {
  clearTimeout(usageTimer)
  usageTimer = setTimeout(() => {
    try {
      writeJsonAtomic(usageFile(), usage)
    } catch {
      /* uso e so cache: tenta de novo na proxima mudanca */
    }
  }, 2000)
}

export function initAccounts(cb: (s: AgentsState) => void): void {
  onChange = cb
  load()
  scheduleExpiry()
  void detectInstalled()
}

export function agentsState(): AgentsState {
  const s = load()
  return {
    accounts: [...s.accounts].sort((a, b) => a.rank - b.rank),
    usage: Object.fromEntries(s.accounts.map((a) => [a.id, effectiveUsage(a.id)])),
    thresholds: s.thresholds,
    installed: installed ? [...installed] : [],
    signedOut: s.accounts.filter((a) => !signedIn(a)).map((a) => a.id),
    best: pickAccount({ allowWarning: true })?.id,
  }
}

// Conta isolada sem login encontrado na pasta (acabou de ser criada, login cancelado): fora do ranking ate entrar.
// Login padrao do usuario (home null) e agentes cujo login o Turno nao sabe ler contam como logados.
export function signedIn(a: AgentAccount): boolean {
  // conexao de API: "logada" enquanto a conexao existir em Settings › Accounts
  if (a.connection) return !!connSource?.list()?.some((c) => c.id === a.connection)
  if (!a.home) return true
  try {
    if (a.agent === 'claude') {
      if (existsSync(join(a.home, '.credentials.json'))) return true
      return !!JSON.parse(readFileSync(join(a.home, '.claude.json'), 'utf8'))?.oauthAccount
    }
    if (a.agent === 'codex') return existsSync(join(a.home, 'auth.json'))
    return existsSync(a.home) && readdirSync(a.home).length > 0
  } catch {
    return false
  }
}
const emit = (): void => {
  onChange(agentsState())
  scheduleExpiry()
}
// O estado "no limite" vence sozinho (effectiveUsage olha o relogio), mas ninguem avisava a tela: um timer no proximo
// vencimento (limite ou reset de janela) manda o estado de novo, e botao/barra/Chat voltam sem precisar de clique.
let expiryTimer: ReturnType<typeof setTimeout> | undefined
function scheduleExpiry(): void {
  clearTimeout(expiryTimer)
  const times = Object.values(usage).flatMap((u) => [u?.until, u?.fiveHour?.resetsAt, u?.weekly?.resetsAt])
  const next = times.filter((t): t is string => !!t).map((t) => Date.parse(t) + 61_000).filter((t) => t > Date.now()).sort((a, b) => a - b)[0]
  if (next) expiryTimer = setTimeout(emit, Math.min(next - Date.now(), 2 ** 31 - 1))
}

// ---------- deteccao (um `where` so para o catalogo inteiro) ----------
// PATH ATUAL do sistema (do registro, no Windows), nao o que foi capturado quando o Turno abriu: assim um
// CLI instalado DEPOIS de abrir o Turno aparece ao reverificar, sem precisar reiniciar o app.
function currentPath(): Promise<string> {
  // Linux/macOS: o app aberto pela bandeja herda um PATH minimo; junta o PATH real do login shell
  // (nvm/volta/fnm/bun/pnpm...) senao CLIs instalados por gerenciador de versao ficam "not installed".
  if (process.platform !== 'win32')
    return loginShellPath().then((lp) => mergePath(process.env.PATH ?? '', lp, homedir(), process.platform))
  const base = withUserBin(process.env.Path ?? process.env.PATH ?? '', homedir(), process.platform)
  const expand = (s: string): string => s.replace(/%([^%]+)%/g, (m, n) => process.env[n] ?? process.env[String(n).toUpperCase()] ?? m)
  const read = (key: string): Promise<string> =>
    new Promise((res) =>
      execFile('reg', ['query', key, '/v', 'Path'], { windowsHide: true, timeout: 8000 }, (_e, out) => {
        const m = /\bPath\b\s+REG(?:_EXPAND)?_SZ\s+(.+)/i.exec(String(out ?? ''))
        res(m ? expand(m[1].trim()) : '')
      }),
    )
  return Promise.all([read('HKCU\\Environment'), read('HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment')]).then(([u, machine]) =>
    [base, machine, u].filter(Boolean).join(';'),
  )
}

export async function detectInstalled(): Promise<string[]> {
  const names = AGENTS.flatMap((a) => [a.cmd, ...(a.aliases ?? [])])
  const path = await currentPath()
  const env = childEnv()
  for (const k of Object.keys(env)) if (k.toLowerCase() === 'path') delete env[k]
  env[process.platform === 'win32' ? 'Path' : 'PATH'] = path
  return new Promise((res) =>
    execFile(process.platform === 'win32' ? 'where' : 'which', names, { env, timeout: 15000, windowsHide: true }, (_err, out) => {
      const found = new Set(String(out ?? '').split(/\r?\n/).filter(Boolean).map((p) => basename(p.trim()).replace(/\.(exe|cmd|bat|ps1)$/i, '').toLowerCase()))
      installed = new Set(AGENTS.filter((a) => [a.cmd, ...(a.aliases ?? [])].some((c) => found.has(c.toLowerCase()))).map((a) => a.id))
      ensureDefaults()
      emit()
      res([...installed])
    }),
  )
}

// Arruma nomes antigos. Nenhuma conta entra sozinha: o usuario adiciona cada uma (login deste PC, conta separada ou
// conexao de API) em Settings › Accounts.
function ensureDefaults(): void {
  const s = load()
  if (!installed || blocked) return
  let changed = false
  for (const a of s.accounts) {
    // nome antigo "<Agente> · default sign-in/login": vira so o nome do agente (o Claude ganha o e-mail abaixo)
    const def = agentDef(a.agent)
    if (def && !a.home && !a.connection && a.agent !== 'claude' && /· default (sign-in|login)$/.test(a.label) && a.label.startsWith(def.name)) {
      a.label = def.name
      changed = true
    }
  }
  if (changed) save()
  const claude = s.accounts.find((a) => a.id === 'default-claude')
  if (claude) refreshLogin(claude.id) // nome com o e-mail da assinatura
}
const nextRank = (): number => Math.max(0, ...load().accounts.map((a) => a.rank)) + 1
// Assinatura nova entra logo depois da ultima assinatura (acima das conexoes de API, que sao pagas por uso): as que
// estavam dali para baixo descem uma posicao. Sem conexoes no caminho, e o mesmo que nextRank.
function subscriptionRank(): number {
  const s = load()
  const rank = Math.max(0, ...s.accounts.filter((a) => !a.connection).map((a) => a.rank)) + 1
  for (const a of s.accounts) if (a.rank >= rank) a.rank++
  return rank
}

// ---------- contas ----------
export const getAccount = (id: string): AgentAccount | undefined => load().accounts.find((a) => a.id === id)

export function addAccount(agent: string, label?: string): { account: AgentAccount; login: string; env: Record<string, string> } {
  const def = agentDef(agent)
  if (!def) throw new Error(`unknown agent "${agent}"`)
  if (!def.homeVar) throw new Error(`${def.name} keeps one login per computer; Turno can't isolate a second account for it`)
  const s = load()
  const id = `${agent}-${randomUUID().slice(0, 8)}`
  const home = join(profilesDir(), id, 'home')
  provision(def.id, home)
  const n = s.accounts.filter((a) => a.agent === agent).length + 1
  const account: AgentAccount = { id, agent, label: label?.trim() || `${def.name} · account ${n}`, rank: subscriptionRank(), enabled: true, home, createdAt: new Date().toISOString() }
  s.accounts.push(account)
  save()
  return { account, login: def.login ?? def.launch ?? def.cmd, env: accountEnv(account) }
}

// Login que ja existe neste PC (a pasta normal do agente, ex. ~/.claude): adicionado pelo usuario, nunca sozinho.
export function addDefaultAccount(agent: string): AgentAccount {
  const def = agentDef(agent)
  if (!def) throw new Error(`unknown agent "${agent}"`)
  const s = load()
  const id = `default-${agent}`
  if (s.accounts.some((a) => a.id === id)) throw new Error(`${def.name} with this PC's sign-in is already in the list`)
  const account: AgentAccount = { id, agent, label: agent === 'claude' ? 'Claude' : def.name, rank: subscriptionRank(), enabled: true, home: null, createdAt: new Date().toISOString() }
  s.accounts.push(account)
  save()
  if (agent === 'claude') refreshLogin(id) // "Claude · <e-mail da assinatura>"
  return account
}

export function updateAccount(id: string, patch: Partial<Pick<AgentAccount, 'label' | 'enabled'>>): void {
  const a = getAccount(id)
  if (!a) return
  if (patch.label !== undefined && patch.label.trim()) {
    const label = patch.label.trim()
    // nomes repetidos deixariam o menu do Agent com duas linhas iguais
    if (load().accounts.some((x) => x.id !== id && x.label.trim().toLowerCase() === label.toLowerCase())) throw new Error(`Another account is already named "${label}". Pick a different name.`)
    a.label = label
  }
  if (patch.enabled !== undefined) a.enabled = patch.enabled
  save()
}

// Nova ordem (ids do 1o ao ultimo); quem nao veio fica no fim, na ordem atual.
export function reorderAccounts(ids: string[]): void {
  const s = load()
  const rest = s.accounts.filter((a) => !ids.includes(a.id)).sort((a, b) => a.rank - b.rank)
  const ordered = [...ids.map((i) => s.accounts.find((a) => a.id === i)).filter((a): a is AgentAccount => !!a), ...rest]
  ordered.forEach((a, i) => (a.rank = i + 1))
  save()
}

export function setThresholds(t: Partial<Store['thresholds']>): void {
  const s = load()
  const clamp = (v: unknown, d: number): number => (typeof v === 'number' && v >= 50 && v <= 100 ? Math.round(v) : d)
  const strategy = (['rank', 'headroom', 'reset-soonest'] as const).find((x) => x === (t.strategy ?? s.thresholds.strategy)) ?? 'rank'
  s.thresholds = { fiveHour: clamp(t.fiveHour, s.thresholds.fiveHour), weekly: clamp(t.weekly, s.thresholds.weekly), strategy }
  save()
}

export function removeAccount(id: string): void {
  const s = load()
  const a = s.accounts.find((x) => x.id === id)
  if (!a) return
  if (a.home) removeHome(a.home)
  s.accounts = s.accounts.filter((x) => x.id !== id)
  delete usage[id]
  save()
}

// Le o e-mail/rotulo depois do login (Claude: .claude.json da pasta; Codex: auth.json). Sem login = null.
export function refreshLogin(id: string): boolean {
  const a = getAccount(id)
  if (!a) return false
  if (a.connection) return signedIn(a) // conexao de API: sem login de CLI (nada de e-mail de assinatura nela)
  if (!a.home) {
    // login padrao do usuario: confere os arquivos de login de verdade (antes respondia sempre "logado")
    if (a.agent === 'claude') {
      let email: string | undefined
      let oauth = false
      try {
        const o = JSON.parse(readFileSync(claudeDefaultJson(), 'utf8'))?.oauthAccount
        oauth = !!o
        email = typeof o?.emailAddress === 'string' ? o.emailAddress : undefined
      } catch {
        /* sem .claude.json: sem login de assinatura */
      }
      nameDefaultClaude(a, email)
      return oauth || !!process.env.ANTHROPIC_API_KEY || existsSync(join(claudeDefaultHome(), '.credentials.json'))
    }
    if (a.agent === 'codex') return existsSync(join(process.env.CODEX_HOME || join(homedir(), '.codex'), 'auth.json'))
    return true
  }
  if (a.agent === 'claude') {
    try {
      const j = JSON.parse(readFileSync(join(a.home, '.claude.json'), 'utf8'))
      const email = j?.oauthAccount?.emailAddress
      if (email && email !== a.email) {
        a.email = email
        if (/· account \d+$/.test(a.label)) a.label = `Claude · ${email}`
        save()
      }
      return !!email || existsSync(join(a.home, '.credentials.json'))
    } catch {
      return false
    }
  }
  if (a.agent === 'codex') return existsSync(join(a.home, 'auth.json'))
  return existsSync(a.home) && readdirSync(a.home).length > 0
}

// Login padrao do Claude: "Claude · <email da assinatura>" (ou so "Claude" sem login), acompanhando troca de e-mail.
// Nome que o usuario deu fica como esta: so mexe em nome automatico (antigo "default sign-in" ou o do e-mail anterior).
function nameDefaultClaude(a: AgentAccount, email: string | undefined): void {
  const auto = /· default (sign-in|login)$/.test(a.label) || a.label === 'Claude' || (!!a.email && a.label === `Claude · ${a.email}`)
  const label = auto ? (email ? `Claude · ${email}` : 'Claude') : a.label
  if (label === a.label && email === a.email) return
  a.label = label
  a.email = email
  save()
}

// Env que coloca o agente na pasta da conta. Conta Claude isolada: limpa credenciais de API herdadas, que venceriam
// o login da pasta (todas as "contas" usariam a mesma credencial sem aviso).
export function accountEnv(a: AgentAccount): Record<string, string> {
  if (a.connection) {
    // env vazio rodaria o Claude Code na assinatura do usuario com o nome da conexao: falha em vez disso
    const conn = connSource?.list()?.find((c) => c.id === a.connection)
    if (!conn || !connSource) throw new Error(`connection "${a.connection}" isn't available; check Settings › Accounts`)
    return connSource.env(conn)
  }
  const def = agentDef(a.agent)
  if (!def?.homeVar || !a.home) return {}
  const env: Record<string, string> = { [def.homeVar]: a.home }
  if (a.agent === 'claude') Object.assign(env, { ANTHROPIC_API_KEY: '', ANTHROPIC_AUTH_TOKEN: '', ANTHROPIC_BASE_URL: '' })
  if (def.homeVar === 'XDG_DATA_HOME') env.XDG_STATE_HOME = join(a.home, 'state')
  return env
}

// ---------- uso e escolha ----------
export function effectiveUsage(id: string): AccountUsage {
  const u = usage[id] ?? { state: 'unknown' }
  const now = Date.now()
  // esgotado ate um horario: volta a valer depois (com 1 min de folga)
  if ((u.state === 'exhausted' || u.state === 'warning') && u.until && Date.parse(u.until) + 60_000 < now) return { state: 'unknown' }
  const t = load().thresholds
  const over = (w: UsageWindow | undefined, lim: number): boolean => !!w && w.pct >= lim && (!w.resetsAt || Date.parse(w.resetsAt) > now)
  if (u.state === 'ok' || u.state === 'unknown') {
    if (over(u.fiveHour, t.fiveHour) || over(u.weekly, t.weekly)) return { ...u, state: 'warning', until: soonestReset(u) }
  }
  return u
}
const soonestReset = (u: AccountUsage): string | undefined =>
  [u.fiveHour?.resetsAt, u.weekly?.resetsAt].filter((x): x is string => !!x).sort()[0]

export function recordUsage(id: string, windows: { fiveHour?: UsageWindow; weekly?: UsageWindow }): AccountUsage {
  const prev = usage[id]
  // uso novo prova que o login voltou (ex.: /login na aba); conta suspensa continua bloqueada ate o usuario conferir
  const keepBlock = prev?.state === 'blocked' && !/^login expired/.test(prev.reason ?? '')
  const next: AccountUsage = { ...prev, ...windows, state: keepBlock ? 'blocked' : 'ok', observedAt: new Date().toISOString() }
  if (next.state !== 'blocked') delete next.reason
  delete next.until
  usage[id] = next
  saveUsageSoon()
  emit()
  return effectiveUsage(id)
}

// Bateu no limite (parede) ou foi bloqueada (login expirado, conta suspensa).
export function markAccount(id: string, state: 'exhausted' | 'blocked', reason: string, until?: string): void {
  usage[id] = { ...usage[id], state, reason, until: until ?? (state === 'exhausted' ? new Date(Date.now() + 60 * 60_000).toISOString() : undefined), observedAt: new Date().toISOString() }
  saveUsageSoon()
  emit()
}

// "Use it now" no Settings: a pessoa sabe que a conta voltou (o limite visto na tela era engano, ou resetou antes)
export function clearLimit(id: string): void {
  if (usage[id]?.state !== 'exhausted') return
  usage[id] = { ...usage[id], state: 'unknown', reason: undefined, until: undefined }
  saveUsageSoon()
  emit()
}

export function clearBlock(id: string): void {
  if (usage[id]?.state !== 'blocked') return
  usage[id] = { ...usage[id], state: 'unknown', reason: undefined }
  saveUsageSoon()
  emit()
}

// Melhor conta disponivel: menor rank, habilitada, agente instalado, fora das excluidas e com folga.
// sameAgentAs: so contas desse agente (abrir "Claude" explicitamente). Sem folga em nenhuma = undefined.
// allowWarning: sem nenhuma com folga, aceita a melhor ja no limiar (ainda tem cota; abrir/continuar e melhor que recusar).
export function pickAccount(opts: { exclude?: string[]; agent?: string; excludeAgent?: string; allowWarning?: boolean } = {}): AgentAccount | undefined {
  const s = load()
  const usable = (a: AgentAccount): boolean => {
    if (!a.enabled || opts.exclude?.includes(a.id)) return false
    if (opts.agent && a.agent !== opts.agent) return false
    if (opts.excludeAgent && a.agent === opts.excludeAgent) return false
    if (installed && !installed.has(a.agent)) return false
    return signedIn(a)
  }
  const sorted = [...s.accounts].sort(byStrategy(s.thresholds.strategy ?? 'rank'))
  const ranked = sorted.filter(usable)
  const st = (a: AgentAccount): string => effectiveUsage(a.id).state
  // conexao de API (paga por uso) so assume quando as assinaturas ACIMA dela batem no limite: uma assinatura so perto do
  // limite (aviso) ainda tem cota e segura as conexoes abaixo dela. Vale tambem para a conta excluida (a atual, na troca
  // no aviso): sair dela para uma API paga enquanto ela ainda tem cota seria gastar sem precisar.
  const holds = (a: AgentAccount): boolean => !a.connection && a.enabled && signedIn(a) && (!opts.agent || a.agent === opts.agent) && st(a) === 'warning'
  let warnedAbove = false
  for (const a of sorted) {
    if (usable(a)) {
      const state = st(a)
      if ((state === 'ok' || state === 'unknown') && !(a.connection && warnedAbove)) return a
    }
    if (holds(a)) warnedAbove = true
  }
  return opts.allowWarning ? ranked.find((a) => st(a) === 'warning') : undefined
}

// Backends do proxy de roteamento (/route): contas Claude usaveis, ordenadas melhor->pior, viradas em backends. Exclui
// o proprio Turno Router (via='route') para nao rotear para si mesmo. O index.ts injeta isto via setRouter.
export function routableBackends(): Backend[] {
  const accts = load().accounts.filter((a) => a.agent === 'claude')
  const usage = Object.fromEntries(accts.map((a) => [a.id, effectiveUsage(a.id)]))
  const signedOut = accts.filter((a) => !signedIn(a)).map((a) => a.id)
  const ordered = sortAccountsBestToWorst(accts, { usage, installed: installed ? [...installed] : [], signedOut })
  const usable = (a: AgentAccount): boolean =>
    a.enabled && (!installed || installed.has(a.agent)) && signedIn(a) && !['exhausted', 'blocked'].includes(effectiveUsage(a.id).state)
  const orderedUsable = ordered.map((id) => accts.find((a) => a.id === id)!).filter(usable)
  const connById = (id: string): Connection | undefined => {
    const c = connSource?.list()?.find((x) => x.id === id)
    return c && c.via !== 'route' ? c : undefined // anti-recursao: nunca rotear para o proprio router
  }
  return planBackends(orderedUsable, connById)
}

// Ordem das contas conforme a estrategia: empate sempre cai na ordem da lista.
// headroom = a que tem mais cota sobrando (maior uso entre 5h e 7d menor primeiro); reset-soonest = a que reseta
// antes (a cota dela se perde de qualquer jeito); conta sem dado de uso vai depois das que tem dado.
function byStrategy(strategy: RankStrategy): (a: AgentAccount, b: AgentAccount) => number {
  if (strategy === 'rank') return (a, b) => a.rank - b.rank
  const used = (a: AgentAccount): number => {
    const u = effectiveUsage(a.id)
    // janela que ja resetou conta como 0% (o dado fica velho enquanto a conta nao e usada)
    const pct = (w?: UsageWindow): number => (!w ? -1 : w.resetsAt && Date.parse(w.resetsAt) <= Date.now() ? 0 : w.pct)
    return Math.max(pct(u.fiveHour), pct(u.weekly))
  }
  const reset = (a: AgentAccount): number => {
    const u = effectiveUsage(a.id)
    const t = [u.weekly?.resetsAt, u.fiveHour?.resetsAt].filter((x): x is string => !!x).map(Date.parse).filter((x) => x > Date.now())
    return t.length ? Math.min(...t) : Infinity
  }
  return (a, b) => {
    if (strategy === 'headroom') {
      const ua = used(a)
      const ub = used(b)
      if (ua < 0 !== ub < 0) return ua < 0 ? 1 : -1
      if (ua !== ub) return ua - ub
    } else {
      const ra = reset(a)
      const rb = reset(b)
      if (ra !== rb) return ra - rb
    }
    return a.rank - b.rank
  }
}

// Proxima volta de alguma conta (para "todas no limite; volta as 14:00")
// so contas que o ranking usaria (ligadas, logadas) e que estao esgotadas: a de aviso ainda esta disponivel
export function nextAvailableAt(): string | undefined {
  return load()
    .accounts.filter((a) => a.enabled && signedIn(a))
    .map((a) => effectiveUsage(a.id))
    .filter((u) => u.state === 'exhausted' && u.until)
    .map((u) => u.until!)
    .sort()[0]
}

// "14:05" hoje; "Sun 14:05" em outro dia (limite semanal fica a dias) — ingles e 24h, como o resto do app
export function whenText(iso: string): string {
  const d = new Date(iso)
  const time = d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
  return d.toDateString() === new Date().toDateString() ? time : `${d.toLocaleDateString('en-US', { weekday: 'short' })} ${time}`
}

// ---------- pastas das contas ----------
const claudeDefaultHome = (): string => process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude')
// .claude.json fica no home do usuario quando CLAUDE_CONFIG_DIR nao esta definido
const claudeDefaultJson = (): string => (process.env.CLAUDE_CONFIG_DIR ? join(process.env.CLAUDE_CONFIG_DIR, '.claude.json') : join(homedir(), '.claude.json'))
// Historico compartilhado entre contas: `--resume <id>` acha a conversa em qualquer conta.
// `sessions` NAO: e o registro de processos vivos, preso a cada pasta.
const SHARED_DIRS = ['projects', 'todos', 'file-history', 'shell-snapshots', 'session-env', 'plans', 'tasks', 'transcripts', 'paste-cache', 'commands', 'agents', 'skills', 'plugins', 'output-styles']

function provision(agent: string, home: string): void {
  mkdirSync(home, { recursive: true })
  if (agent === 'claude') provisionClaude(home)
  else if (agent === 'codex') {
    const src = join(process.env.CODEX_HOME || join(homedir(), '.codex'), 'config.toml')
    if (existsSync(src)) copyFileSync(src, join(home, 'config.toml'))
  }
}

export function provisionClaude(home: string): void {
  const src = claudeDefaultHome()
  for (const d of SHARED_DIRS) {
    const target = join(src, d)
    const link = join(home, d)
    if (existsSync(link)) continue
    if (['projects', 'todos', 'file-history', 'plans', 'tasks', 'transcripts'].includes(d)) mkdirSync(target, { recursive: true })
    if (!existsSync(target)) continue
    try {
      symlinkSync(target, link, 'junction')
    } catch {
      /* sem junction (FS sem suporte): a conta fica com historico proprio */
    }
  }
  syncClaudeSettings(home)
  if (existsSync(join(src, 'CLAUDE.md')) && !existsSync(join(home, 'CLAUDE.md'))) writeFileSync(join(home, 'CLAUDE.md'), `@${join(src, 'CLAUDE.md').replace(/\\/g, '/')}\n`)
  // .claude.json: pastas confiaveis, onboarding concluido e MCPs do usuario, SEM o login (oauthAccount)
  try {
    const j = JSON.parse(readFileSync(claudeDefaultJson(), 'utf8'))
    const target = join(home, '.claude.json')
    const cur = existsSync(target) ? JSON.parse(readFileSync(target, 'utf8')) : {}
    const merged = { ...j, ...cur, projects: { ...(j.projects ?? {}), ...(cur.projects ?? {}) }, hasCompletedOnboarding: true }
    if (!cur.oauthAccount) delete merged.oauthAccount
    for (const k of ['userID', 'cachedGrowthBookFeatures', 'cachedStatsigGates', 's1mAccessCache', 'claudeCodeFirstTokenDate']) delete merged[k]
    writeFileSync(target, JSON.stringify(merged, null, 2))
  } catch {
    writeFileSync(join(home, '.claude.json'), JSON.stringify({ hasCompletedOnboarding: true }, null, 2))
  }
}

// settings.json do usuario -> conta isolada sempre que o do usuario for mais novo: preferencia mudada depois de criar a
// conta (ex.: "tui": "fullscreen", que liga o clique do mouse nos menus) passa a valer nela tambem.
// Copia da conta mais nova (mudada de dentro dela) fica como esta.
export function syncClaudeSettings(home: string): void {
  const src = join(claudeDefaultHome(), 'settings.json')
  const dst = join(home, 'settings.json')
  try {
    if (!existsSync(src)) return
    if (existsSync(dst) && statSync(dst).mtimeMs >= statSync(src).mtimeMs) return
    copyFileSync(src, dst)
  } catch {
    /* arquivo ocupado: tenta na proxima abertura */
  }
}

// Remove a pasta da conta SEM apagar o historico real: desfaz as junctions antes do delete recursivo.
function removeHome(home: string): void {
  if (!existsSync(home)) return
  if (!home.startsWith(profilesDir())) throw new Error('refusing to delete a folder outside Turno profiles')
  for (const name of readdirSync(home)) {
    const p = join(home, name)
    try {
      if (lstatSync(p).isSymbolicLink()) unlinkSync(p)
    } catch {
      /* segue */
    }
  }
  // confere de novo: se sobrou alguma junction (unlink falhou), nao apaga nada
  if (readdirSync(home).some((n) => SHARED_DIRS.includes(n) && lstatSync(join(home, n)).isSymbolicLink())) throw new Error('could not unlink shared history folders; profile kept')
  rmSync(join(home, '..'), { recursive: true, force: true })
}


// ---------- conexoes de API no ranking ----------
// Cada conexao endpoint (Cohere, OpenRouter, Ollama...) vira uma conta do Claude Code no ranking: o mesmo CLI, apontado
// para o provedor pelo env. So entra quando o usuario adiciona (addConnectionAccount); reordena/liga/desliga/remove como
// as assinaturas. Conexao apagada em Connections sai do ranking.
// A fonte vem de fora (settings + cofre) para este modulo nao depender do safeStorage do Electron.
interface ConnectionSource {
  list: () => Connection[] | undefined // undefined = settings.json nao pode ser lido agora (nada muda no ranking)
  env: (c: Connection) => Record<string, string>
}
let connSource: ConnectionSource | undefined
export function setConnectionSource(src: ConnectionSource): void {
  connSource = src
}
export const connectionAccountId = (connId: string): string => `conn-${connId}`

// edited: o usuario mexeu nas conexoes (ex.: trocou a chave): conta bloqueada por chave recusada volta a valer
// Conexao de API no ranking: so quando o usuario adiciona (entra no fim, ligada).
export function addConnectionAccount(connId: string): AgentAccount {
  const s = load()
  const c = connSource?.list()?.find((x) => x.id === connId && x.kind === 'endpoint')
  if (!c) throw new Error(`connection "${connId}" isn't available; add it in Settings › Accounts first`)
  if (s.accounts.some((a) => a.connection === connId)) throw new Error(`${c.name} is already in the list`)
  delete usage[connectionAccountId(connId)] // limite/bloqueio de quando estava na lista antes nao volta junto
  saveUsageSoon()
  const account: AgentAccount = { id: connectionAccountId(connId), agent: 'claude', connection: connId, label: c.name, rank: nextRank(), enabled: true, home: null, createdAt: new Date().toISOString() }
  s.accounts.push(account)
  save()
  return account
}

export function syncConnectionAccounts(opts: { edited?: boolean } = {}): void {
  const s = load()
  const list = connSource?.list()
  if (!list || blocked) return
  const conns = list.filter((c) => c.kind === 'endpoint')
  let changed = false
  const before = s.accounts.length
  for (const a of s.accounts) if (a.connection && !conns.some((c) => c.id === a.connection)) delete usage[a.id] // limite/bloqueio antigo nao volta junto
  s.accounts = s.accounts.filter((a) => !a.connection || conns.some((c) => c.id === a.connection))
  if (s.accounts.length !== before) (changed = true), saveUsageSoon()
  for (const c of conns) {
    const cur = s.accounts.find((a) => a.connection === c.id)
    if (cur && cur.label !== c.name) (cur.label = c.name), (changed = true)
  }
  if (opts.edited)
    for (const a of s.accounts)
      if (a.connection && usage[a.id]?.state === 'blocked') {
        usage[a.id] = { ...usage[a.id], state: 'unknown', reason: undefined }
        saveUsageSoon()
        changed = true
      }
  if (changed) save()
}

// Melhor conta que da para usar AGORA: conexao local (ex. Ollama, com bootCommand) e ligada antes; se nao subir, sai do
// ranking por 20 min e vale a proxima. Sem isso a run caia num servidor parado e falhava em vez de seguir no ranking.
export async function pickReadyAccount(opts: Parameters<typeof pickAccount>[0], ensure: (c: Connection) => Promise<boolean>): Promise<AgentAccount | undefined> {
  for (;;) {
    const a = pickAccount(opts)
    const conn = a?.connection ? connSource?.list()?.find((c) => c.id === a.connection) : undefined
    if (!a || !conn?.bootCommand || (await ensure(conn))) return a
    markAccount(a.id, 'exhausted', `${conn.name} is not running (tried to start it)`, new Date(Date.now() + 20 * 60_000).toISOString())
  }
}
// Por que nao ha conta para rodar: lista vazia (nada entra sozinho) pede para adicionar; senao estao desligadas/no limite
export const noClaudeAccountText = (): string =>
  load().accounts.some((a) => a.agent === 'claude')
    ? 'no Claude account is available (every one is off, not signed in or at its usage limit)'
    : 'No Claude account yet: add one in Settings › Accounts'
