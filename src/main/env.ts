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

export { claudeInstallCommand } from '../shared/agents'
