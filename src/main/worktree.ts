import { execFileSync } from 'node:child_process'
import { join } from 'node:path'

export interface WorktreeEntry {
  path: string
  head?: string
  branch?: string
}

// Caminho/branch deterministicos por run. Branch em Conventional (turno/...), worktree FORA da pasta do repo
// (trocar a branch da pasta principal mexeria nos arquivos sob o editor do usuario).
export function planWorktree(repoRoot: string, routineId: string, runId: string): { branch: string; path: string } {
  const slug = routineId.replace(/[^a-z0-9]+/gi, '-').toLowerCase().replace(/^-|-$/g, '') || 'routine'
  const short = (runId.match(/[a-z0-9]+/gi)?.join('') ?? runId).slice(-8).toLowerCase()
  const name = `${slug}-${short}`
  return { branch: `turno/${name}`, path: join(repoRoot, '..', '.turno-worktrees', name) }
}

// Parseia `git worktree list --porcelain` em entradas.
export function parseWorktrees(porcelain: string): WorktreeEntry[] {
  const out: WorktreeEntry[] = []
  let cur: WorktreeEntry | undefined
  for (const line of porcelain.split('\n')) {
    if (line.startsWith('worktree ')) {
      cur = { path: line.slice('worktree '.length).trim() }
      out.push(cur)
    } else if (cur && line.startsWith('HEAD ')) {
      cur.head = line.slice('HEAD '.length).trim()
    } else if (cur && line.startsWith('branch ')) {
      cur.branch = line.slice('branch '.length).trim().replace(/^refs\/heads\//, '')
    }
  }
  return out
}

// So e seguro remover o worktree se nao houver mudancas nao commitadas (saida de `git status --porcelain` vazia).
export function canCleanup(statusPorcelain: string): boolean {
  return statusPorcelain.trim() === ''
}

export function createWorktree(repoRoot: string, branch: string, path: string): void {
  execFileSync('git', ['worktree', 'add', '-b', branch, path], { cwd: repoRoot, stdio: 'pipe' })
}

// Sem --force de proposito: o git recusa remover um worktree com mudancas nao commitadas,
// honrando a regra "so limpa se o working tree estiver limpo" (ver canCleanup).
export function removeWorktree(repoRoot: string, path: string): void {
  execFileSync('git', ['worktree', 'remove', path], { cwd: repoRoot, stdio: 'pipe' })
  execFileSync('git', ['worktree', 'prune'], { cwd: repoRoot, stdio: 'pipe' })
}
