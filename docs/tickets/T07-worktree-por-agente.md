# T07 — Worktree por agente nativo (O1)

**Status:** ✅ FEITO — wiring no runner (`startRun`/`finish`) + engine (`runRoutine` passa `isolation`), opção habilitada no RoutineEditor. Decisão pura `worktreeDecision` (none/resume/sem-repo→erro) + teardown `worktreeStatus`+`canCleanup` (limpo→remove, sujo→preserva). 12 testes (unit + integração git). Resume/pausa mantêm a worktree (cleanup só na run terminal fresca).

**Frente:** Orquestração · **Esforço:** M · **Depende de:** T00

## Objetivo
Rodar rotina/agente em **git worktree isolado + branch**, com cleanup ao fim. Padrão unânime da categoria (Claude Squad, Conductor, Crystal, Emdash): cada agente trabalha isolado, conflito só no merge. Opt-in por rotina (`isolation: 'worktree' | 'none'`, default `none`).

## Escopo
- **Dentro:** criar worktree+branch por run; usar como `cwd`; remover ao fim **só se não houver mudanças não commitadas** (gotcha do próprio workspace); nome de branch Conventional (`<type>/turno-<routine>-<runId>`).
- **Fora:** merge/compare (isso é T12).

## Arquivos
- `src/main/worktree.ts` (novo): `planWorktree`, `createWorktree`, `cleanupWorktree`
- `src/main/runner.ts:251` (usa o `cwd` do worktree)
- `src/main/routines.ts:28` (campo `isolation`)

## TDD (RED → GREEN)
Seam pura = `planWorktree(repoRoot, routineId, runId)` + parser de `git worktree list --porcelain`.
1. **RED:** gera `{ branch, path }` únicos e determinísticos por run; path fora da pasta do repo.
2. **RED:** parser lê a saída porcelain e lista worktrees existentes (p/ não colidir).
3. **RED:** `canCleanup(status)` → `true` só com working tree limpo.
4. **GREEN:** implementar; 1 teste de integração opcional num repo git temporário.

## Blast radius / reversibilidade
- Muda `cwd` da run. Reversível (fácil). Cuidado: dois worktrees não podem ter a mesma branch.

## Done
- `planWorktree`/parser/`canCleanup` verdes; rotina `isolation: worktree` roda isolada e limpa ao fim.
