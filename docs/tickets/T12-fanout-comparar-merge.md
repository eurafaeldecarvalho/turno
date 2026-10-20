# T12 — Fan-out: N agentes + comparar + merge (O2)

**Frente:** Orquestração · **Esforço:** L · **Depende de:** T07, T01

## Objetivo
Disparar o **mesmo prompt/rotina em N agentes em paralelo** (connections/modelos/worktrees diferentes), comparar os resultados lado a lado e **escolher o vencedor** pra aplicar/merge. Feature-assinatura do Orca/Crystal; casa com a política de diversidade de modelo.

## Escopo
- **Dentro:** orquestrar N runs (cada uma no seu worktree de T07); coletar resultados com **falha parcial tolerada** (`allSettled` — 1 agente falha, os outros seguem); painel de diff lado a lado; ação "aplicar este".
- **Fora:** merge automático sem humano (fica human-in-the-loop); resolução de conflito automática.

## Arquivos
- `src/main/fanout.ts` (novo: orquestra N child runs)
- `src/main/runner.ts` / `engine.ts` (dispara N)
- usa `src/main/worktree.ts` (T07)
- renderer: compare view (diff N-way)

## TDD (RED → GREEN)
Seam pura = máquina de estado `fanOut(n)` + coletor.
1. **RED:** 3 agentes, 1 rejeita → coletor retorna 2 resultados + 1 erro reportado (não derruba os outros).
2. **RED:** cada agente recebe worktree/branch distinto (sem colisão).
3. **RED:** "escolher vencedor" marca 1 e descarta/limpa os worktrees perdedores.
4. **GREEN:** implementar; runs mockadas no teste.

## Blast radius
- Cria N worktrees/branches — garantir cleanup dos perdedores (depende do `canCleanup` de T07).

## Done
- `fanOut` com falha parcial verde; disparar 3, comparar e aplicar 1 funciona (smoke).
