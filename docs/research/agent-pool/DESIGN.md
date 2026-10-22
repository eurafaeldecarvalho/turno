# Turno: design do botão "Agent" (sessões multi-agente ranqueadas com troca automática no limite)

Data: 21/10/2026. Autor: arquiteto (workflow de pesquisa). Status: proposta, nada implementado. Nenhum arquivo do Turno foi editado.

Base: as oito notas em `C:\rx\notes`: orca-agents.md, orca-tasks.md, cux.md, limits.md, compliance.md, handoff.md, connectivity.md e turno.md. As referências de arquivo e linha vêm delas.

Legenda:
- **[V]** verificado em fonte primária (docs oficiais, código do fornecedor ou código local).
- **[O]** visto no código do Orca/CodexBar (MIT); o endpoint é engenharia reversa, sem documentação do fornecedor.
- **[S]** fonte secundária.
- **[N]** não verificado ou inferência.

Nada foi executado contra contas reais.

---

## 1. Resumo executivo: a melhor e mais eficaz forma

**Ideia central.** O Turno passa a ser o dono da conversa. A sessão de cada fornecedor (Claude, Codex, Kiro…) vira uma "tentativa" descartável dentro dela. É a separação Task/Dispatch do Orca (`orca-tasks.md` §1-2). Trocar de conta ou de agente é encerrar uma tentativa e abrir a próxima na mesma aba, com um pacote de continuação.

1. **Conta = (agente CLI, pasta de config isolada).**
   - Cada conta tem a própria home: `CLAUDE_CONFIG_DIR`, `CODEX_HOME`, `KIRO_HOME`, `COPILOT_HOME`, `GROK_HOME`, `XDG_DATA_HOME` para OpenCode etc.
   - O login é feito pelo usuário com o comando oficial do fornecedor, num terminal visível do Turno.
   - O Turno **nunca lê, copia, renova nem guarda token de assinatura**. É o modelo do Orca, e é o único compatível com os termos da Anthropic (`compliance.md` §3).
2. **Ranking.**
   - O usuário ordena as contas.
   - Ao abrir um Agent, o broker escolhe a de maior rank que esteja `ok` (abaixo do limiar e fora de cooldown).
   - O padrão mistura fornecedores diferentes.
3. **Monitor de limite em três camadas** (`limits.md` §0).
   - **Push durante a sessão (melhor).**
     - Claude: o `statusLine` recebe `rate_limits.five_hour/seven_day.used_percentage` a cada resposta [V], mais o hook `StopFailure` com `error=rate_limit` [V].
     - Codex: `token_count.rate_limits` no rollout, ou `account/rateLimits/updated` no app-server [V].
   - **Poll esparso**, só para ranquear contas ociosas.
   - **"Parede"**: classificador conservador de erros e textos.
4. **Gatilho proativo.**
   - Quando uma janela passa de ~90%, o broker marca `warning`.
   - No fim do turno seguinte, ainda com cota, ele pede à própria sessão um checkpoint curto (feito / descoberto / falta). Esse checkpoint alimenta o handoff.
   - Ao chegar no limite, ou de forma proativa se o usuário quiser, a troca acontece **entre turnos**, nunca no meio de uma chamada de ferramenta.
5. **Troca na mesma aba.**
   - O painel dockview e o xterm ficam. Só muda o processo pty.
   - O pty antigo é cercado por um contador de geração, para que eventos atrasados sejam ignorados.
   - Uma faixa aparece no terminal: "── continuado em Codex · conta B (motivo: limite 5h 92%, volta 14:00) ──".
6. **Handoff em camadas.**
   - **T1, mesmo agente:** o resume nativo da *mesma transcrição* sob outra conta tem perda quase zero. Para o Claude é `claude --resume <caminho absoluto .jsonl>` com o novo `CLAUDE_CONFIG_DIR` [V docs].
   - **T2, agente diferente:** pacote estruturado como primeiro prompt da nova sessão. Contém resumo ancorado, últimas mensagens literais, estado do git, plano/todo e lista de arquivos para reler.
   - Trocar de agente **sempre perde algo**. Não existe importação de histórico entre agentes; nem o ACP permite isso.
7. **Conformidade.**
   - Troca automática **entre fornecedores diferentes**: liberada.
   - **Várias contas do mesmo fornecedor**: opt-in, com modo "Perguntar" por padrão e aviso citando a cláusula.
   - **Proibido**: proxy de tokens (estilo 9Router/OmniRoute), várias contas grátis do mesmo fornecedor e automação de cadastro.

**Por que essa é a forma mais eficaz.** Ela reaproveita o que o Turno já tem:
- O `TermHandle` desacoplado do painel (`TerminalPanel.tsx` L28-44, L97-100).
- A `RunViewer` que já move o `head` para a run seguinte com a tela aberta (`RunViewer.tsx` L469-487).
- O `parseRateLimit` já existente. Hoje ele descarta `allowed_warning` (`abort.ts`).
- O `ai.ts`, como molde de sumarizador sem ferramentas.

Ela também se apoia só em sinais oficiais. E evita o que derrubou outras ferramentas: troca global de credenciais (cux), proxies (9Router/OmniRoute) e polling agressivo de endpoint não documentado.

---

## 2. O que aprendemos do Orca (agents e tasks) e do cux, e o que reaproveitar

### 2.1 Orca: subsistema de agents (MIT, código reaproveitável com atribuição)

Fonte: `C:\rx\orca`, versão 1.4.214. O build instalado (1.4.237) bate com o fonte.

**O Orca não tem troca automática nem fallback.** O grep por `autoSwitch`/`rotate` deu 0 resultados no fonte e 0 no asar. A troca é manual, e no limite ele só oferece "Continue where you left off." (`shared/native-chat-usage-limit-cut.ts:11`). Mas tem todas as peças, listadas abaixo com o que o Turno faz com cada uma.

