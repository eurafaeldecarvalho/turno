import { ipcMain, WebContents } from 'electron'
import * as pty from 'node-pty'
import type { PtyCreateOptions } from '../shared/types'
import { childEnv } from './env'
import { PROFILE_ENV } from './runner'
import { getSettings } from './settings'

const ptys = new Map<number, pty.IPty>()
let nextId = 1

export function registerPty(getWc: () => WebContents | undefined): void {
  ipcMain.handle('pty:create', (_e, opts: PtyCreateOptions) => {
    const id = nextId++
    const shell = opts.shell || getSettings().terminal.defaultShell || 'pwsh.exe'
    const args = /pwsh|powershell/i.test(shell) ? ['-NoLogo'] : /bash\.exe$/i.test(shell) && !/system32/i.test(shell) ? ['--login', '-i'] : []
    const p = pty.spawn(shell, args, {
      name: 'xterm-256color',
      cols: opts.cols,
      rows: opts.rows,
      cwd: opts.cwd ?? process.env.USERPROFILE,
      env: childEnv(opts.profile ? PROFILE_ENV[opts.profile] : {}),
      useConpty: true,
    })
    ptys.set(id, p)
    p.onData((d) => getWc()?.send('pty:data', id, d))
    p.onExit(({ exitCode }) => {
      ptys.delete(id)
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
