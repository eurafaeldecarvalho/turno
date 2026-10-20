import { homedir } from 'node:os'

export const IS_WIN = process.platform === 'win32'

// Shell padrao por plataforma (o app roda em Windows e Linux/mac).
export function defaultShell(platform: NodeJS.Platform = process.platform): string {
  if (platform === 'win32') return 'pwsh.exe'
  if (platform === 'darwin') return 'zsh'
  return 'bash'
}

// Home do usuario, cross-platform (USERPROFILE so existe no Windows).
export function homeDir(): string {
  return homedir()
}
