import { homedir } from 'node:os'

export const IS_WIN = process.platform === 'win32'

// Shell padrao por plataforma (o app roda em Windows e Linux/mac).
export function defaultShell(platform: NodeJS.Platform = process.platform): string {
  if (platform === 'win32') return 'pwsh.exe'
  if (platform === 'darwin') return 'zsh'
  return 'bash'
}

// Shell padrao efetivo: no POSIX prefere o $SHELL do usuario (coerente com detectShells); senao o fallback.
export function preferredShell(platform: NodeJS.Platform = process.platform, shellEnv: string | undefined = process.env.SHELL): string {
  if (platform !== 'win32' && shellEnv) return shellEnv
  return defaultShell(platform)
}

// Home do usuario, cross-platform (USERPROFILE so existe no Windows).
export function homeDir(): string {
  return homedir()
}

export interface ShellEnv {
  platform: NodeJS.Platform
  shellEnv: string | undefined
  pathEnv: string | undefined
  exists: (p: string) => boolean
}

// Shell que da para executar nesta maquina: absoluto que existe, ou nome solto achado no PATH.
function runnable(shell: string, env: ShellEnv): boolean {
  if (shell.includes('/')) return env.exists(shell)
  return (env.pathEnv ?? '').split(':').some((dir) => dir && env.exists(`${dir}/${shell}`))
}

// Shell que o terminal vai abrir. No POSIX, um shell salvo que nao existe aqui (ex.: "pwsh.exe" vindo de
// settings do Windows) faria o execvp falhar em TODO terminal: cai no $SHELL do usuario e, por fim, no default.
// No Windows nao mexe: o ConPTY resolve o nome pelo PATH do proprio Windows.
export function resolveShell(requested: string | undefined, env: ShellEnv): string {
  if (env.platform === 'win32') return requested || defaultShell(env.platform)
  if (requested && runnable(requested, env)) return requested
  if (env.shellEnv && runnable(env.shellEnv, env)) return env.shellEnv
  return defaultShell(env.platform)
}

// Shell salvo no settings: vazio = padrao do sistema (resolvido ao abrir o terminal). Um salvo que nao roda
// nesta maquina (ex.: settings vindo do Windows) volta a ser o padrao do sistema, em vez de um valor morto na tela.
export function savedShell(saved: string, env: ShellEnv): string {
  if (!saved || env.platform === 'win32') return saved
  return runnable(saved, env) ? saved : ''
}
