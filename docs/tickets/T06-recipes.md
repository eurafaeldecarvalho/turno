# T06 — Recipes (templates de rotina) (R1)

**Frente:** Rotinas · **Esforço:** S · **Depende de:** T00 (idealmente T01 p/ connection na recipe)

## Objetivo
Catálogo de rotinas prontas instaláveis, pra baixar a barreira (hoje o dev monta o prompt do zero). Ex.: "revise PRs abertos 9h", "resuma commits da noite", "cheque CI quebrado", "docs-drift".

## Escopo
- **Dentro:** catálogo (data) de recipes; ação "usar recipe" que materializa a pasta `ROUTINE.md` (frontmatter + prompt) preenchida, editável antes de salvar.
- **Fora:** marketplace/compartilhar recipe (backlog).

## Arquivos
- `src/main/recipes.ts` (novo, catálogo) + canal `routines:template` (já existe)
- `src/main/routines.ts:75-110` (serialize/validação zod — reusar)
- renderer: picker de recipe no fluxo de nova rotina

## TDD (RED → GREEN)
Seam pura = `materializeRecipe(recipe, overrides): { config, prompt }`.
1. **RED:** recipe "resumo de commits" → `config` válido contra o **zod schema existente** + `prompt` não-vazio.
2. **RED:** `overrides` (horário, connection, cwd) sobrescrevem os defaults da recipe.
3. **RED:** recipe inválida → erro de validação (não cria pasta).
4. **GREEN:** implementar; UI chama e grava via `saveRoutine`.

## Done
- `materializeRecipe` verde; criar rotina a partir de recipe gera `ROUTINE.md` válido.
