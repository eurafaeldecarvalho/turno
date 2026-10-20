# T07 — Worktree por agente nativo (O1)

**Status:** ✅ FEITO — wiring no runner (`startRun`/`finish`) + engine (`runRoutine` passa `isolation`; `followUp` passa `run.cwd`), opção habilitada no RoutineEditor. Decisão pura `worktreeDecision` (none/resume/sem-repo→erro) + teardown `worktreeStatus`(`--ignored`)+`canCleanup` (limpo→remove, sujo/ignorado→preserva). Resume por limite roda NA worktree preservada e o segmento retomado faz o teardown ao terminar limpo (sem vazar). cwd mapeado pra subpasta da rotina dentro da worktree (`worktreeCwd`). 16 testes (unit + integração git). Revisado por 3-gate (code-review/red-team/docs) — BREAK 1 (resume fora da worktree) corrigido.

**Frente:** Orquestração · **Esforço:** M · **Depende de:** T00

## Objetivo
Rodar rotina/agente em **git worktree isolado + branch**, com cleanup ao fim. Padrão unânime da categoria (Claude Squad, Conductor, Crystal, Emdash): cada agente trabalha isolado, conflito só no merge. Opt-in por rotina (`isolation: 'worktree' | 'none'`, default `none`).

## Escopo
- **Dentro:** criar worktree+branch por run; usar como `cwd`; remover ao fim **só se não houver mudanças não commitadas nem ignoradas** (gotcha do próprio workspace); branch `turno/<slug-da-rotina>-<8 últimos chars do runId>`.
- **Fora:** merge/compare (isso é T12).

## Arquivos
- `src/main/worktree.ts`: `planWorktree`, `worktreeDecision`, `createWorktree`, `removeWorktree`, `worktreeStatus`, `canCleanup`, `resolveRepoRoot`, `worktreeCwd`, `isManagedWorktreePath`, `worktreeMainRoot`
- `src/main/runner.ts` (`startRun` cria/mapeia o `cwd`; `finish` faz o teardown) + `src/main/engine.ts` (`runRoutine` passa `isolation`; `followUp` passa `run.cwd`)
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
