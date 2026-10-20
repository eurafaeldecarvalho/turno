import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { writeFileSync } from 'node:fs'
import { planWorktree, parseWorktrees, canCleanup, createWorktree, removeWorktree, worktreeDecision, worktreeStatus, resolveRepoRoot } from '../worktree'

describe('planWorktree (puro)', () => {
  it('gera branch Conventional e caminho FORA do repo, deterministico por run', () => {
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
  it('resume nao cria novo worktree (continua na worktree ja existente)', () => {
    expect(worktreeDecision({ ...base, isolation: 'worktree', resume: true, repoRoot: '/repo' })).toBeUndefined()
  })
  it('isolation worktree SEM repo git lanca (nunca roda no diretorio principal)', () => {
    expect(() => worktreeDecision({ ...base, isolation: 'worktree', repoRoot: undefined })).toThrow(/repositorio git/i)
  })
  it('isolation worktree com repo git devolve o plano (branch + path)', () => {
    const plan = worktreeDecision({ ...base, isolation: 'worktree', repoRoot: '/repo' })
    expect(plan).toEqual(planWorktree('/repo', 'rota', 'run-1'))
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
