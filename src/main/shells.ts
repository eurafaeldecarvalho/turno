import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import type { ShellInfo } from '../shared/types'
import { IS_WIN, defaultShell } from './platform'

function which(exe: string): string | undefined {
  try {
    return execFileSync('where.exe', [exe], { encoding: 'utf8', windowsHide: true }).split(/\r?\n/)[0]?.trim() || undefined
  } catch {
    return undefined
  }
}

let fontsCache: string[] | undefined

// Fontes de icones/simbolos: nao servem como fonte de texto.
const SYMBOL_FONTS = /^(Marlett|Webdings|Wingdings( \d)?|Symbol|MT Extra|Segoe (MDL2 Assets|Fluent Icons|UI Symbol|UI Emoji)|HoloLens MDL2 Assets)$/i

// Fontes instaladas, via PowerShell (WPF + GDI).
export function listFonts(): string[] {
  if (fontsCache) return fontsCache
  if (!IS_WIN) return (fontsCache = []) // fora do Windows: sem enumeracao (as fontes sugeridas ainda funcionam)
  try {
    // GDI (InstalledFontCollection) corta o nome em 31 caracteres ("Bahnschrift SemiBold SemiConden");
    // WPF devolve as familias tipograficas com o nome inteiro. Usa as duas e descarta os nomes cortados do GDI.
    const ps = [
      '[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)',
      'Add-Type -AssemblyName PresentationCore, System.Drawing',
      "[System.Windows.Media.Fonts]::SystemFontFamilies | % { $_.FamilyNames['en-us'] } | ? { $_ } | % { 'W|' + $_ }",
      "(New-Object System.Drawing.Text.InstalledFontCollection).Families | % { 'G|' + $_.Name }",
    ].join('; ')
    const out = execFileSync('powershell.exe', ['-NoProfile', '-Command', ps], { encoding: 'utf8', windowsHide: true, timeout: 20000 })
    const names = out
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.startsWith('W|') || (l.startsWith('G|') && l.length - 2 < 31))
      .map((l) => l.slice(2).trim())
      .filter((n) => n && !SYMBOL_FONTS.test(n))
    fontsCache = [...new Set(names)].sort((a, b) => a.localeCompare(b))
  } catch {
    fontsCache = []
  }
  return fontsCache
}

// Shells disponiveis, na ordem de preferencia (Windows e POSIX).
export function detectShells(): ShellInfo[] {
  // path vazio = padrao do sistema, resolvido ao abrir o terminal ($SHELL no POSIX)
  const system = (!IS_WIN && process.env.SHELL) || defaultShell()
  const out: ShellInfo[] = [{ id: 'system', name: `System default (${system.split(/[\\/]/).pop()})`, path: '' }]
  const add = (id: string, name: string, path: string | undefined): void => {
    if (path && existsSync(path)) out.push({ id, name, path })
  }
  if (!IS_WIN) {
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
