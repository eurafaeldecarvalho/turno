# T07 — Worktree por agente nativo (O1)

**Status:** ✅ FEITO — wiring no runner (`startRun`/`finish`) + engine (`runRoutine` passa `isolation`; `followUp` passa `run.cwd` + `isolation`), opção habilitada no RoutineEditor. Decisão pura `worktreeDecision` (none/já-em-worktree/sem-repo→erro). Teardown `worktreeTeardown`: só remove a worktree (E apaga a branch `turno/`) quando ela está **vazia de verdade** (nada não-commitado — untracked incluso via `--untracked-files=all` — E sem commits além da base, gravada em `git config turno.base` na criação); com trabalho (mudança OU commit) **PRESERVA** worktree+branch p/ revisar/mergear e p/ o follow-up continuar nela. Todo follow-up/resume de rotina isolada roda em worktree: continua na preservada ou **recria** uma (vazia já removida) — NUNCA no diretório principal. cwd canonicalizado (realpath, anti-symlink) e mapeado pra subpasta da rotina (`worktreeCwd`); subpasta ausente é criada com aviso. 24 testes (unit + integração git). Revisado por 3-gate em 3 rodadas (code-review/red-team/docs) — BREAK 1 (resume/follow-up fora da worktree), symlink, subpasta, vazamento de `--ignored`, vazamento de branches `turno/*` e recria-do-HEAD-incoerente corrigidos.

**Frente:** Orquestração · **Esforço:** M · **Depende de:** T00

## Objetivo
Rodar rotina/agente em **git worktree isolado + branch**, com cleanup ao fim. Padrão unânime da categoria (Claude Squad, Conductor, Crystal, Emdash): cada agente trabalha isolado, conflito só no merge. Opt-in por rotina (`isolation: 'worktree' | 'none'`, default `none`).

## Escopo
- **Dentro:** criar worktree+branch por run; usar como `cwd`; remover (worktree+branch) ao fim **só se vazia de verdade** (sem mudança não-commitada E sem commits) — ignorados (node_modules/dist) NÃO bloqueiam (regeneráveis); com trabalho, preserva; branch `turno/<slug-da-rotina>-<8 últimos chars do runId>`.
- **Fora:** merge/compare (isso é T12).

## Limitações conhecidas (aceitas, fail-closed)
- Dois follow-ups concorrentes na MESMA worktree viva (duplo-clique) podem correr; locks da rotina mitigam quando declarados.
- Se o usuário remover a worktree por fora (`git worktree remove`), um follow-up da run falha com mensagem clara (não roda no principal).
- Worktree órfã rara se `startRun` lançar entre `createWorktree` e o spawn (ex. disco cheio): fail-closed, sem teardown automático.

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
