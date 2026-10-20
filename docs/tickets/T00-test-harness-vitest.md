# T00 — Harness de testes (Vitest)

**Frente:** base · **Esforço:** S · **Depende de:** —

## Objetivo
Habilitar TDD no main process. Hoje não há runner (só `typecheck` e `smoke`). Sem runner não existe "teste vermelho", então este é o pré-requisito de todos os outros.

## Escopo
- **Dentro:** adicionar `vitest` + config (projeto já é Vite/electron-vite), script `test` e `test:watch`, 1 teste provando o runner. Ambiente `node` (lógica do main é testável fora do Electron).
- **Fora:** testar UI React / integração Electron (fica no `smoke`). Cobertura/CI.

## Arquivos
- `package.json` (devDep `vitest`, scripts)
- `vitest.config.mts` (novo — extensao `.mts` p/ ESM sem warning) — `environment: 'node'`, resolve alias se usado
- `tsconfig` — garantir que `*.test.ts` compilam

## TDD (RED → GREEN)
1. **RED:** criar `src/main/__tests__/smoke.test.ts` com um `expect(1+1).toBe(2)` e rodar `pnpm test` → falha (runner inexistente / script ausente). Colar o vermelho.
2. **GREEN:** instalar vitest, config + script → `pnpm test` verde. Colar o verde.
3. **REFACTOR:** remover o teste trivial quando T01 trouxer o primeiro teste real (ou mantê-lo como sentinela).

## Done
- `pnpm test` roda e passa localmente.
- `pnpm typecheck` segue verde.

## Notas
- Confirmar interação com `externalizeDepsPlugin`/node-pty (não importar node-pty em teste de lógica pura).