| Peça do Orca | Arquivo(s) | Reaproveitar no Turno |
|---|---|---|
| Catálogo declarativo de 44 agentes CLI: detectar, lançar, injetar prompt, `--prefill`, trust | `shared/tui-agent-config.ts`, `tui-agent-detection-commands.ts`, `main/preflight/agent-detection.ts` | Base do `AgentDriver` registry. A detecção é só uma busca no PATH, sem checar login |
| Tabela de resume por agente | `shared/agent-resume-argv.ts:6-81` | Campo `resumeArgv` no driver: `claude --resume`, `codex resume`, `agy --conversation`, `kiro-cli --resume-id`, `copilot --resume=` … |
| Conta Claude = `CLAUDE_CONFIG_DIR` próprio em `<userData>/claude-profiles/<uuid>/home` | `main/claude-accounts/*` | Mesmo modelo, em `%APPDATA%\turno\profiles\<id>\home` |
| Provisionamento: diretórios ligados por junction, arquivos copiados, `CLAUDE.md` vira `@import`, `.claude.json` mesclado sem `oauthAccount` | `claude-profile-provisioning.ts:266-318`, `claude-profile-sharing.ts:56` | Copiar a lógica com atribuição MIT |
| **Histórico compartilhado**: `projects, session-env, file-history, shell-snapshots, todos, paste-cache, tasks, plans, transcripts` viram junctions para `~/.claude`; `sessions` não | `claude-profile-history.ts:28-39` | É o que faz `--resume <id>` funcionar em qualquer conta (handoff T1) |
| Antes de apagar o perfil, desfaz as junctions; senão o delete recursivo apaga o histórico real | `claude-account-folder.ts:172-199` | Obrigatório |
| Login oculto `claude auth login` na pasta nova, depois leitura de `oauthAccount.emailAddress` | `claude-account-registration.ts:49-142` | No Turno o login fica **visível**, num terminal. O rótulo é lido do `.claude.json` |
| `CLAUDE_CONFIG_DIR` com o caminho padrão quebra o login padrão (o nome do item no keychain depende do texto exato) | `claude-config-dir-pin.ts:30-50` | Só definir a variável para homes que não sejam a padrão. A conta "System default" é o `~/.claude` do usuário |
| Feed do statusline: script que não imprime nada e envia `rate_limits` + `CLAUDE_CONFIG_DIR` para o loopback, no máximo 1 vez a cada 15 s por pane | `main/claude/statusline-script.ts`, `shared/claude-statusline-rate-limits.ts` | **Principal detector "perto do limite"**. Não gasta cota |
| Eventos de limite estruturados: `rate_limit_event{allowed\|allowed_warning\|rejected}`, `usageLimitExceeded`, ACP `stopReason: rate_limit`, todos normalizados num só fato | `claude-usage-limits.ts:53-120`, `codex-usage-limits.ts`, `acp-turn-failures.ts:100-121`, `shared/agent-session-usage-limit.ts` | Formato normalizado `LimitState` |
| Poll de uso: 15 min por padrão, mínimo 30 s, respeita Retry-After, contas inativas só ao abrir o seletor | `main/rate-limits/service/*` | Ranking de contas ociosas. Raro e opt-in para endpoint não documentado |
| Mover sessão para outra conta: espera o fim do turno, mata o processo e roda `--resume` no **mesmo pane** | `claude-session-account-move.ts:180-219`, `pane-account-restart-readiness.ts:6-16`, `agent-account-restart-startup.ts:43-134` | Esqueleto do `broker.swap` |
| Codex: `CODEX_HOME` por conta, com hardlink dos rollouts de outras homes para o `/resume` enxergar | `runtime-home-service-managed-home.ts:127-170` | Útil, mas o resume entre contas Codex esbarra no raciocínio cifrado preso à organização (§3.6) |
| ACP: account binding = "uma pasta de config nomeada por variável de ambiente"; `session/load`, senão `session/resume` | `main/acp/acp-account-binding.ts:28-73`, `acp-session-setup.ts:34-62` | Caminho único para todos os agentes ACP (fase 4) |
| AI Vault: índice de sessões de todos os agentes, só leitura | `main/ai-vault/*` | Leitor de transcrições para montar o handoff |
| `AgentSessionRecord.providerHandleChain` | `shared/agent-session-record.ts:144-160` | Linhagem da conversa: `{agent, account, nativeId, reason}` |

### 2.2 Orca: subsistema de tasks/orquestração

Fonte: `orca-tasks.md`. Lições aplicáveis:
- **Estado durável fora do agente.** Tarefas e despachos ficam em SQLite (`orchestration.db`). Uma tentativa nova (`dispatch_contexts`, com `retry_of_dispatch_id` e `failure_count`) não carrega a transcrição antiga sozinha. Quem monta o contexto é o coordenador.
- **Geração e cerca.** O `run-use` incrementa `consumer_generation` e cerca as entregas não confirmadas do consumidor antigo (`db/runs/run-binding.ts:124-180`). No Turno: cada troca incrementa `generation`, e saída ou eventos do pty antigo são descartados.
- **Pacote de contexto** (`preamble.ts:70-164`):
  - identidade;
  - receitas com regras em comentários junto dos exemplos;
  - resumo em 3 frases (feito / descoberto / falta);
  - bloco `=== TASK ===`.
  - O texto é **plano, sem regras gritadas**: o Claude Code trata colagem gritada como possível prompt injection (L83-86).
  - Contexto grande vai para um arquivo, e o prompt só aponta o caminho (`worker_prompt_too_large`).
