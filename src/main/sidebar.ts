import { app } from 'electron'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { closeSync, existsSync, openSync, readdirSync, readFileSync, readSync, statSync } from 'node:fs'
import type { ClaudeSession, SidebarState } from '../shared/types'
import { readJson, reportBadShape, writeJsonAtomic } from './jsonStore'

const file = (): string => join(app.getPath('userData'), 'sidebar.json')

// sidebar.json existia mas nao foi lido nesta sessao: o renderer esta com a lista vazia, gravar apagaria as pastas
let blocked = false

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const KINDS = ['chat', 'link', 'terminal']
const validItem = (i: unknown): boolean => isObj(i) && typeof i.id === 'string' && typeof i.name === 'string' && KINDS.includes(i.kind as string)

export function getSidebar(): SidebarState {
  const r = readJson<unknown>(file())
  if (!r.ok) {
    blocked = true
    return { collapsed: {}, folders: [] }
  }
  if (r.data === undefined) return { collapsed: {}, folders: [] }
  // JSON valido com forma errada: o que der para aproveitar fica; o resto e descartado (com copia do arquivo)
  const d = isObj(r.data) ? r.data : {}
  const bad: string[] = isObj(r.data) ? [] : ['the whole file']
  const collapsed = isObj(d.collapsed) ? (d.collapsed as Record<string, boolean>) : (d.collapsed !== undefined && bad.push('collapsed'), {})
  let folders: SidebarState['folders'] = []
  if (Array.isArray(d.folders)) {
    for (const f of d.folders) {
      if (!isObj(f) || typeof f.id !== 'string' || typeof f.name !== 'string') {
        bad.push('folders')
        continue
      }
      const items = Array.isArray(f.items) ? f.items.filter(validItem) : []
      if (!Array.isArray(f.items) || items.length !== f.items.length) bad.push(`items of "${f.name}"`)
      folders.push({ ...(f as unknown as SidebarState['folders'][number]), items: items as SidebarState['folders'][number]['items'] })
    }
  } else if (d.folders !== undefined) bad.push('folders')
  if (bad.length && !reportBadShape(file(), [...new Set(bad)])) blocked = true
  if (bad.length && blocked) folders = []
  return { collapsed, folders }
}

export function saveSidebar(s: SidebarState): SidebarState {
  if (blocked) throw new Error("sidebar.json couldn't be read when Turno started, so sidebar changes aren't saved. Restart Turno once the file is available.")
  writeJsonAtomic(file(), s)
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
