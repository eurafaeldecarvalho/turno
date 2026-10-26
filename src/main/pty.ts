import { ipcMain, WebContents } from 'electron'
import * as pty from 'node-pty'
import { existsSync, statSync } from 'node:fs'
import { execFile } from 'node:child_process'
import type { PtyCreateOptions } from '../shared/types'
import { childEnv } from './env'
import { getConnection, resolveProviderEnv } from './providers'
import { getSettings } from './settings'
import { connectionToken } from './secrets'
import { homeDir, resolveShell } from './platform'
import { initTermSessions, trackPty, untrackPty } from './termsessions'
import { onPtyData, onPtyExit, takeLaunchEnv } from './agentBroker'

const isDir = (p: string): boolean => {
  try {
    return statSync(p).isDirectory()
  } catch {
    return false
  }
}

const ptys = new Map<number, pty.IPty>()
let nextId = 1

// Integracao de shell (mesma do Windows Terminal): o prompt emite OSC 9;9 com a pasta atual,
// assim o Turno sabe onde o terminal estava para reabrir no mesmo lugar.
const PWSH_INTEGRATION = [
  '$global:__turnoPrompt = $function:prompt',
  'function global:prompt { $loc = $executionContext.SessionState.Path.CurrentLocation.ProviderPath; "$([char]27)]9;9;`"$loc`"$([char]27)\\" + (& $global:__turnoPrompt) }',
].join('; ')
const encoded = (s: string): string => Buffer.from(s, 'utf16le').toString('base64')

// Env do provedor para um terminal interativo aberto sob um profile (connection id).
const providerEnv = (profile: string): Record<string, string> => {
  const conn = getConnection(getSettings(), profile)
  return resolveProviderEnv(conn, connectionToken(conn))
}

function shellArgs(shell: string): { args: string[]; env: Record<string, string> } {
  if (/pwsh|powershell/i.test(shell)) return { args: ['-NoLogo', '-NoExit', '-EncodedCommand', encoded(PWSH_INTEGRATION)], env: {} }
  if (/cmd\.exe$/i.test(shell)) return { args: [], env: { PROMPT: '$E]9;9;$P$E\\$P$G' } }
  if (/bash(\.exe)?$/i.test(shell) && !/system32/i.test(shell)) return { args: ['--login', '-i'], env: {} }
  return { args: [], env: {} }
}

export function registerPty(getWc: () => WebContents | undefined): void {
  initTermSessions((ptyId, s) => getWc()?.send('pty:session', ptyId, s))

  ipcMain.handle('pty:create', (_e, opts: PtyCreateOptions) => {
    const id = nextId++
    const shell = resolveShell(opts.shell || getSettings().terminal.defaultShell, {
      platform: process.platform,
      shellEnv: process.env.SHELL,
      pathEnv: process.env.PATH,
      exists: existsSync,
    })
    const { args, env } = shellArgs(shell)
    const cwd = opts.cwd && isDir(opts.cwd) ? opts.cwd : homeDir() // arquivo no lugar da pasta tambem cai na home
    const p = pty.spawn(shell, args, {
      name: 'xterm-256color',
      cols: opts.cols,
      rows: opts.rows,
      cwd,
      // terminal de agente: env da conta (pasta isolada, hooks do Turno) preparado por agents:prepare
      env: childEnv({ ...(opts.profile ? providerEnv(opts.profile) : {}), ...env, ...takeLaunchEnv(opts.launchId, id) }),
      useConpty: true,
    })
    ptys.set(id, p)
    trackPty(id, p.pid)
    p.onData((d) => {
      getWc()?.send('pty:data', id, d)
      onPtyData(id, d)
    })
    p.onExit(({ exitCode }) => {
      ptys.delete(id)
      untrackPty(id)
      onPtyExit(id)
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
  ipcMain.handle('pty:memory', () => {
    const items = Array.from(ptys.entries()).map(([id, p]) => ({ ptyId: id, pid: p.pid }))
    if (!items.length) return Promise.resolve([])
    const win = process.platform === 'win32'
    const pids = items.map((x) => x.pid)
    // Windows: Get-Process (WorkingSet64). POSIX: `ps -o pid=,rss=` (rss ja em KB).
    const cmd = win ? 'powershell' : 'ps'
    const args = win
      ? ['-NoProfile', '-NonInteractive', '-Command', `Try{Get-Process -Id @(${pids.join(',')}) -EA SilentlyContinue|Select Id,@{N='K';E={[int]($_.WorkingSet64/1KB)}}|ConvertTo-Json -Compress}Catch{'[]'}`]
      : ['-o', 'pid=,rss=', '-p', pids.join(',')]
    return new Promise((resolve) => {
      execFile(cmd, args, { timeout: 3000, windowsHide: true }, (_err, stdout) => {
        const memMap = new Map<number, number>()
        try {
          if (win) {
            const raw = (stdout ?? '').trim()
            const arr: Array<{ Id: number; K: number }> = JSON.parse(raw.startsWith('[') ? raw : raw ? `[${raw}]` : '[]')
            for (const x of arr) memMap.set(x.Id, x.K)
          } else {
            for (const l of (stdout ?? '').split(/\r?\n/)) {
              const [pid, rss] = l.trim().split(/\s+/).map(Number)
              if (pid) memMap.set(pid, rss || 0)
            }
          }
        } catch {
          /* parse falhou: cai no memKb 0 abaixo */
        }
        resolve(items.map(({ ptyId, pid }) => ({ ptyId, pid, memKb: memMap.get(pid) ?? 0 })))
      })
    })
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