- **Entrega.**
  - Bracketed paste em blocos de 16 KiB, serializada por pty.
  - Antes de colar, espera o compositor do agente ficar pronto.
  - Depois, verifica se o turno começou.
  - **Nunca cola de novo** se não houver confirmação (#16095).
- **Circuit breaker.** Três falhas de início seguidas encerram a tentativa. A tarefa volta para `ready`, não `pending`. Falhas de launch contam; um "falhei" do próprio agente não conta.
- **Decision gates** nunca se resolvem sozinhos. No Turno: "Aprovar troca para outro fornecedor ou tier?", com a resposta anexada ao handoff.
- **O que não serve.** O Orca não tem detecção de limite nem ranking na orquestração (verificado por grep). A tela "Tasks" dele é de issues GitHub/Linear/Jira.

### 2.3 cux (GPL-3.0: só ideias, nenhum código)

Fonte: `cux.md`.
- **Detecção reativa por hooks.** `StopFailure` com `error=rate_limit`, uma lista de frases fortes ("usage limit", "hit your limit", "weekly limit"…) e uma **denylist** ("context window", "max tokens", "concurrent subagent", conteúdo HTML ou URL). Ela existe porque um classificador amplo matou 20 subagentes (#39).
- **Hooks inertes fora do wrapper.** Só agem com `CUX_WRAPPED=1`. Copiar a ideia com `TURNO_AGENT_SESSION`.
- **Momento da troca.**
  - Proativa: no `Stop` (fim do turno, transcrição gravada).
  - Na parede: imediata, porque uma conta capada pode nunca emitir outro Stop.
  - Antes do prompt: se a conta está em 100%, troca antes de enviar.
- **Parque.** Se não há conta livre, **não mata** a sessão. Mostra a contagem até o `resets_at` mais próximo e retoma quando liberar (#48/#50).
- **Cap por modelo** ("Opus limit"): tenta outro modelo na mesma conta antes de rodar a conta (#52/#57).
- **Variáveis que escondem o limite:** `CLAUDE_CODE_RETRY_WATCHDOG` e `CLAUDE_CODE_MAX_RETRIES>=10` (#56). O Turno deve removê-las do env da sessão.
- **Mensagem de continuação.** Só nas trocas automáticas ("Go continue."); nas manuais, não. Repassar as flags que o resume não restaura: `--model`, `--mcp-config`, `--settings`, `--add-dir`…
- **O que não copiar:**
  - troca **global** de `~/.claude/.credentials.json`, que afeta todas as sessões da máquina e leva junto os logins MCP;
  - refresh de token com o client_id do Claude Code;
  - dependência de "o Claude relê credenciais a cada request" [N];
  - o bug de caminho no Windows: cux codifica `-C:-Users-…` e o Claude usa `C--Users-…`. Usar o `transcript_path` do hook;
  - kill duro no Windows sem matar a árvore de processos.

---

## 3. Arquitetura no Turno

### 3.0 Visão geral

```
Renderer                                   Main
┌──────────────────────┐   IPC    ┌───────────────────────────────────────────┐
│ Botão Agent + seletor│ ───────▶ │ accounts.ts  (registro + ranking)         │
│ agentStore.ts        │          │ profiles.ts  (homes isolados, junctions)  │
│ TerminalPanel        │ ◀─────── │ drivers/     (AgentDriver por CLI)        │
│  └ TermHandle.swapPty│ agent:*  │ limits.ts    (LimitProbe push/poll/wall)  │
│ Faixa "continuado em"│          │ hookserver.ts(loopback: statusline/hooks) │
│ Painel de handoff    │          │ broker.ts    (conversa, tentativas, swap) │
└──────────────────────┘          │ handoff.ts   (extrator + sumarizador)     │
                                  │ db.ts        (agent_conversations, ...)   │
                                  └───────────────────────────────────────────┘
```

### 3.1 Registro de agentes e contas, com config dir isolado por conta

**Driver (código, em main).** `src/main/agents/drivers.ts`, inspirado em `tui-agent-config.ts` e `agent-resume-argv.ts` do Orca (MIT):
```ts
interface AgentDriver {
  id: 'claude'|'codex'|'agy'|'gemini'|'copilot'|'kiro'|'cursor'|'opencode'|'qwen'|'amp'|'grok'|'kimi'|'goose'|'endpoint'|...;
  binary: string; detect: string[];              // busca no PATH (where)
  homeVar?: string;                              // CLAUDE_CONFIG_DIR, CODEX_HOME, KIRO_HOME, COPILOT_HOME, GROK_HOME...
  loginCmd?: string[];                           // ex.: ['claude','auth','login'], ['codex','login']
  newArgv(opts): string[]; resumeArgv?(id|path): string[];
  promptInjection: 'argv'|'flag'|'paste-after-ready';
  readyMarker?: RegExp;                          // compositor pronto (para colar o handoff)
  sessionLocator?(home, cwd): Promise<{id, transcriptPath}|null>;
  limitProbes: LimitProbe[];                     // push / poll / wall
  sameAgentResume: 'verified'|'unverified'|'blocked';  // T1 permitido?
  stripEnv?: string[];                           // ex.: CLAUDE_CODE_RETRY_WATCHDOG
}
```

**Conta (dados do usuário).** Ficam em `%APPDATA%\turno\accounts.json`, um arquivo novo, fora do `settings.json`:
- O `validConn` de `settings.ts` L55-56 descartaria tipos desconhecidos.
- O `connections` é substituído inteiro a cada gravação.
- O padrão do arquivo novo é o mesmo do `sidebar.ts`: `readJson`/`writeJsonAtomic` + `reportBadShape`.

```ts
interface AgentAccount {
  id: string; agent: AgentDriver['id']; label: string;   // "Claude Max · rafael@…"
  rank: number; enabled: boolean;
  home: string | 'system-default';     // %APPDATA%\turno\profiles\<id>\home
  connectionId?: string;               // tier API/endpoint (OpenRouter, Ollama, Anthropic API)
  plan?: 'free'|'pro'|'max'|'api'|'local';
  switchMode: 'manual'|'ask'|'auto';   // por conta/fornecedor (ver §5)
  thresholds?: { fiveHour?: number; weekly?: number; monthly?: number };
  consentAt?: string;                  // aceite do aviso de ToS (same-provider)
}
```

O estado de uso em tempo real (`account_usage`) fica no SQLite, com migração por `user_version`, para não regravar JSON a cada tick.

**Provisionamento** (`src/main/profiles.ts`):
- **Claude**, seguindo o Orca:
  - junction para os diretórios de histórico listados em §2.1;
  - junction para skills/agents/commands/plugins;
  - cópia de `settings.json`;
  - `CLAUDE.md` vira `@~/.claude/CLAUDE.md`;
  - `.claude.json` mesclado sem `oauthAccount` e os caches de org/modelo.
- Escreve **apenas** dentro de `profiles\<id>`.
- **Codex:** `CODEX_HOME` próprio, com `config.toml` espelhado. Recomendar `cli_auth_credentials_store=keyring` [V docs].
- **Demais agentes:** a variável de home da tabela §4.

**Login:**
- O botão "Conectar conta" abre uma aba de terminal com `env[homeVar]=<home>` e roda `loginCmd`. O usuário conclui o OAuth no navegador.
- Depois o Turno só **detecta** o resultado: lê `oauthAccount.emailAddress` ou roda `auth status`.
- Corrigir `provider-auth.ts` para aceitar `env` por conta. Hoje ele usa só `childEnv()`.

**Pontos do Turno que assumem uma única pasta** (`turno.md` §6B):
- `termsessions.ts`: um watcher só, preso ao primeiro diretório (L99-108). Passa a ter um watcher por home.
- `sidebar.ts`: `listClaudeSessions`/`projectsDir`.
- `claudeprep.ts`: `configFile()` precisa receber a home.
- `provider-auth.ts`.

### 3.2 Ranking

**Seleção** (`accounts.pick({agent?, cwd, exclude[]})`): das contas `enabled`, fica a de menor `rank` que cumpra três condições:
1. o estado é `ok`, ou `unknown`, que conta como "tem espaço" (lição cux #37);
2. todas as janelas estão abaixo do limiar (padrão 5h < 90%, semanal < 95%, mensal < 90%);
3. não está em `cooling` até `resetsAt`.

**Desempates:**
- Primeiro, a reserva semanal: preferir contas com mais folga semanal quando a de 5h empata.
- Depois, o `resetsAt` mais próximo.

**Política opcional "drenar"** (cux `drain`): esgotar a de rank 1 antes de passar à 2. É o padrão, porque respeita a ordem do usuário.

**Limite por modelo** (Opus/Sonnet, `limit_id` do Codex): antes de rodar a conta, tentar o modelo alternativo na mesma conta, se o usuário permitir.

**Regras do motor de troca:**
- **Circuit breaker:** 3 falhas de *launch* seguidas pausam a conversa e avisam o usuário.
- **Cooldown:** no máximo N trocas por hora (padrão 6).
- **Histerese:** não voltar para uma conta antes do `resetsAt`, mesmo que o poll mostre queda.

### 3.3 Botão Agent e seletor

O botão Agent substitui os três lançadores fixos de Claude (`turno.md` §1):
- `Sidebar.tsx` L444-446: o botão "Claude" vira "Agent".
- `App.tsx` L216-224: itens do menu "+" do grupo.
- `App.tsx` L259-261: tela Welcome.

**Comportamento:**
- **Clique simples:** "Auto (melhor disponível)" pelo ranking global, abrindo o terminal com o driver e a conta escolhidos.
- **Seta ou clique direito:** menu com
  - "Auto";
  - cada agente instalado (detectado no PATH), com submenu de contas e um badge `5h 42% · sem 61%` ou `esgotado até 14:00`;
  - "Gerenciar contas…".
- Reaproveitar os padrões `new-term-dropdown` e `menuKeyNav`.
- **Atalho novo:** Ctrl+Shift+A.
- **Identificação de abas de agente:** uma função única `agentOf(panel)` que lê `params.agentConversationId`. Ela substitui as heurísticas duplicadas em `layout.ts` L117, `App.tsx` L111 e `Sidebar.tsx` L18-46.
- **Subtítulo da aba:** "Claude · conta 2 · handoff 1".

**Configurações:** nova seção "Agentes e contas" em `SettingsPanel`, ao lado de `ConnectionsSection`. Tem:
- uma lista arrastável (rank);
- o modo de troca por conta;
- limiares;
- botão "Conectar" (login visível) e "Remover" (desfaz as junctions antes de apagar).

### 3.4 Monitor de limite (`src/main/limits.ts` + `hookserver.ts`)

**Registro normalizado** (`limits.md` §12):
```ts
{ accountId, agent, windows:[{kind:'5h'|'weekly'|'monthly'|'daily'|`model:${string}`, usedPct, resetsAt}],
  state:'ok'|'warning'|'exhausted'|'unknown', source:'push'|'poll'|'wall', observedAt }
```

**Sinais por agente** (detalhes em §4):

1. **Claude, modo terminal (MVP).**
   - Cada sessão é lançada com `--settings <arquivo-da-sessão.json>` [V: a flag aceita JSON ou arquivo]. **Não se edita `~/.claude` nem o `settings.json` do perfil.** Esse arquivo leva:
     - `statusLine.command`: um script que encaminha o stdin (JSON com `rate_limits`, `session_id`, `transcript_path`) para `http://127.0.0.1:$TURNO_HOOK_PORT/statusline` com o token `TURNO_HOOK_TOKEN`. Throttle de 15 s, e nada é impresso.
       - No Windows: `curl.exe`, que vem com o Windows 10 1803+, ou um `.cmd` que chama o Electron com `ELECTRON_RUN_AS_NODE=1` só no próprio comando [N, medir a latência].
       - Se o usuário já tem um `statusLine`, encadear: chamar o dele e repassar a saída.
     - Hooks `StopFailure` (matcher `rate_limit`), `Stop`, `SessionStart` (captura `session_id` e `transcript_path`) e `Notification` (`quota_auto_resume_*`). Todos inertes sem `TURNO_AGENT_SESSION`.
     - `"autoContinueAtUsageLimit": false` [V settings-reference]. Sem isso, a sessão fica parada esperando o reset (padrão desde a v2.1.234).
   - Remover do env `CLAUDE_CODE_RETRY_WATCHDOG` e `CLAUDE_CODE_MAX_RETRIES`.
   - Fallback para pty: regex sobre o texto de pré-aviso "You've used 85% of your session limit · resets …" e de parede "You've hit your … limit · resets …" [V errors.md], com ANSI removido. Fica numa derivação de `pty.onData` em `pty.ts` L63.
2. **Claude, modo headless (rotinas, `runner.ts`).**
   - O `rate_limit_event` com `allowed_warning` vira `warning`; `rejected` vira `exhausted` [V sdk.d.ts L5870].
   - Hoje o `abort.ts` analisa e descarta o `allowed_warning`. Basta parar de descartar.
3. **Codex.**
   - Ler o rollout `$CODEX_HOME/sessions/**/rollout-*.jsonl`, eventos `token_count.rate_limits` (primary/secondary `used_percent`, `resets_at`) [V struct].
   - Ou rodar via `codex app-server` (`account/rateLimits/updated`).
   - Parede: `UsageLimitExceeded`, ou "You’ve hit your usage limit" (com apóstrofo U+2019).
4. **Outros agentes** (Antigravity, Copilot, Kiro, Cursor, Grok…): sem push.
   - Poll pelo comando do próprio CLI quando não gasta cota (`agy -p /usage --output-format json` [O]).
   - Classificador de parede.
   - No modo ACP, `stopReason: rate_limit`.

**Classificador de parede.** Inspirado no cux; regras próprias, sem código copiado:
- Primeiro, códigos estruturados.
- Depois, frases fortes, só em canais de erro.
- Denylist de falsos positivos.
- Separar o que é **retentável** do que é **cota esgotada**:
  - Retentável: 429 por minuto, `overloaded`, `MODEL_CAPACITY_EXHAUSTED`, "Server is temporarily limiting requests". Nesses casos, backoff na mesma conta.
  - Cota esgotada: aí sim troca.

**Poll de ranking:**
- Só para contas ociosas, ao abrir o seletor, e no máximo a cada 10 min por conta, com backoff compartilhado.
- **Endpoints não documentados** (`api/oauth/usage`, `wham/usage`, `copilot_internal/user`) ficam **desligados por padrão**. Ligá-los é opt-in "só exibição".
- Sem poll, a conta ociosa fica `unknown` (= tem espaço). A parede corrige depois.

**Transições:**
- `ok` → `warning` em ≥ limiar.
- `warning` → `exhausted` na parede.
- `exhausted`/`cooling` → `ok` quando `now > resetsAt + 60 s`, num timer como o `resumePaused` (`engine.ts` L53-72).

### 3.5 Broker de sessão: troca o processo mantendo a aba (`src/main/broker.ts`)

**Entidades (SQLite):**
- `agent_conversations(id, title, cwd, created_at, generation, status ['active','swapping','parked','closed'], anchored_summary, panel_id)`.
- `agent_segments(id, conversation_id, seq, agent, account_id, native_session_id, transcript_path, started_at, ended_at, end_reason ['limit_near','limit_hit','user','crash','launch_fail'], handoff_id, retry_of, failure_count)`.
- `handoffs(id, conversation_id, tier ['T1','T2'], path, tokens, edited_by_user, created_at)`.

**Sequência `swap(conversationId, reason, to?)`:**
1. **Escolher o destino.** `pick()` excluindo a conta atual. Se for outro fornecedor ou outro tier de custo e o modo for `ask`, abrir o gate "Aprovar troca?", com prévia editável do handoff.
2. **Sem destino → parque.** Não mata nada. A faixa mostra "todas as contas no limite; volta às 14:00 (Claude conta 1)". Um timer retoma quando liberar.
3. **Cercar.** `generation++`. A partir daqui o renderer descarta `pty:data`, `pty:exit` e `pty:session` com geração antiga. Hoje `ptyId` é uma variável de closure em `createTerm` (`TerminalPanel.tsx` L64), e um `pty:exit` atrasado marcaria `dead=true` e descartaria o handle (L227-232, L330-333).
4. **Travar a entrada.** As teclas digitadas vão para uma fila (Orca: entrega `queue`).
5. **Parar o agente antigo.**
   - Proativo: esperar o hook `Stop` (fim do turno). Na parede, agir já.
   - Esperar a transcrição estabilizar (tamanho igual por 200 ms, timeout de 2 s, usando o `transcript_path` do hook).
   - Enviar `/exit`, depois `taskkill /T /F` na árvore após 5 s.
   - Nunca deixar dois processos no mesmo `session_id`: as transcrições se intercalariam [V].
6. **Novo pty no mesmo xterm** (`TermHandle.swapPty(newOpts)`):
   - espera o pty ficar quieto (drain), para que o `\e[?1049l` da TUI não apague a faixa;
   - escreve um reset de alt-screen;
   - escreve a **faixa**;
   - cria o pty novo com os mesmos cols, rows e cwd, e o env da conta nova (`accountEnv`);
   - religa o `ptyId`;
   - força um resize para a TUI redesenhar.
   - É preferível a prefixar env no shell (`$env:X=…; claude`), que depende do tipo de shell.
7. **Lançar e continuar.** Ver §3.6: T1 com `resumeArgv`, ou T2 com o pacote.
8. **Liberar a entrada** e reenviar a fila depois do turno do handoff.
9. **Idempotência.** Cada troca tem um `opId` gravado antes do passo 5. Se o Turno cair no meio, ao reabrir ele retoma do último passo concluído e não cola o handoff duas vezes.

**Headless e rotinas.**
- Novo `followUp(runId, text, {accountId})` e nova política `rotate_on_limit` ao lado de `session_limit`/`weekly_limit` (`abort.ts`, `RoutineEditor`).
- A `RunViewer` já segue o `head` (`RunViewer.tsx` L469-487). A troca ali é só uma run filha com outra conta e o handoff como prompt, via stdin, sem limite de tamanho.

**Restart do Turno.** O layout não guarda `lastSession`/`initialCommand` (`layout.ts` L247-286). A aba de agente passa a ser restaurada a partir de `agent_conversations` e do último segmento, com a oferta "Retomar na melhor conta disponível".

### 3.6 Handoff em camadas (`src/main/handoff.ts`)

**T1, mesmo agente com outra conta (perda quase zero):**
- **Claude** [V docs]:
  - `claude --resume "<transcript_path absoluto>"` com o novo `CLAUDE_CONFIG_DIR`.
  - Com as junctions de `projects/`, `--resume <id>` também funciona.
  - Repassar `--model`, modo de permissão, `--mcp-config`, `--add-dir` e o `--settings` da sessão; o resume não os restaura.
  - Mensagem automática só em troca automática: "Continue de onde parou. A sessão anterior atingiu o limite da conta."
  - Se aparecer o erro 400 "Invalid signature in thinking block" [S, visto entre Anthropic e um backend não Anthropic; entre duas contas Anthropic não há relato], cai para T2.
- **Codex:** tratar como **T2 por padrão**. Raciocínio cifrado preso à organização gera erro `organization_id did not match` [S]. Duas contas ChatGPT provavelmente são orgs diferentes [N].
- **Antigravity, Kiro, Copilot e outros:** `sameAgentResume: 'unverified'` até haver teste com conta descartável. Até lá, T2.

**T2, outro agente (ou T1 que falhou).** Pacote em duas partes:
1. **Arquivo completo** `%APPDATA%\turno\handoffs\<conv>-<n>.md`. Ele também pode ir para `.turno/handoff.md` no cwd, se o usuário quiser que o agente leia com as próprias ferramentas.
2. **Colagem curta** (≤ ~3-4k tokens, bracketed paste).

**Montagem do conteúdo** (receita Codex compact + Factory + Claude re-hydration, `handoff.md`):
- **Parte determinística**, sem LLM, extraída da transcrição só em leitura:
  - caminhos de arquivos editados;
  - comandos executados com exit code;
  - erros;
  - último comando possivelmente incompleto ("pode ou não ter terminado");
  - todos/plano;
  - `git status --porcelain`, `git diff --stat`, `git log -5 --oneline`, branch.
- **Resumo ancorado**, com seções fixas e atualização incremental:
  - intenção;
  - decisões;
  - preferências e restrições do usuário;
  - feito / descoberto / falta;
  - perguntas abertas.
- **Últimas 3-10 mensagens literais** (limite ~8k tokens), incluindo a última mensagem do usuário inteira.
- **Instrução:** "verifique o estado com git e releia os arquivos X, Y, Z antes de agir". Texto plano, sem MAIÚSCULAS imperativas.
- **Orçamento:** ≤ 10-15k tokens ou ≤ 10% da janela do modelo de destino. Encolher para modelos grátis pequenos.
- **Redação de segredos** antes de mandar para outro fornecedor.

**Quem resume:**
1. **A própria sessão de saída, no `warning`.** No fim do turno, injeta: "Escreva um checkpoint em `.turno/checkpoint.md` com feito/descoberto/falta". Isso gasta pouco e usa quem tem o contexto (o `worker_done` do Orca). Só no modo `auto`; no `ask`, perguntar.
2. **Se a parede veio antes, o Qwen local** via Ollama, que o usuário já roda (`qwen3.6:35b`), lendo a transcrição. Usa o molde do `ai.ts`: `-p`, ferramentas negadas, `--permission-prompts none`.
3. **Último recurso:** só a parte determinística.

**Entrega:**
- Esperar o `readyMarker` do driver (o compositor), em vez de "primeira saída + 150 ms" (`TerminalPanel.tsx` L208-221).
- Colar uma vez só e confirmar o início do turno (hook `UserPromptSubmit`/working).
- Se não houver confirmação, marcar "não observado" e **não colar de novo**.
- Se o CLI aceita prompt por argv, preferir argv com "Leia `<arquivo>` e continue".

**Fora do padrão:**
- **T3:** conversão de transcrição entre formatos nativos (estilo casr). Frágil, escreve no store do agente. Experimental, opt-in.
- **T4:** replay via API (OpenRouter/LiteLLM). Só se o Turno tiver o próprio loop de agente.

### 3.7 UX

- **Trocar só entre turnos.** Exceções: a parede, ou o usuário clicar "Trocar agora". Nunca no meio de uma tool call ou de um prompt de permissão aberto, porque o restart descartaria o prompt (Orca `claude-session-account-move.ts:66-70`).
- **Faixa no terminal:** `── continuado em Codex · conta B · motivo: limite 5h 92% (volta 14:00) · [ver handoff] [desfazer] ──`. Para "desfazer", só se a conta anterior voltou.
- **Toast discreto** e, no subtítulo da aba, "handoff N".
- **Popover "Linha do tempo":** os segmentos (agente, conta, início/fim, motivo), com link para cada transcrição e handoff.
- **Painel recolhido "O que o novo agente recebeu"**, com o pacote T2 completo. No modo `ask`, o pacote é editável antes de enviar (lição do Amp Handoff).
- **Barra de uso na aba:** `5h 87% · sem 40%`, ficando amarela no limiar e vermelha na parede.
- **Parque:** "Todas as contas no limite. Volta às 14:00 (Claude conta 1) · [escolher outro agente] [esperar]".
- **Primeira ativação:** tela de consentimento (§5), com o registro de aceite gravado com data e hora.

### 3.8 Persistência e cofre de tokens

**O que fica em cada lugar:**
- `accounts.json`: metadados, rank, modo e consentimento. Sem segredos.
- SQLite: `account_usage`, `agent_conversations`, `agent_segments`, `handoffs`, `swap_log`.
- `%APPDATA%\turno\profiles\<id>\home`: home de cada conta. Os logins **ficam lá, guardados pelo próprio CLI**. No Windows, o Claude usa `.credentials.json` em texto puro [V docs]. Mostrar esse aviso, porque infostealers já visam esse arquivo [S].
- `%APPDATA%\turno\handoffs\`: arquivos de handoff. Limpar após N dias.

**O que o Turno guarda no `secrets.json`:** só **chaves de API coladas pelo usuário**, para o tier API (Anthropic Console, OpenAI, OpenRouter, Gemini pago).

**Migrar o `secrets.ts`:**
- `safeStorage` assíncrono (`encryptStringAsync`/`decryptStringAsync`). Os métodos síncronos são deprecated na v45 e removidos na v46 [V Electron].
- Escrita atômica, hoje feita com `writeFileSync`, que não é atômico.
- Tag de fornecedor por chave e teto de gasto por chave.

**Bug a corrigir de passagem:** `env.ts` usa `'C:\Windows'` numa string TS, o que vira `C:Windows` (`turno.md` §2.3).

---

## 4. Cobertura dos agentes do mercado (out/2026)

Legenda das colunas:
- **Protocolo:** como o Turno conversa com o agente (PTY = TUI no terminal).
- **Multi-conta:** variável de home.
- **Grátis:** tier gratuito utilizável no CLI hoje.
- **Sinal:** P = push, L = poll, W = parede.
- **Resume:** comando e confiabilidade entre contas.

| Agente | Protocolo | Multi-conta | Tier grátis no CLI | Sinal de limite | Resume |
|---|---|---|---|---|---|
| Claude Code | PTY; stream-json/Agent SDK; ACP via adaptador `claude-agent-acp` | `CLAUDE_CONFIG_DIR` [V] (não usar com o caminho padrão) | **Não** (Claude Free não inclui Claude Code) [S] | P: statusline `rate_limits`, `rate_limit_event` [V]; W: `StopFailure rate_limit`, texto [V]; L: `api/oauth/usage` [O] | `--resume <id\|path>` [V]; T1 entre contas: provável [N para signatures] |
| Codex CLI | PTY; `codex app-server` JSON-RPC; `exec --json` (sem rate limits); ACP via adaptador | `CODEX_HOME` [V] | Não listado para Free/Go [V] | P: `token_count.rate_limits` no rollout, `account/rateLimits/updated` [V]; W: `UsageLimitExceeded` [V]; L: `wham/usage` [O] | `codex resume <id>`; entre contas **bloqueado** (org do raciocínio cifrado) [S] → T2 |
| Antigravity CLI (`agy`) | PTY; servidor `antigravity-acp` separado | Store próprio de contas (Orca) [O] | **Sim**: grátis em todos os tiers, limite semanal não publicado [V/S] | L: `agy -p /usage --output-format json` (não gasta cota) [O]; W: `RESOURCE_EXHAUSTED` [O] | `--conversation <id>` [O/S] |
| Gemini CLI | PTY; `--acp` nativo; `-p --output-format stream-json` | `GEMINI_CLI_HOME` [S] | Só chave de API sem pagamento: 250 req/dia Flash. O tier pessoal migrou para o Antigravity em 18/06/2026 [V] | W: `TerminalQuotaError` vs `RetryableQuotaError` [V]; L: `retrieveUserQuota` [O/V] | `--resume` [V] |
| GitHub Copilot CLI | PTY; `--acp` nativo (preview) | `COPILOT_HOME` [O] | **Sim**: Copilot Free inclui o CLI, créditos limitados [V]. **1 conta grátis por pessoa** [V ToS] | Avisos a 75%/90% semanal [S]; W: `user_weekly_rate_limited` [S]; L: `copilot_internal/user` [O] | `--resume=<id>` [O] |
| Kiro CLI | PTY (`kiro-cli chat --tui`); `kiro-cli acp` nativo | `KIRO_HOME` [O] | **Sim**: 50 créditos/mês + bônus [V/S] | Aviso a 80% mensal [V]; L: `kiro-cli chat --no-interactive "/usage"` [O; não verificado se gasta crédito]; W: texto [N] | `--resume-id <id>` [O] |
| Cursor CLI | PTY; `cursor-agent acp`; `-p --output-format stream-json` [V] | Env não verificado [N] | Hobby: limitado, sem números [S] | L: `cursor.com/api/usage-summary` [O]; W: `resource_exhausted` [S] | `--resume <chatId>` [O] |
| OpenCode | PTY; `opencode acp`; `serve` HTTP | `XDG_DATA_HOME`/`OPENCODE_DB` [O] | Modelos "free" do Zen, que mudam sem aviso [S] | W: 429 `FreeUsageLimitError` [S]; L: Go `zen/go/v1/usage` [O] | `--session <id>` [O] |
| Qwen Code | PTY; `--acp` nativo | Não verificado (~/.qwen) [N] | **OAuth grátis encerrado em 15/04/2026** [S]; agora via chave/OpenRouter/Ollama | Depende do provedor; OpenRouter `/api/v1/key` [V] | `--resume` [O] |
| Amp | PTY; adaptador `amp-acp` | Chaves separadas [N] | Admissão fechada; ~$10/dia para quem já tinha [V/S] | L: `amp usage` [O]; W: [N] | `amp threads continue` [N] |
| Grok Build | PTY; `grok agent stdio` (ACP) | `GROK_HOME` [O] | Não confirmado [N] | L: `_x.ai/billing` [O]; W: [N] | `--resume <id>`, ACP load [O] |
| Kimi / Goose / Devin / Droid / Cline / Kilo / Junie / Mistral Vibe / Qoder… | ACP nativo (registro com 44 agentes [V]) | `KIMI_CODE_HOME`, `DEVIN_HOME`, `CLINE_SESSION_DATA_DIR`… [O] | Varia | ACP `stopReason: rate_limit` + texto; sem cota padrão no ACP [V] | ACP `session/load`/`resume` |
| OpenRouter `:free` (tier API) | API (OpenAI-compat.) para Claude Code/OpenCode/Goose apontados nela | Por chave | **Sim**: 50 req/dia, ou 1000/dia com ≥10 créditos comprados; 20 req/min [V] | L: `/api/v1/key` `free_model_daily_requests` [V]; W: 429 | Sem sessão nativa → T2 |
| Ollama local (qwen3.6:35b) | API local (compatível com Anthropic/OpenAI) | n/a | **Ilimitado** (só hardware) | Nenhum | T2. Também é o sumarizador padrão |

**Como "conectar com todos":**
- Fase 1: drivers PTY à mão para Claude, Codex, agy, Copilot, Kiro e OpenCode.
- Fase 4: gerar drivers a partir do registro ACP (`https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json` [V], cópia em `raw\acp-registry.json`), com Kiro adicionado à mão, e um driver "genérico" (binário + home var + resume) que o usuário pode cadastrar.
- Limitação honesta: o ACP **não** padroniza cota. Cada fornecedor precisa de um adaptador de limite próprio, e para vários deles a detecção é só a parede [N para textos de Copilot, Kiro, Amp e Grok].

### O caso "todas as versões grátis"

**Qual é o app citado.** Não foi possível confirmar qual app o usuário viu. Os candidatos mais prováveis:
- **9Router** (`decolua/9router`, MIT, ~31k estrelas, "Unlimited FREE AI coding … never hit limits"). Tem "Combos" Assinatura → Barato → Grátis e troca automática.
- **OmniRoute** (`diegosouzapw/OmniRoute`, MIT). Afirma cobrir 375 provedores, fallback em 4 níveis, app Electron.
- Família menor: CLIProxyAPI e GUIs como Quotio, ZeroLimit, ProxyPal.

**Como eles funcionam.** Um **proxy local** na porta 20128 que reaproveita os tokens OAuth dos CLIs e roda várias contas por fornecedor (`connectivity.md` §4).

**Isso viola os termos** da Anthropic (armazenar ou intermediar tokens; várias contas para evitar detecção), do Gemini CLI (OAuth com terceiros é "violation"), da OpenAI e do Google (contornar limites) e do GitHub (uma conta grátis). Houve banimentos documentados em 2026 (`compliance.md` §2). O próprio OmniRoute marca o Kiro como `tos: avoid`.

**Proposta para o Turno** (mesmo resultado prático, sem proxy):
1. **Catálogo "Tiers grátis"**, com **uma conta por fornecedor**, cada uma no próprio CLI oficial. Hoje são viáveis:
   - Antigravity (`agy`);
   - Copilot Free;
   - Kiro Free;
   - OpenCode Zen free;
   - OpenRouter `:free`;
   - Gemini API sem pagamento (via chave);
   - Ollama local como piso garantido.
   - Cada item mostra: uso de dados para treino (ex.: Gemini Unpaid [V]), data do "último verificado", interruptor por fornecedor e o motivo quando foi desativado (ex.: Qwen OAuth encerrado, Gemini CLI substituído).
2. **Ranking "grátis primeiro"** como preset. A cadeia termina no Ollama local, que nunca acaba.
3. **Handoff T2 entre eles**, porque todos são fornecedores diferentes. Contexto perdido: o resumo cobre bem, mas modelos grátis pequenos recebem pacotes encolhidos.
4. **Aviso honesto.** Os tiers grátis estão encolhendo: Claude Code e Codex CLI não têm; Qwen e iFlow saíram; Amp fechou a admissão. Na prática, a cadeia grátis sustenta poucas horas de uso pesado por dia [N, sem números publicados para Antigravity/Kiro/Cursor].
5. **9Router/OmniRoute:** não embutir nem recomendar. Se o usuário insistir, permitir só como "endpoint personalizado" (o `Connection` `kind:'endpoint'` que já existe), atrás de um aviso que cita as cláusulas e os banimentos.

---

## 5. Riscos e conformidade (ToS): recomendação clara

| Padrão | Veredito | Configuração padrão no Turno |
|---|---|---|
| CLI oficial, sem modificação, logado pelo usuário, num terminal do Turno | **Permitido** [V] | Base de tudo |
| Troca automática entre **fornecedores diferentes**, uma conta de cada | **Permitido** (inferência: cada tier é usado como foi oferecido) | `auto` liberado |
| Várias contas **pagas** do mesmo fornecedor, troca **manual** | Cinza-OK (Anthropic: staff disse "not against ToS" [S]) | Permitido com aviso |
| Várias contas pagas do mesmo fornecedor, troca **automática** para passar do limite | **Cinza a arriscado.** Anthropic: "bypassing… protective measures", "limits assume ordinary, individual usage" [V]; houve ban de multi-Max em fev/2026 [S]. **OpenAI: proibido numa leitura literal** ("circumvent any rate limits") [V] | Opt-in, modo `ask` por padrão. O `auto` exige consentimento explícito por fornecedor, com cooldown e máximo de trocas por hora |
| Várias contas **grátis** do mesmo fornecedor | **Proibido** (GitHub §B.3 [V]; AUP Anthropic [V]; anticontorno OpenAI/Google [V]) | Bloqueado: uma conta grátis por fornecedor |
| Proxy reaproveitando OAuth dos CLIs (9Router/OmniRoute/CLIProxyAPI) | **Proibido** [V] e com banimentos documentados [S] | Não embutido; só como endpoint manual com aviso |
| O Turno guardar ou renovar tokens de assinatura | **Proibido** para um app distribuído (Anthropic: "may not collect, store, or intermediate") [V] | Nunca. Cada CLI guarda o próprio login na sua home |
| Chaves de API com automação e fallback | **Permitido**, e é a exceção explícita da Anthropic §3(7) [V] | Tier "API" com teto de gasto |
| Poll de endpoints não documentados (`api/oauth/usage` etc.) | Cinza; pode quebrar e devolve 429 | Desligado; opt-in, raro, só para exibição |

**Recomendação:**
- Lançar com **cross-provider automático** e **same-provider em modo "Perguntar"**.
- Sem proxies e sem tokens.
- Com consentimento registrado, faixa visível, log de trocas e **sem rotação 24/7 sem supervisão por padrão** (padrão associado a banimento).
- Nunca chamar a rotação no mesmo fornecedor de "segura" ou "conforme os termos".

**Riscos técnicos, além dos termos:**
- Formatos internos mudam: o JSONL do Claude é "internal".
- Erros de signature/org no resume.
- Kill duro no Windows pode perder ou duplicar o resultado de uma tool. Por isso a troca é só entre turnos.
- Dois processos na mesma sessão intercalam a transcrição. Por isso a cerca e o kill antes do launch.
- O primeiro request na conta nova reconstrói o cache de prompt e custa mais uso [S].
- Infostealers visam `.credentials.json`; cada home a mais é mais um alvo.

---

## 6. Plano em fases (MVP → completo)

Todos os caminhos ficam em `C:\Users\Rafael\Desktop\turno\src`. "Novo" indica um arquivo novo.

### Fase 0: fundações (sem mudança visível)
- `renderer/panels/TerminalPanel.tsx`:
  - contador de `generation` no `TermHandle`;
  - `swapPty(opts)`: mata o pty antigo, cria o novo, religa o `ptyId`, ignora eventos antigos e faz drain e reset de alt-screen;
  - `writeBanner()`.
- `main/pty.ts`:
  - `PtyCreateOptions.accountId` + `accountEnv()`;
  - kill da árvore (`taskkill /T`);
  - derivação de `onData` para o classificador.
- `main/termsessions.ts`: um watcher por home e `agent` deixa de ser fixo `'claude'`.
- `main/sidebar.ts`, `main/claudeprep.ts`, `main/provider-auth.ts`: aceitam home e env por conta.
- `main/env.ts`: corrigir o `C:\Windows`; remover `CLAUDE_CODE_RETRY_WATCHDOG`/`MAX_RETRIES` nas sessões de agente.
- `renderer/layout.ts`, `App.tsx`, `Sidebar.tsx`: `agentOf(panel)` único.
- **Aceite:** testes vitest de `swapPty`, em que um `pty:exit` atrasado da geração antiga não marca o handle como morto; os testes atuais continuam verdes.

### Fase 1 (MVP): Claude multi-conta com troca automática, mesma aba
- Novos: `main/accounts.ts`, `main/profiles.ts` (provisionamento com atribuição MIT ao Orca), `main/agents/drivers.ts` (só o driver Claude), `main/hookserver.ts` (loopback com token), `main/limits.ts` (statusline + StopFailure + texto), `main/broker.ts`, `renderer/agentStore.ts`, `renderer/panels/AgentsSection.tsx`.
- `shared/types.ts`: `AgentAccount`, `LimitState`, `AgentConversation`. `main/db.ts`: tabelas `account_usage`, `agent_conversations`, `agent_segments`, `swap_log`.
- `Sidebar.tsx` L444-446, `App.tsx` L216-224 e L259-261: botão e menu "Agent".
- O handoff do MVP é só **T1** (`--resume <transcript_path>`). Se o T1 falhar, mostrar uma mensagem e oferecer abrir uma sessão nova com as últimas mensagens coladas (T2 mínimo, determinístico).
- **Critérios de aceite:**
  1. Duas contas Claude conectadas por login visível. Nenhum arquivo em `~/.claude` é alterado (checar o hash antes e depois).
  2. O Agent abre na conta de rank 1 e o badge mostra o % vindo do statusline em até 1 turno.
  3. Simular `rate_limits.five_hour.used_percentage=92` (injeção no hookserver) leva a uma troca no próximo `Stop`. A mesma aba mostra a faixa, e a sessão nova responde corretamente a "qual número eu pedi para lembrar?" (teste 4729 do cux).
  4. Simular `StopFailure rate_limit` leva a uma troca imediata. Sem conta livre, a sessão vai para o parque sem matar o processo.
  5. Remover um perfil não apaga nada em `~/.claude/projects` (junctions desfeitas antes).
  6. Fechar e reabrir o Turno oferece retomar a conversa.
  - Testes com conta real ficam com o usuário, de preferência numa conta descartável.

### Fase 2: cross-agent (T2) + Codex/Antigravity/Copilot/Kiro
- Novo `main/handoff.ts`:
  - extrator determinístico (Claude JSONL, rollout Codex, buffer do xterm como fallback) + estado do git;
  - resumo ancorado;
  - sumarizador Qwen local no molde do `ai.ts`;
  - checkpoint pedido à sessão de saída no `warning`;
  - redação de segredos.
- Drivers: `codex` (home + tail do rollout), `agy` (poll `/usage`), `copilot`, `kiro`, `opencode`. Classificador de parede por driver, com denylist.
- Entrega com `readyMarker` + bracketed paste + confirmação de início de turno, sem recolagem.
- UI: painel "O que o novo agente recebeu", edição no modo `ask`, gate de aprovação entre fornecedores e tiers, linha do tempo.
- **Aceite:**
  1. Uma conversa Claude → Codex mantém tarefa, arquivos e próxima etapa (checklist de 5 perguntas sobre a conversa anterior, ≥ 4 corretas).
  2. O pacote colado fica ≤ 4k tokens e o arquivo completo é gravado.
  3. Nenhuma colagem dupla em 20 trocas simuladas.
  4. Um 429 por minuto ou "overloaded" **não** causa troca.

### Fase 3: rotinas/headless
- `main/abort.ts`: política `rotate_on_limit`; `allowed_warning` vira `warning`.
- `main/engine.ts`: `followUp(runId, text, {accountId})`; `resumePaused` passa a escolher a próxima conta em vez de só esperar.
- `main/runner.ts`: `accountEnv`.
- `RoutineEditor`: opção "trocar de conta no limite".
- **Aceite:** uma rotina com evento `rejected` simulado continua noutra conta, a `RunViewer` segue o `head` e o custo acumulado fica correto.

### Fase 4: "todos os agentes" + tiers grátis + tier API
- Drivers gerados do registro ACP, mais Kiro e um driver genérico cadastrável. Modo chat via ACP (opcional), com `session/load`/`resume`.
- Catálogo "Tiers grátis" com interruptores, "último verificado", aviso de treino e preset "grátis primeiro → Ollama".
- Tier API: OpenRouter/Anthropic/OpenAI/Gemini por chave, teto de gasto, `/api/v1/key` do OpenRouter.
- Tela de consentimento e matriz por fornecedor.
- **Aceite:** detectar no PATH todos os agentes instalados; cadeia grátis de 3 fornecedores + Ollama trocando com T2; bloqueio de uma segunda conta Copilot Free.

### Fase 5: robustez
- Migrar o `secrets.ts` para safeStorage assíncrono com escrita atômica, antes do Electron 46.
- Cap por modelo (troca de modelo na mesma conta).
- Política "voltar à conta prioritária após o reset", opcional.
- Poll opt-in de endpoints não documentados, só para exibição.
- Telemetria local do `swap_log`.

---

## 7. Perguntas abertas

1. **Qual app de "todas as versões grátis" você viu?** 9Router, OmniRoute ou outro? Se tiver o link, dá para confirmar o mecanismo.
2. **Rotação automática entre várias contas Claude** (mesmo fornecedor): você aceita o risco cinza com modo `auto`, ou fica em `ask`? E para ChatGPT/Codex, onde a leitura literal dos termos proíbe?
3. **Quantas contas e de quais agentes você tem hoje?** Isso define a ordem dos drivers na fase 2.
4. **Modo de execução:** só terminal (TUI, como hoje), ou também uma aba "chat" estruturada (Agent SDK/ACP)? O modo chat tem sinais de limite melhores e handoff mais limpo, mas é mais trabalho.
5. **Limiar padrão:** 90% (5h) e 95% (semanal) estão bons? Trocar já no `warning`, ou só preparar o handoff e trocar na parede?
6. **Sumarizador:** o Qwen local (`qwen3.6:35b`) como padrão está bom (custo zero, mas mais lento)? Ou prefere o próprio agente de destino?
7. **O checkpoint escrito pela sessão de saída** pode criar `.turno/checkpoint.md` no repositório, ou deve ficar só em `%APPDATA%`?
8. **Comando do statusline no Windows:** `curl.exe` ou o Electron como node? Precisa de uma medição rápida de latência com uma conta de teste.
9. **Para o T1 do Claude:** junctions de `projects/` para `~/.claude` (modelo Orca) ou só `--resume <caminho absoluto>`, sem tocar no histórico? A segunda opção é mais conservadora, mas o `/resume` interativo não lista as sessões das outras contas.

**Itens que precisam de teste com conta descartável (não verificados aqui):**
- resume entre duas contas Anthropic (signature);
- Codex entre contas (org);
- textos de parede de Copilot, Kiro, Amp e Grok;
- se o `/usage` do Kiro gasta crédito;
- local exato das credenciais no perfil no Windows.

---

## Fontes principais

**Notas locais** (com referências de linha): `C:\rx\notes\{orca-agents,orca-tasks,cux,limits,compliance,handoff,connectivity,turno}.md`. Código: `C:\rx\orca` (MIT) e `C:\rx\cux` (GPL-3, só leitura de ideias).

**Docs oficiais:**
- Claude Code: https://code.claude.com/docs/en/statusline · https://code.claude.com/docs/en/hooks · https://code.claude.com/docs/en/sessions · https://code.claude.com/docs/en/agent-sdk/sessions · https://code.claude.com/docs/en/authentication · https://code.claude.com/docs/en/errors · https://code.claude.com/docs/en/legal-and-compliance
- Codex: código em https://github.com/openai/codex · https://developers.openai.com/codex/auth
- Gemini/Antigravity: https://geminicli.com/docs/resources/quota-and-pricing/ · https://geminicli.com/docs/resources/tos-privacy/
- ACP: https://agentclientprotocol.com/protocol/session-setup · registro em https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json
- Copilot e GitHub: https://docs.github.com/en/copilot/get-started/plans · https://docs.github.com/en/site-policy/github-terms/github-terms-of-service
- Kiro: https://kiro.dev/docs/billing/ · https://kiro.dev/docs/cli/acp/
- OpenRouter: https://openrouter.ai/docs/api-reference/limits
- Electron: https://www.electronjs.org/docs/latest/api/safe-storage

**Termos:**
- Anthropic: https://www.anthropic.com/legal/consumer-terms · https://www.anthropic.com/legal/aup
- OpenAI: https://openai.com/policies/row-terms-of-use/
- Google: https://developers.google.com/terms

**Ferramentas de referência:**
- Orca: https://github.com/stablyai/orca · https://www.onorca.dev/docs
- cux: https://github.com/inulute/cux
- claude-swap: https://github.com/realiti4/claude-swap
- cx: https://github.com/Mike-7777777/cx
- continues: https://github.com/yigitkonur/cli-continues
- 9Router: https://github.com/decolua/9router
- OmniRoute: https://github.com/diegosouzapw/OmniRoute
- Amp Handoff: https://ampcode.com/news/handoff
- Factory, avaliação de compressão: https://factory.com/news/evaluating-compression

**Imprensa** (secundária): The Register, 20/02/2026; TechCrunch, 04/04/2026; PiunikaWeb, 19/02/2026; metricnexus (bans de Claude e Antigravity).
