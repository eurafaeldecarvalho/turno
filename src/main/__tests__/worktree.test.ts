import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, existsSync, mkdirSync, symlinkSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { writeFileSync } from 'node:fs'
import { planWorktree, parseWorktrees, canCleanup, createWorktree, removeWorktree, worktreeDecision, worktreeStatus, resolveRepoRoot, worktreeCwd, isManagedWorktreePath, worktreeMainRoot, worktreeTeardown, worktreeHead, worktreeBase, worktreeBranch, deleteBranch } from '../worktree'

describe('planWorktree (puro)', () => {
  it('gera branch com prefixo turno/ e caminho FORA do repo, deterministico por run', () => {
    const repo = '/home/me/repo'
    const a = planWorktree(repo, 'minha-rotina', '2026-10-20T10-00-00-000Z-7')
    const b = planWorktree(repo, 'minha-rotina', '2026-10-20T10-00-00-000Z-7')
    expect(a).toEqual(b) // deterministico
    expect(a.branch).toMatch(/^turno\//)
    expect(a.path.startsWith(repo + '/')).toBe(false) // nao fica DENTRO do repo
    expect(a.path).toContain('.turno-worktrees') // fica num dir irmao dedicado
  })
  it('runs diferentes geram branch/caminho distintos', () => {
    const a = planWorktree('/repo', 'r', 'run-1')
    const b = planWorktree('/repo', 'r', 'run-2')
    expect(a.branch).not.toBe(b.branch)
    expect(a.path).not.toBe(b.path)
  })
})

describe('parseWorktrees (puro)', () => {
  it('le a saida --porcelain', () => {
    const out = ['worktree /repo', 'HEAD abc123', 'branch refs/heads/main', '', 'worktree /tmp/wt', 'HEAD def456', 'branch refs/heads/turno/x', ''].join('\n')
    const list = parseWorktrees(out)
    expect(list).toHaveLength(2)
    expect(list[1]).toMatchObject({ path: '/tmp/wt', branch: 'turno/x' })
  })
})

describe('worktreeDecision (puro) — quando criar um worktree para a run', () => {
  const base = { routineId: 'rota', runId: 'run-1' }
  it('isolation none/ausente nao cria worktree', () => {
    expect(worktreeDecision({ ...base, isolation: 'none', repoRoot: '/repo' })).toBeUndefined()
    expect(worktreeDecision({ ...base, repoRoot: '/repo' })).toBeUndefined()
  })
  it('ja DENTRO de uma worktree gerenciada (resume na worktree preservada) nao cria outra', () => {
    expect(worktreeDecision({ ...base, isolation: 'worktree', alreadyInWorktree: true, repoRoot: '/repo' })).toBeUndefined()
  })
  it('isolation worktree SEM repo git lanca (nunca roda no diretorio principal)', () => {
    expect(() => worktreeDecision({ ...base, isolation: 'worktree', repoRoot: undefined })).toThrow(/repositorio git/i)
  })
  it('isolation worktree FORA de worktree gerenciada cria (fresh OU resume cuja worktree sumiu)', () => {
    const plan = worktreeDecision({ ...base, isolation: 'worktree', alreadyInWorktree: false, repoRoot: '/repo' })
    expect(plan).toEqual(planWorktree('/repo', 'rota', 'run-1'))
  })
})

describe('worktreeCwd (puro) — mapeia o cwd da run pra dentro do worktree', () => {
  it('cwd na raiz do repo -> raiz do worktree', () => {
    expect(worktreeCwd('/wt/r-1', '/repo', '/repo')).toBe('/wt/r-1')
  })
  it('cwd em subpasta -> MESMA subpasta dentro do worktree (nao a raiz)', () => {
    expect(worktreeCwd('/wt/r-1', '/repo', '/repo/routines/a')).toBe(join('/wt/r-1', 'routines/a'))
  })
})

describe('isManagedWorktreePath (puro) — reconhece worktree do Turno', () => {
  it('true sob .turno-worktrees, false caso contrario', () => {
    expect(isManagedWorktreePath('/x/.turno-worktrees/foo')).toBe(true)
    expect(isManagedWorktreePath('/x/repo')).toBe(false)
    expect(isManagedWorktreePath(undefined)).toBe(false)
  })
})

describe('worktreeTeardown (puro) — preservar (tem trabalho) vs remover (vazia de verdade)', () => {
  it('mudanca nao commitada -> preserva', () => {
    expect(worktreeTeardown({ uncommitted: true, base: 'a', head: 'a' })).toBe('preserve')
  })
  it('branch avancou (tem commits) -> preserva (trabalho vive na branch+worktree)', () => {
    expect(worktreeTeardown({ uncommitted: false, base: 'a', head: 'b' })).toBe('preserve')
  })
  it('limpo e sem commits (HEAD == base) -> remove', () => {
    expect(worktreeTeardown({ uncommitted: false, base: 'a', head: 'a' })).toBe('remove')
  })
  it('base desconhecida -> preserva (nao arrisca apagar trabalho)', () => {
    expect(worktreeTeardown({ uncommitted: false, base: undefined, head: 'a' })).toBe('preserve')
  })
})

describe('canCleanup (puro)', () => {
  it('so limpa quando o working tree esta limpo', () => {
    expect(canCleanup('')).toBe(true)
    expect(canCleanup(' M arquivo.ts')).toBe(false)
  })
})

describe('createWorktree/removeWorktree (integracao git)', () => {
  let repo: string
  beforeAll(() => {
    repo = mkdtempSync(join(tmpdir(), 'turno-wt-'))
    execFileSync('git', ['init', '-q'], { cwd: repo })
    execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '--allow-empty', '-q', '-m', 'init'], { cwd: repo })
  })
  afterAll(() => rmSync(repo, { recursive: true, force: true }))

  it('cria e remove um worktree de verdade', () => {
    const { branch, path } = planWorktree(repo, 'rota', 'run-xyz')
    createWorktree(repo, branch, path)
    expect(existsSync(path)).toBe(true)
    const list = parseWorktrees(execFileSync('git', ['worktree', 'list', '--porcelain'], { cwd: repo }).toString())
    expect(list.some((w) => w.branch === branch)).toBe(true)
    removeWorktree(repo, path)
    expect(existsSync(path)).toBe(false)
  })

  it('resolveRepoRoot acha a raiz a partir do dir; undefined fora de repo', () => {
    expect(resolveRepoRoot(repo)).toBe(execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: repo }).toString().trim())
    expect(resolveRepoRoot(tmpdir())).toBeUndefined() // tmpdir nao e repo git
  })

  it('cwd canonicalizado (realpath) nao escapa do worktree quando o repo chega por symlink (fix BREAK B)', () => {
    const base = mkdtempSync(join(tmpdir(), 'turno-sym-'))
    const real = join(base, 'real')
    mkdirSync(join(real, 'sub'), { recursive: true })
    execFileSync('git', ['init', '-q'], { cwd: real })
    execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '--allow-empty', '-q', '-m', 'init'], { cwd: real })
    symlinkSync(real, join(base, 'link'))
    try {
      const repoRoot = resolveRepoRoot(join(base, 'link'))! // git rev-parse devolve o REALPATH
      const canon = realpathSync(join(base, 'link', 'sub')) // canonicaliza o cwd que veio por symlink
      const { path: wtPath } = planWorktree(repoRoot, 'r', 'run-sym')
      const eff = worktreeCwd(wtPath, repoRoot, canon)
      expect(eff.startsWith(wtPath)).toBe(true) // DENTRO do worktree (sem ../ escapando pro repo principal)
      expect(eff).toBe(join(wtPath, 'sub'))
    } finally {
      rmSync(base, { recursive: true, force: true })
    }
  })

  it('createWorktree grava base; worktreeHead/Base/Branch leem; deleteBranch apaga', () => {
    const { branch, path } = planWorktree(repo, 'rota', 'run-base')
    rmSync(path, { recursive: true, force: true })
    createWorktree(repo, branch, path)
    try {
      expect(worktreeBase(path)).toBe(worktreeHead(path)) // recem-criado: base == HEAD (sem commits)
      expect(worktreeBranch(path)).toBe(branch)
    } finally {
      removeWorktree(repo, path)
      expect(execFileSync('git', ['branch', '--list', branch], { cwd: repo }).toString().trim()).toBe(branch) // sobra sem deleteBranch
      deleteBranch(repo, branch)
      expect(execFileSync('git', ['branch', '--list', branch], { cwd: repo }).toString().trim()).toBe('') // apagada
    }
  })

  it('base e POR-WORKTREE (nao compartilhada): worktrees concorrentes tem bases independentes', () => {
    const a = planWorktree(repo, 'rota', 'run-pwa')
    rmSync(a.path, { recursive: true, force: true })
    createWorktree(repo, a.branch, a.path)
    // main avanca ENTRE as duas criacoes
    execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '--allow-empty', '-q', '-m', 'avanca main'], { cwd: repo, stdio: 'pipe' })
    const b = planWorktree(repo, 'rota', 'run-pwb')
    rmSync(b.path, { recursive: true, force: true })
    createWorktree(repo, b.branch, b.path)
    try {
      expect(worktreeBase(a.path)).toBe(worktreeHead(a.path)) // cada worktree guarda a SUA base (nao a da outra)
      expect(worktreeBase(b.path)).toBe(worktreeHead(b.path))
      expect(worktreeBase(a.path)).not.toBe(worktreeBase(b.path)) // bases distintas (main moveu entre as criacoes)
    } finally {
      removeWorktree(repo, a.path)
      deleteBranch(repo, a.branch)
      removeWorktree(repo, b.path)
      deleteBranch(repo, b.branch)
    }
  })

  it('worktree vazia (sem commits) -> teardown REMOVE; com commit -> PRESERVA (fix #2 + vazamento de branch)', () => {
    // vazia: HEAD == base -> remove
    const w1 = planWorktree(repo, 'rota', 'run-empty')
    rmSync(w1.path, { recursive: true, force: true })
    createWorktree(repo, w1.branch, w1.path)
    expect(worktreeTeardown({ uncommitted: !canCleanup(worktreeStatus(w1.path)), base: worktreeBase(w1.path), head: worktreeHead(w1.path) })).toBe('remove')
    removeWorktree(repo, w1.path)
    deleteBranch(repo, w1.branch)

    // com commit: HEAD != base -> preserva (trabalho na branch; nao vira recria-do-HEAD incoerente)
    const w2 = planWorktree(repo, 'rota', 'run-commit')
    rmSync(w2.path, { recursive: true, force: true })
    createWorktree(repo, w2.branch, w2.path)
    try {
      writeFileSync(join(w2.path, 'feito.txt'), 'trabalho')
      const gitq = (...a: string[]): void => void execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...a], { cwd: w2.path, stdio: 'pipe' })
      gitq('add', '.')
      gitq('commit', '-q', '-m', 'trabalho do agente')
      expect(worktreeTeardown({ uncommitted: !canCleanup(worktreeStatus(w2.path)), base: worktreeBase(w2.path), head: worktreeHead(w2.path) })).toBe('preserve')
    } finally {
      execFileSync('git', ['worktree', 'remove', '--force', w2.path], { cwd: repo, stdio: 'pipe' })
      deleteBranch(repo, w2.branch)
    }
  })

  it('worktreeStatus usa --untracked-files=all (pega untracked mesmo com showUntrackedFiles=no)', () => {
    const { branch, path } = planWorktree(repo, 'rota', 'run-uall')
    rmSync(path, { recursive: true, force: true })
    createWorktree(repo, branch, path)
    try {
      execFileSync('git', ['config', 'status.showUntrackedFiles', 'no'], { cwd: path, stdio: 'pipe' })
      writeFileSync(join(path, 'novo.txt'), 'trabalho untracked')
      expect(canCleanup(worktreeStatus(path))).toBe(false) // ainda detecta o untracked -> preserva (nao perde)
    } finally {
      // config local de worktree e compartilhada com o repo: desfaz p/ nao vazar pros outros testes.
      execFileSync('git', ['config', '--unset', 'status.showUntrackedFiles'], { cwd: path, stdio: 'pipe' })
      execFileSync('git', ['worktree', 'remove', '--force', path], { cwd: repo, stdio: 'pipe' })
      deleteBranch(repo, branch)
    }
  })

  it('worktreeMainRoot: de DENTRO do worktree, acha o repo principal (p/ teardown no resume)', () => {
    const { branch, path } = planWorktree(repo, 'rota', 'run-main')
    rmSync(path, { recursive: true, force: true })
    createWorktree(repo, branch, path)
    try {
      // rodando de dentro da worktree, descobre a raiz do repo principal (nao a propria worktree)
      const mainRoot = worktreeMainRoot(path)
      expect(mainRoot).toBe(resolveRepoRoot(repo))
      expect(mainRoot).not.toBe(path)
    } finally {
      removeWorktree(repo, path)
    }
  })

  it('teardown: untracked (nao-ignorado) PRESERVA; ignorado-only pode limpar (nao vaza build/node_modules)', () => {
    const { branch, path } = planWorktree(repo, 'rota', 'run-ign')
    rmSync(path, { recursive: true, force: true })
    createWorktree(repo, branch, path)
    const gitq = (...a: string[]): void => void execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...a], { cwd: path, stdio: 'pipe' })
    try {
      writeFileSync(join(path, '.gitignore'), 'build/\n')
      gitq('add', '.gitignore')
      gitq('commit', '-q', '-m', 'ignore build')
      mkdirSync(join(path, 'build'))
      writeFileSync(join(path, 'build', 'out.js'), 'artefato regeneravel') // IGNORADO
      expect(canCleanup(worktreeStatus(path))).toBe(true) // so ignorado -> removivel (senao vazaria GB por run)
      writeFileSync(join(path, 'report.txt'), 'trabalho de verdade') // untracked NAO-ignorado
      expect(canCleanup(worktreeStatus(path))).toBe(false) // untracked real -> PRESERVA (nao perde trabalho)
    } finally {
      execFileSync('git', ['worktree', 'remove', '--force', path], { cwd: repo, stdio: 'pipe' })
    }
  })

  // Prova a logica EXATA do teardown do finish(): worktree sujo -> preserva; limpo -> remove.
  it('worktreeStatus+canCleanup: preserva quando o agente deixou mudancas, limpa quando vazio', () => {
    const { branch, path } = planWorktree(repo, 'rota', 'run-dirty')
    rmSync(path, { recursive: true, force: true }) // limpa orfao de uma run anterior que tenha falhado
    createWorktree(repo, branch, path)
    try {
      expect(canCleanup(worktreeStatus(path))).toBe(true) // recem-criado: limpo
      writeFileSync(join(path, 'novo.txt'), 'trabalho do agente') // agente escreveu algo
      expect(canCleanup(worktreeStatus(path))).toBe(false) // sujo -> finish PRESERVA (nao remove)
      expect(() => removeWorktree(repo, path)).toThrow() // sem --force, git recusa remover worktree sujo (nao perde trabalho)
    } finally {
      // Teste deixa o worktree sujo de proposito: limpa a forca so aqui pra nao vazar pro proximo run.
      execFileSync('git', ['worktree', 'remove', '--force', path], { cwd: repo, stdio: 'pipe' })
    }
  })
})
