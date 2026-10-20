# T04 — Preflight / Diagnóstico de provider

**Frente:** Parte 0 · **Esforço:** M · **Depende de:** T01 (melhor com T03)

## Objetivo
Checar a dependência **antes** de conectar/rodar e guiar a instalação do que falta. "Existe na máquina?" só se aplica a provider **local**; endpoint remoto se verifica por rede.

## Checagem por tipo
| Tipo | Checa |
|---|---|
| Claude | `claude --version` existe → `claude doctor` saudável → `claude auth status` logado |
| Ollama (endpoint local c/ bootCommand) | binário `ollama` existe → daemon no `healthUrl` |
| Endpoint remoto | pingar `baseUrl` + validar token (chamada barata) — **não** checa binário |

## Instalação guiada (modal)
Dep local faltando → modal com: (1) o que falta e por quê; (2) instruções OS-aware + **copiar comando**; (3) **"Instalar pra mim" (opcional)** rodando o comando **num terminal visível do próprio app** (xterm/node-pty já existem) — nunca silencioso; re-checa com `claude doctor` ao fim.
- **Ovo-galinha:** se `claude` ausente, usar o **bootstrap oficial** (não `claude install`, que exige o claude já instalado). Puxar o comando atual da fonte oficial na hora, não de memória.

## Arquivos
- `src/main/doctor.ts` (novo): `checkConnection(conn): PreflightResult`
- `src/main/engine.ts:137-190` (integra ao precheck: rotina com provider off **pula com motivo**, não quebra)
- renderer: modal + mini painel "Diagnóstico"

## TDD (RED → GREEN)
Seam pura = `classifyPreflight(raw): {state, action}` com `state ∈ {ok, missing_binary, unhealthy, not_logged_in, endpoint_unreachable, bad_token}`.
1. **RED:** version ausente → `missing_binary` + ação "instalar".
2. **RED:** binário ok mas `auth status` não logado → `not_logged_in` + ação "conectar".
3. **RED:** endpoint remoto sem resposta → `endpoint_unreachable` (nunca "instalar").
4. **GREEN:** implementar; chamadas externas (execFile/fetch) mockadas.

## Done
- Mapeamentos verdes. Rotina com provider off pula com motivo claro.
