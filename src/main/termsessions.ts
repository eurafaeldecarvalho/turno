import { execFile } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, watch, type FSWatcher } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { TermSession } from '../shared/types'

// Descobre qual sessao do Claude Code esta rodando dentro de cada terminal do Turno.
// O Claude Code grava ~/.claude/sessions/<pid>.json (pid, sessionId, cwd, name). Subindo a arvore de
// processos a partir desse pid chegamos ao shell do terminal (pid do node-pty).
const dir = (): string => join(process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude'), 'sessions')

let ptyPids = new Map<number, number>() // pid do shell -> id do pty
let owner = new Map<number, number | null>() // pid do claude -> id do pty (null = nao e nosso)
const lastByPty = new Map<number, string>()
let watcher: FSWatcher | undefined
let timer: ReturnType<typeof setTimeout> | undefined
let interval: ReturnType<typeof setInterval> | undefined
let emit: (ptyId: number, s: TermSession) => void = () => {}

function processTable(): Promise<Map<number, number>> {
  return new Promise((resolve) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-Command', 'Get-CimInstance Win32_Process -Property ProcessId,ParentProcessId | ForEach-Object { "$($_.ProcessId),$($_.ParentProcessId)" }'],
      { windowsHide: true, timeout: 20000, maxBuffer: 8 * 1024 * 1024 },
      (err, out) => {
        const m = new Map<number, number>()
        if (!err) for (const l of out.split(/\r?\n/)) {
          const [a, b] = l.split(',').map(Number)
          if (a) m.set(a, b)
        }
        resolve(m)
      },
    )
  })
}

async function scan(): Promise<void> {
  if (!ptyPids.size || !existsSync(dir())) return
  const files = readdirSync(dir()).filter((f) => /^\d+\.json$/.test(f))
  const sessions: Array<{ pid: number; s: TermSession }> = []
  for (const f of files) {
    try {
      const j = JSON.parse(readFileSync(join(dir(), f), 'utf8'))
      if (j.kind && j.kind !== 'interactive') continue
      sessions.push({ pid: j.pid, s: { agent: 'claude', sessionId: j.sessionId, cwd: j.cwd, name: j.name } })
    } catch {
      /* arquivo sendo escrito */
    }
  }
  const unknown = sessions.filter((x) => !owner.has(x.pid))
  if (unknown.length) {
    const parents = await processTable()
    for (const { pid } of unknown) {
      if (!parents.has(pid)) continue // processo ja morreu: arquivo antigo
      let cur: number | undefined = pid
      let found: number | null = null
      for (let i = 0; i < 12 && cur; i++) {
        if (ptyPids.has(cur)) {
          found = ptyPids.get(cur)!
          break
        }
        cur = parents.get(cur)
      }
      owner.set(pid, found)
    }
  }
  for (const { pid, s } of sessions) {
    const ptyId = owner.get(pid)
    if (ptyId == null || !s.sessionId) continue
    const key = `${s.sessionId}|${s.cwd}|${s.name ?? ''}`
    if (lastByPty.get(ptyId) === key) continue
    lastByPty.set(ptyId, key)
    emit(ptyId, s)
  }
}

function schedule(ms = 600): void {
  clearTimeout(timer)
  timer = setTimeout(() => void scan(), ms)
}

export function initTermSessions(onSession: (ptyId: number, s: TermSession) => void): void {
  emit = onSession
}

export function trackPty(ptyId: number, pid: number): void {
  ptyPids.set(pid, ptyId)
  if (!watcher && existsSync(dir())) {
    try {
      watcher = watch(dir(), () => schedule())
    } catch {
      /* sem watch: fica so o intervalo */
    }
  }
  // Fallback: o arquivo pode ser criado antes do processo aparecer na tabela.
  interval ??= setInterval(() => schedule(0), 15_000)
}

export function untrackPty(ptyId: number): void {
  for (const [pid, id] of ptyPids) if (id === ptyId) ptyPids.delete(pid)
  lastByPty.delete(ptyId)
  for (const [pid, id] of owner) if (id === ptyId) owner.delete(pid)
  if (!ptyPids.size) {
    watcher?.close()
    watcher = undefined
    if (interval) clearInterval(interval)
    interval = undefined
  }
}
