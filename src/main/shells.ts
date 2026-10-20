import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import type { ShellInfo } from '../shared/types'
import { IS_WIN } from './platform'

function which(exe: string): string | undefined {
  try {
    return execFileSync('where.exe', [exe], { encoding: 'utf8', windowsHide: true }).split(/\r?\n/)[0]?.trim() || undefined
  } catch {
    return undefined
  }
}

let fontsCache: string[] | undefined

// Fontes instaladas (mesmo metodo do Orca: InstalledFontCollection via PowerShell).
export function listFonts(): string[] {
  if (fontsCache) return fontsCache
  if (!IS_WIN) return (fontsCache = []) // fora do Windows: sem enumeracao (as fontes sugeridas ainda funcionam)
  try {
    const out = execFileSync(
      'powershell.exe',
      ['-NoProfile', '-Command', '[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false); Add-Type -AssemblyName System.Drawing; (New-Object System.Drawing.Text.InstalledFontCollection).Families | % Name'],
      { encoding: 'utf8', windowsHide: true, timeout: 20000 },
    )
    fontsCache = [...new Set(out.split(/\r?\n/).map((s) => s.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b))
  } catch {
    fontsCache = []
  }
  return fontsCache
}

// Shells disponiveis, na ordem de preferencia (Windows e POSIX).
export function detectShells(): ShellInfo[] {
  const out: ShellInfo[] = []
  const add = (id: string, name: string, path: string | undefined): void => {
    if (path && existsSync(path)) out.push({ id, name, path })
  }
  if (!IS_WIN) {
    // POSIX: o shell do usuario ($SHELL) primeiro, depois os comuns.
    if (process.env.SHELL && existsSync(process.env.SHELL)) out.push({ id: 'user', name: `Default (${process.env.SHELL.split('/').pop()})`, path: process.env.SHELL })
    add('bash', 'Bash', existsSync('/bin/bash') ? '/bin/bash' : '/usr/bin/bash')
    add('zsh', 'Zsh', existsSync('/bin/zsh') ? '/bin/zsh' : '/usr/bin/zsh')
    add('fish', 'Fish', ['/usr/bin/fish', '/usr/local/bin/fish', '/opt/homebrew/bin/fish'].find(existsSync))
    add('sh', 'sh', '/bin/sh')
    // dedupe por path
    return out.filter((s, i) => out.findIndex((x) => x.path === s.path) === i)
  }
  add('pwsh', 'PowerShell 7', which('pwsh.exe'))
  add('powershell', 'Windows PowerShell', join(process.env.SystemRoot ?? 'C:\\Windows', 'System32\\WindowsPowerShell\\v1.0\\powershell.exe'))
  add('cmd', 'Command Prompt', join(process.env.SystemRoot ?? 'C:\\Windows', 'System32\\cmd.exe'))
  const git = ['C:\\Program Files\\Git\\bin\\bash.exe', join(process.env.LOCALAPPDATA ?? '', 'Programs\\Git\\bin\\bash.exe')].find(existsSync)
  add('gitbash', 'Git Bash', git)
  add('wsl', 'WSL', which('wsl.exe'))
  return out
}
