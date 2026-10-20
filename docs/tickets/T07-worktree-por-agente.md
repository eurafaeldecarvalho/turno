# T07 — Worktree por agente nativo (O1)

**Status:** ✅ FEITO — wiring no runner (`startRun`/`finish`) + engine (`runRoutine` passa `isolation`; `followUp` passa `run.cwd` + `isolation`), opção habilitada no RoutineEditor. Decisão pura `worktreeDecision` (none/já-em-worktree/sem-repo→erro) + teardown `worktreeStatus`+`canCleanup` (limpo→remove, com mudança não-commitada→preserva; ignorado NÃO bloqueia, p/ não vazar build). Todo follow-up/resume de rotina isolada roda em worktree: continua na preservada (resume por limite OU run que terminou com mudanças) ou **recria** uma (worktree limpa já removida) — NUNCA cai no diretório principal. cwd canonicalizado (realpath, anti-symlink) e mapeado pra subpasta da rotina dentro da worktree (`worktreeCwd`); subpasta ausente é criada. 17 testes (unit + integração git). Revisado por 3-gate em 2 rodadas (code-review/red-team/docs) — BREAK 1 (resume/follow-up fora da worktree) + symlink/subpasta/vazamento-de-ignorados corrigidos.

**Frente:** Orquestração · **Esforço:** M · **Depende de:** T00

## Objetivo
Rodar rotina/agente em **git worktree isolado + branch**, com cleanup ao fim. Padrão unânime da categoria (Claude Squad, Conductor, Crystal, Emdash): cada agente trabalha isolado, conflito só no merge. Opt-in por rotina (`isolation: 'worktree' | 'none'`, default `none`).

## Escopo
- **Dentro:** criar worktree+branch por run; usar como `cwd`; remover ao fim **só se não houver mudanças não commitadas** — arquivos ignorados (node_modules/dist) NÃO bloqueiam (regeneráveis; senão vazaria GB por run); branch `turno/<slug-da-rotina>-<8 últimos chars do runId>`.
- **Fora:** merge/compare (isso é T12).

## Arquivos
- `src/main/worktree.ts`: `planWorktree`, `worktreeDecision`, `createWorktree`, `removeWorktree`, `worktreeStatus`, `canCleanup`, `resolveRepoRoot`, `worktreeCwd`, `isManagedWorktreePath`, `worktreeMainRoot`
- `src/main/runner.ts` (`startRun` cria/mapeia o `cwd`; `finish` faz o teardown) + `src/main/engine.ts` (`runRoutine` passa `isolation`; `followUp` passa `run.cwd`)
- `src/main/routines.ts` (campo `isolation` no schema) + `src/main/db.ts` (`cwd` atualizável)

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
