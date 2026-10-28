import { execFile } from 'node:child_process'
import { homedir } from 'node:os'

// Env limpo para processos filhos: remove variaveis que marcam "dentro de outra sessao Claude Code".
export function childEnv(extra: Record<string, string> = {}): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [k, v] of Object.entries(process.env)) {
    if (v === undefined) continue
    if (k === 'CLAUDECODE' || k.startsWith('CLAUDE_CODE_') || k === 'ELECTRON_RUN_AS_NODE') continue
    env[k] = v
  }
  if (process.platform === 'win32') env.SystemRoot ??= 'C:\\Windows'
  const pathKey = Object.keys(env).find((k) => k.toLowerCase() === 'path') ?? (process.platform === 'win32' ? 'Path' : 'PATH')
  env[pathKey] = withUserBin(env[pathKey] ?? '', homedir(), process.platform)
  return { ...env, ...extra }
}

// Pasta onde o instalador oficial do Claude Code poe o `claude` (~/.local/bin; no Windows %USERPROFILE%\.local\bin).
// Logo depois de instalar ela pode nao estar no PATH (Ubuntu so acrescenta no proximo login): sem isto o terminal do
// agente dizia "claude: command not found" e a deteccao nao achava o Claude. So acrescenta (no fim) quando falta.
export function withUserBin(path: string, home: string, platform: NodeJS.Platform): string {
  const win = platform === 'win32'
  const sep = win ? ';' : ':'
  const bin = win ? `${home.replace(/[\\/]+$/, '')}\\.local\\bin` : `${home.replace(/\/+$/, '')}/.local/bin`
  const norm = (p: string): string => (win ? p.replace(/[\\/]+$/, '').toLowerCase() : p.replace(/\/+$/, ''))
  const parts = path.split(sep).filter(Boolean)
  if (parts.some((p) => norm(p) === norm(bin))) return path
  return [...parts, bin].join(sep)
}

// Junta o PATH do processo com um PATH extra (o do login shell), remove repetidos preservando a ordem
// (primeiro os do processo), e garante ~/.local/bin no fim (ver withUserBin). Puro e testavel.
export function mergePath(current: string, extra: string, home: string, platform: NodeJS.Platform): string {
  const sep = platform === 'win32' ? ';' : ':'
  const norm = (p: string): string => (platform === 'win32' ? p.replace(/[\\/]+$/, '').toLowerCase() : p.replace(/\/+$/, ''))
  const out: string[] = []
  const seen = new Set<string>()
  for (const p of [...current.split(sep), ...extra.split(sep)].filter(Boolean)) {
    const k = norm(p)
    if (seen.has(k)) continue
    seen.add(k)
    out.push(p)
  }
  return withUserBin(out.join(sep), home, platform)
}

// Extrai o valor de PATH de um dump do comando `env` (uma linha KEY=VALUE por variavel). Puro e testavel.
// Aceita PATH em qualquer caixa (fish/zsh/bash exportam igual) e nao confunde com PATHEXT.
export function pathFromEnvDump(out: string): string | undefined {
  for (const line of out.split(/\r?\n/)) {
    const m = /^(path)=(.*)$/i.exec(line)
    if (m) return m[2]
  }
  return undefined
}

// PATH real do shell de LOGIN do usuario (nvm/volta/fnm/bun/pnpm etc.). No Linux/macOS, o Turno aberto pela
// bandeja/menu herda um PATH minimo e NAO enxerga CLIs instalados por gerenciador de versao de Node — por isso a
// deteccao dizia "not installed" mesmo com o CLI instalado, enquanto o terminal (que abre um login shell) achava.
// Rodamos o login shell UMA vez (cache) e lemos o PATH que ele exporta. Best-effort: erro/timeout => ''.
let loginPathCache: string | undefined
let loginPathInFlight: Promise<string> | undefined // memoiza a resolucao em curso (startup dispara detect 2x)
let loginPathOverride: string | null | undefined // seam de teste (ver __setLoginPathForTest)

// So para testes: fixa (ou limpa, com null) o PATH do login shell sem abrir um processo.
export function __setLoginPathForTest(p: string | null): void {
  loginPathOverride = p
  loginPathCache = undefined
  loginPathInFlight = undefined
}

export function loginShellPath(): Promise<string> {
  if (loginPathOverride !== undefined) return Promise.resolve(loginPathOverride ?? '')
  if (loginPathCache !== undefined) return Promise.resolve(loginPathCache)
  if (loginPathInFlight) return loginPathInFlight
  // No Windows o PATH vem do registro (accounts.currentPath); em teste nao abrimos shell (determinismo).
  if (process.platform === 'win32' || process.env.VITEST) return Promise.resolve((loginPathCache = ''))
  const shell = process.env.SHELL || 'sh'
  loginPathInFlight = new Promise<string>((res) => {
    const done = (v: string): void => res((loginPathCache = v))
    try {
      execFile(shell, ['-lc', 'env'], { timeout: 4000, windowsHide: true, maxBuffer: 1 << 20 }, (_e, out) => done(pathFromEnvDump(String(out ?? '')) ?? ''))
    } catch {
      done('')
    }
  })
  return loginPathInFlight
}

export { claudeInstallCommand } from '../shared/agents'
