// Env limpo para processos filhos: remove variaveis que marcam "dentro de outra sessao Claude Code".
export function childEnv(extra: Record<string, string> = {}): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [k, v] of Object.entries(process.env)) {
    if (v === undefined) continue
    if (k === 'CLAUDECODE' || k.startsWith('CLAUDE_CODE_') || k === 'ELECTRON_RUN_AS_NODE') continue
    env[k] = v
  }
  if (process.platform === 'win32') env.SystemRoot ??= 'C:\\Windows'
  return { ...env, ...extra }
}
