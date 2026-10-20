# T01 — Modelo de Connection (provider-agnostic core)

**Frente:** Parte 0 · **Esforço:** M · **Depende de:** T00

## Objetivo
Remover o acoplamento ao Ollama/Qwen e ao seu PC. Substituir o union fechado `ProfileId = 'claude-max' | 'qwen-local'` e o `PROFILE_ENV` por um **modelo aberto de Connection** configurável, persistido no settings. Manter a execução via binário `claude` (não é reescrita do runner).

## Modelo proposto
```ts
type ConnectionKind = 'claude' | 'endpoint'   // 'endpoint' = Anthropic-compatível (Ollama, OpenAI-compat via shim, proxy)
interface Connection {
  id: string
  name: string
  kind: ConnectionKind
  baseUrl?: string      // endpoint
  model?: string        // endpoint (editável — fim do qwen3.6:35b hardcoded)
  tokenRef?: string     // ref no safeStorage (T02); nunca o valor
  extraEnv?: Record<string,string>
  bootCommand?: string  // ex. "ollama serve" (T04)
  healthUrl?: string    // ex. "http://localhost:11434/api/version" (T04)
}
```

## Escopo
- **Dentro:** tipo `Connection`; `resolveProviderEnv(conn)`; trocar os ~15 usos de `=== 'qwen-local'`; migração dos profiles antigos.
- **Fora:** UI (T03), segredo (T02), preflight/boot (T04). Provider de protocolo não-Anthropic (continua fora — "L").

## Arquivos (do mapa)
- `src/shared/types.ts:1` (`ProfileId`), `:152` (`AgentId`), contrato `TurnoApi:194-261`
- `src/main/runner.ts:12-28` (`QWEN_MODEL`, `PROFILE_ENV`), `:30-48` (`buildArgs`), `:36`, `:241`, `:251` (spawn env)
- `src/main/engine.ts:102` (lock gpu), `:184` (precheck)
- `src/main/routines.ts:28` (zod enum)
- renderer: `RoutineEditor.tsx`, `AdhocPanel.tsx`, `HistoryPanel.tsx:89`, `RunViewer.tsx:347,361`, `App.tsx:150-151,179`, `Sidebar.tsx:332`, `layout.ts:51`, `sidebarStore.ts:152-156,193`

## TDD (RED → GREEN)
Seam pura = `resolveProviderEnv(conn): Record<string,string>`.
1. **RED:** `resolveProviderEnv` p/ connection `endpoint {baseUrl, model, token}` deve retornar `ANTHROPIC_BASE_URL`, `ANTHROPIC_MODEL` (+ OPUS/SONNET/HAIKU/SUBAGENT), `ANTHROPIC_AUTH_TOKEN`, `CLAUDE_CODE_MAX_CONTEXT_TOKENS`, `API_TIMEOUT_MS`. Função não existe → falha.
2. **RED:** connection `claude` → env **vazio** (auth é do CLI).
3. **RED (migração):** `migrateProfiles(settings)` mapeia `claude-max`→connection claude; `qwen-local`→preset Ollama (`baseUrl=localhost:11434`, `model` do valor legado).
4. **GREEN:** implementar; trocar call sites; migração roda no boot.

## Blast radius / reversibilidade
- ~15 call sites — atualizar todos no mesmo PR.
- Muda shape persistido (`settings.json`, coluna `runs.profile`/`model` em `db.ts`) → **migração obrigatória**, sem editar migração já aplicada. Reversibilidade: **média**.

## Done
- Nenhum literal `qwen3.6:35b` / `localhost:11434` no `runner.ts`.
- Testes de `resolveProviderEnv` + migração verdes; `typecheck` verde.
