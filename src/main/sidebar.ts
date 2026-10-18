import { app } from 'electron'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { closeSync, existsSync, openSync, readdirSync, readFileSync, readSync, statSync, writeFileSync } from 'node:fs'
import type { ClaudeSession, SidebarState } from '../shared/types'

const file = (): string => join(app.getPath('userData'), 'sidebar.json')

export function getSidebar(): SidebarState {
  try {
    const s = JSON.parse(readFileSync(file(), 'utf8'))
    return { collapsed: s.collapsed ?? {}, folders: s.folders ?? [] }
  } catch {
    return { collapsed: {}, folders: [] }
  }
}

export function saveSidebar(s: SidebarState): SidebarState {
  writeFileSync(file(), JSON.stringify(s, null, 2))
  return s
}

const projectsDir = (): string => join(process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude'), 'projects')

function head(path: string, bytes = 262144): string {
  const fd = openSync(path, 'r')
  try {
    const buf = Buffer.alloc(bytes)
    const n = readSync(fd, buf, 0, bytes, 0)
    return buf.subarray(0, n).toString('utf8')
  } finally {
    closeSync(fd)
  }
}

function textOf(content: unknown): string | undefined {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    const t = content.find((b) => b?.type === 'text' && typeof b.text === 'string')
    return t?.text
  }
  return undefined
}

// Sessoes do Claude Code (CLI e app Desktop gravam no mesmo lugar), mais recentes primeiro.
export function listClaudeSessions(limit = 80): ClaudeSession[] {
  const root = projectsDir()
  if (!existsSync(root)) return []
  const files: Array<{ path: string; id: string; mtime: number }> = []
  for (const dir of readdirSync(root, { withFileTypes: true })) {
    if (!dir.isDirectory()) continue
    for (const f of readdirSync(join(root, dir.name))) {
      if (!f.endsWith('.jsonl')) continue
      const path = join(root, dir.name, f)
      files.push({ path, id: f.slice(0, -6), mtime: statSync(path).mtimeMs })
    }
  }
  files.sort((a, b) => b.mtime - a.mtime)
  const out: ClaudeSession[] = []
  for (const f of files.slice(0, limit)) {
    let cwd = ''
    let title = ''
    let summary = ''
    for (const line of head(f.path).split('\n')) {
      if (!line.trim()) continue
      let e: any
      try {
        e = JSON.parse(line)
      } catch {
        continue
      }
      if (!cwd && typeof e.cwd === 'string') cwd = e.cwd
      if (e.type === 'summary' && e.summary) summary = e.summary
      if (e.type === 'custom-title' && e.customTitle) summary = e.customTitle
      if (!title && e.type === 'user' && !e.isMeta) {
        const t = textOf(e.message?.content)?.trim()
        if (t && !t.startsWith('<') && !t.startsWith('[Turno]')) title = t.replace(/\s+/g, ' ').slice(0, 90)
      }
      if (cwd && title && summary) break
    }
    if (!title && !summary) continue // sessao vazia
    out.push({ id: f.id, cwd, title: summary || title, updatedAt: new Date(f.mtime).toISOString() })
  }
  return out
}

export function claudeSessionExists(id: string): boolean {
  const root = projectsDir()
  if (!existsSync(root)) return false
  return readdirSync(root).some((d) => existsSync(join(root, d, `${id}.jsonl`)))
}
