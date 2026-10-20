import { execFileSync } from 'node:child_process'
import { join, relative } from 'node:path'

export interface WorktreeEntry {
  path: string
  head?: string
  branch?: string
}

// Caminho/branch deterministicos por run. Branch com prefixo dedicado `turno/` (nao e um tipo Conventional;
// so marca as branches criadas pelo Turno), worktree FORA da pasta do repo (trocar a branch da pasta
// principal mexeria nos arquivos sob o editor do usuario).
export function planWorktree(repoRoot: string, routineId: string, runId: string): { branch: string; path: string } {
  const slug = routineId.replace(/[^a-z0-9]+/gi, '-').toLowerCase().replace(/^-|-$/g, '') || 'routine'
  const short = (runId.match(/[a-z0-9]+/gi)?.join('') ?? runId).slice(-8).toLowerCase()
  const name = `${slug}-${short}`
  return { branch: `turno/${name}`, path: join(repoRoot, '..', '.turno-worktrees', name) }
}

// Decide se uma run deve rodar num git worktree isolado — e, se sim, qual branch/caminho.
// Regras de seguranca: se a run JA esta dentro de uma worktree gerenciada viva (resume na worktree
// preservada), continua nela (nao cria outra); senao (fresh OU resume cuja worktree foi removida) cria.
// isolation 'worktree' SEM repositorio git LANCA, p/ a run ser pulada em vez de rodar no diretorio principal.
export function worktreeDecision(o: {
  isolation?: 'none' | 'worktree'
  alreadyInWorktree?: boolean
  repoRoot?: string
  routineId: string
  runId: string
}): { branch: string; path: string } | undefined {
  if ((o.isolation ?? 'none') !== 'worktree') return undefined
  if (o.alreadyInWorktree) return undefined
  if (!o.repoRoot) throw new Error('isolation "worktree" requer um repositorio git (nenhum encontrado a partir do diretorio da run)')
  return planWorktree(o.repoRoot, o.routineId, o.runId)
}

// Raiz do repositorio git a partir de um diretorio (ou undefined se nao for um repo).
export function resolveRepoRoot(cwd: string | undefined): string | undefined {
  if (!cwd) return undefined
  try {
    return execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd, encoding: 'utf8', stdio: 'pipe' }).trim() || undefined
  } catch {
    return undefined
  }
}

// Mapeia o cwd da run (sob o repo principal) pro caminho equivalente DENTRO do worktree.
// Rotina na raiz -> raiz do worktree; rotina numa subpasta -> a mesma subpasta no worktree.
export function worktreeCwd(wtPath: string, repoRoot: string, reqCwd: string): string {
  return join(wtPath, relative(repoRoot, reqCwd))
}

// Caminho e um worktree gerenciado pelo Turno? (marcador `.turno-worktrees` — so removemos os nossos).
export function isManagedWorktreePath(cwd: string | undefined): boolean {
  return !!cwd && cwd.replace(/\\/g, '/').includes('/.turno-worktrees/')
}

// De dentro de um worktree, descobre a raiz do repositorio PRINCIPAL (p/ remover o worktree no resume).
// `git worktree list` sempre lista o principal primeiro. undefined se nao for um repo/worktree.
export function worktreeMainRoot(cwd: string): string | undefined {
  try {
    return parseWorktrees(execFileSync('git', ['worktree', 'list', '--porcelain'], { cwd, encoding: 'utf8', stdio: 'pipe' }))[0]?.path
  } catch {
    return undefined
  }
}

// Saida de `git status --porcelain` dentro do worktree (vazia = limpo). I/O isolado para o teardown.
// SEM --ignored de proposito: arquivos ignorados (node_modules, dist/, .cache) sao regeneraveis, entao NAO
// bloqueiam a limpeza — senao uma rotina que builda vazaria GBs de worktree por run. Mudanca em arquivo
// RASTREADO ou arquivo novo NAO-ignorado aparece (` M`/`??`) e PRESERVA a worktree (trabalho de verdade,
// ou commite na branch turno/ que sobrevive a remocao). Saida que importa deve ir pra path rastreado/commit.
export function worktreeStatus(path: string): string {
  return execFileSync('git', ['status', '--porcelain'], { cwd: path, encoding: 'utf8', stdio: 'pipe' })
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
