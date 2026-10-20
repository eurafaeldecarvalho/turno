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
