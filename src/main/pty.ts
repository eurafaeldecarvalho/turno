import { ipcMain, WebContents } from 'electron'
import * as pty from 'node-pty'
import { existsSync } from 'node:fs'
import type { PtyCreateOptions } from '../shared/types'
import { childEnv } from './env'
import { PROFILE_ENV } from './runner'
import { getSettings } from './settings'
import { initTermSessions, trackPty, untrackPty } from './termsessions'

const ptys = new Map<number, pty.IPty>()
let nextId = 1

// Integracao de shell (mesma do Windows Terminal): o prompt emite OSC 9;9 com a pasta atual,
// assim o Turno sabe onde o terminal estava para reabrir no mesmo lugar.
const PWSH_INTEGRATION = [
  '$global:__turnoPrompt = $function:prompt',
  'function global:prompt { $loc = $executionContext.SessionState.Path.CurrentLocation.ProviderPath; "$([char]27)]9;9;`"$loc`"$([char]27)\\" + (& $global:__turnoPrompt) }',
].join('; ')
const encoded = (s: string): string => Buffer.from(s, 'utf16le').toString('base64')

function shellArgs(shell: string): { args: string[]; env: Record<string, string> } {
  if (/pwsh|powershell/i.test(shell)) return { args: ['-NoLogo', '-NoExit', '-EncodedCommand', encoded(PWSH_INTEGRATION)], env: {} }
  if (/cmd\.exe$/i.test(shell)) return { args: [], env: { PROMPT: '$E]9;9;$P$E\\$P$G' } }
  if (/bash\.exe$/i.test(shell) && !/system32/i.test(shell)) return { args: ['--login', '-i'], env: {} }
  return { args: [], env: {} }
}

export function registerPty(getWc: () => WebContents | undefined): void {
  initTermSessions((ptyId, s) => getWc()?.send('pty:session', ptyId, s))

  ipcMain.handle('pty:create', (_e, opts: PtyCreateOptions) => {
    const id = nextId++
    const shell = opts.shell || getSettings().terminal.defaultShell || 'pwsh.exe'
    const { args, env } = shellArgs(shell)
    const cwd = opts.cwd && existsSync(opts.cwd) ? opts.cwd : process.env.USERPROFILE
    const p = pty.spawn(shell, args, {
      name: 'xterm-256color',
      cols: opts.cols,
      rows: opts.rows,
      cwd,
      env: childEnv({ ...(opts.profile ? PROFILE_ENV[opts.profile] : {}), ...env }),
      useConpty: true,
    })
    ptys.set(id, p)
    trackPty(id, p.pid)
    p.onData((d) => getWc()?.send('pty:data', id, d))
    p.onExit(({ exitCode }) => {
      ptys.delete(id)
      untrackPty(id)
      getWc()?.send('pty:exit', id, exitCode)
    })
    return id
  })
  ipcMain.on('pty:write', (_e, id: number, data: string) => ptys.get(id)?.write(data))
  ipcMain.on('pty:resize', (_e, id: number, cols: number, rows: number) => {
    const p = ptys.get(id)
    if (p && (p.cols !== cols || p.rows !== rows)) p.resize(cols, rows)
  })
  ipcMain.on('pty:kill', (_e, id: number) => {
    safeKill(ptys.get(id))
    ptys.delete(id)
    untrackPty(id)
  })
}

function safeKill(p: pty.IPty | undefined): void {
  try {
    p?.kill()
  } catch {
    /* processo ja morreu */
  }
}

export function killAllPtys(): void {
  for (const p of ptys.values()) safeKill(p)
  ptys.clear()
}
