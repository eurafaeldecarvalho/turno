import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import type { ShellInfo } from '../shared/types'

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

// Shells disponiveis no Windows, na ordem de preferencia.
export function detectShells(): ShellInfo[] {
  const out: ShellInfo[] = []
  const add = (id: string, name: string, path: string | undefined): void => {
    if (path && existsSync(path)) out.push({ id, name, path })
  }
  add('pwsh', 'PowerShell 7', which('pwsh.exe'))
  add('powershell', 'Windows PowerShell', join(process.env.SystemRoot ?? 'C:\\Windows', 'System32\\WindowsPowerShell\\v1.0\\powershell.exe'))
  add('cmd', 'Prompt de Comando', join(process.env.SystemRoot ?? 'C:\\Windows', 'System32\\cmd.exe'))
  const git = ['C:\\Program Files\\Git\\bin\\bash.exe', join(process.env.LOCALAPPDATA ?? '', 'Programs\\Git\\bin\\bash.exe')].find(existsSync)
  add('gitbash', 'Git Bash', git)
  add('wsl', 'WSL', which('wsl.exe'))
  return out
}
