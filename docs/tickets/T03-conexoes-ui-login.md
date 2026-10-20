# T03 — Aba "Conexões" + fluxo de login

**Frente:** Parte 0 · **Esforço:** M · **Depende de:** T01, T02

## Objetivo
Área de conexão dentro do app. Settings → **Conexões** com cards por provider. Rotina e ad-hoc passam a **escolher uma Connection** (fim do seletor `claude/qwen`).

## Comportamento por card
- **Claude:** botão **Conectar** = `claude auth login` (abre browser OAuth); status = `claude auth status`; **Desconectar** = `claude auth logout`. **Não** coleta senha (sessão fica no CLI). Ver [T04] p/ "claude não instalado".
- **+ Provider (endpoint):** form `nome / baseUrl / token / model`. Token → T02.
- **Ollama:** preset do "+ Provider" (baseUrl local + `bootCommand: ollama serve`).

## Arquivos
- `src/renderer/src/panels/ConnectionsPanel.tsx` (novo) + registro em `App.tsx:42-48`
- `src/preload/index.ts` + `TurnoApi`: grupo `provider:*` (claudeStatus/claudeLogin/claudeLogout/setToken/deleteToken/preflight). CRUD de connection via `settings:set` (campo `connections`), nao canais proprios.
- `src/main/index.ts:187-258` (handlers ipc)
- `RoutineEditor.tsx` / `AdhocPanel.tsx`: seletor de connection no lugar do profile

## TDD (RED → GREEN)
Seam pura = store/reducer de connections + validação zod do form.
1. **RED:** `connectionsReducer` add/edit/remove/select — add gera id único; remove da selecionada reseta seleção.
2. **RED:** `validateConnectionForm` — endpoint exige `baseUrl` e `model`; nome não-vazio; claude dispensa baseUrl.
3. **GREEN:** implementar; UI consome o store. UI/login real via `smoke`.

## Done
- Reducer + validação verdes. Criar/editar/remover connection e selecioná-la numa rotina funciona (smoke).
