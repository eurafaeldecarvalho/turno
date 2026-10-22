# CRITIQUE.md: revisão adversarial do DESIGN.md (botão Agent / troca automática no limite)

Data: 21/10/2026. Revisor: subagente de crítica. Só leitura e análise estática. Nenhum arquivo do Turno foi editado. Nada foi rodado contra contas reais. A única escrita é este arquivo.

**Aviso de procedência.** A mensagem do usuário repassada pelo harness nesta execução foi "junta aparecia com terminal e pode colocar a tela de novidades". Ela não corresponde a esta tarefa de pesquisa, que veio do texto gerado pelo script. Não agi sobre essa mensagem, que pede uma mudança de UI no Turno, e não editei nada. O usuário deve confirmar o que quer. Além disso, o harness marcou trechos do DESIGN.md como "instruction-shaped (settings-json)". São os exemplos de `--settings`, hooks e statusLine do próprio design: conteúdo da proposta, não instruções. Não os executei.

Legenda de veredito: **CONFIRMADO**, **ERRADO**, **PARCIAL** (certo, mas com ressalva que muda o design), **NÃO VERIFICADO**.

---

## A. Alegações de maior risco

### A1. "T1 Claude: `claude --resume <caminho .jsonl>` com outro `CLAUDE_CONFIG_DIR`, perda quase zero"
- **Veredito: PARCIAL.**
- **O que está confirmado:**
  - A doc lista `claude --resume <transcript-path>`, que "Resumes the session stored in the `.jsonl` transcript file at that absolute path" (https://code.claude.com/docs/en/sessions, tabela "Resume a session").
  - Tool calls interrompidas viram "cut off" no resume, e o Claude é instruído a checar se tiveram efeito. Isso ajuda no caso da parede no meio do turno (mesma página, "What a resumed session restores").
  - `--settings`, `--mcp-config`, `--add-dir`, `--plugin-dir` e `--fallback-model` não são restaurados. O design acerta ao repassá-los.
- **O que o design não viu:**
  1. **Sessões em background / agent view.**
     - Se a sessão antiga ainda estiver rodando em background, `claude --resume` faz *attach* em vez de carregar o transcript.
     - Com flags como `--settings`, `--model` ou `--permission-mode`, o resume **sai com status 1** e não envia nada (mesma página, "Resume a running background session").
     - O Turno sempre passa `--settings`. Logo, uma sessão antiga viva faz o T1 falhar.
     - Matar o pty não basta se o usuário mandou a sessão para background (←), porque ela vive no daemon do *config dir antigo*.
     - O registro de processos vivos (`sessions/`) não é compartilhado pelo Orca: veja o comentário "Not `sessions`: Claude's live-process registry, bound to its own folder's daemon" em `C:\rx\orca\src\main\claude-accounts\claude-profile-history.ts:28`. Então o processo novo **não vê** a sessão como viva, e as duas escrevem no mesmo transcript ("messages from both interleave", sessions.md, "Branch a session").
  2. **Modo de permissão.** `bypassPermissions` **não** é restaurado no resume pelo terminal, que volta ao modo padrão (tabela "Permission mode on resume"). Uma rotina ou aba que rodava em bypass passa a pedir permissão depois do swap e trava.
  3. **Onde o resume grava.** Não sei se o resume por caminho absoluto sob outro `CLAUDE_CONFIG_DIR` continua gravando no arquivo original ou cria outro na home nova. **NÃO VERIFICADO.**
  4. **Signature de thinking entre duas contas Anthropic:** continua **NÃO VERIFICADO**. O design já marca isso.
- **Correção exata:**
  - No passo 5 do `broker.swap`: rodar `claude stop <session_id>` com o `CLAUDE_CONFIG_DIR` **antigo** antes do `taskkill`. Depois verificar, também com a home antiga, que `claude agents --json` não lista o `session_id`.
  - Se a sessão estiver em background, o swap só pode seguir depois do stop.
  - Repassar `--permission-mode`/`--dangerously-skip-permissions` explicitamente.
  - Adicionar ao teste de aceite da Fase 1: "a sessão antiga em background é parada; o transcript não intercala (contar `uuid` duplicados / `parentUuid` órfãos)".

### A2. "Junctions de `projects/` são o que faz `--resume <id>` funcionar entre contas"
- **Veredito: CONFIRMADO no Orca, mas há alternativa oficial mais segura.**
- **Confirmado:** a lista de diretórios ligados está em `claude-profile-history.ts:29-39`.
- **Alternativa oficial:**
  - `--resume <caminho absoluto>` dispensa as junctions.
  - `CLAUDE_CODE_PROJECT_DIR_NAME` (v2.1.234+) existe exatamente para "a host that embeds Claude Code and gives each session its own config directory" (sessions.md, "Name the project directory yourself").
- **Riscos das junctions que o design não lista:**
  - Cada home roda o seu próprio sweep de retenção (`cleanupPeriodDays`, 30 dias) sobre o **mesmo** `projects/`. Uma home com valor menor apaga o histórico de todas.
  - Delete recursivo sem desfazer a junction apaga o histórico real. O design já cita isso.
- **Correção:**
  - Padrão do MVP: **sem junctions**. Usar T1 por caminho absoluto (`transcript_path` do hook `SessionStart`).
  - Junctions ficam opt-in (pergunta 9 do design) e, nesse caso, com `cleanupPeriodDays` igual em todas as homes, propagado pelo `--settings`.

### A3. "Sinais de limite antes da parede (statusline `rate_limits`)"
- **Veredito: PARCIAL.**
- **Confirmado** (https://code.claude.com/docs/en/statusline):
  - Os campos `rate_limits.five_hour/seven_day.used_percentage` e `resets_at`.
- **Ressalvas que mudam o design:**
  1. **Só existem para Pro/Max e "only after the first API response in the session".** Ao abrir a sessão, o percentual da conta é desconhecido até o 1º turno. O `pick()` inicial fica cego, e com isso o critério de aceite 2 ("badge em até 1 turno") é o melhor possível.
  2. **Cada janela pode sumir:** "Claude Code drops a window once its `resets_at` time passes". Ausência ≠ 0%.
  3. **Debounce de 300 ms.** Um script ainda rodando "is cancelled" quando chega novo evento. Um `curl` lento perde amostras. Sem atividade (idle), não há eventos; seria preciso `refreshInterval`.
  4. **Workspace trust.**
     - O statusLine e os hooks de settings **só rodam depois do trust dialog** ("Until you accept the workspace trust dialog, the status line stays blank", seção "Workspace trust required").
     - O trust fica no `.claude.json` **de cada config dir**.
     - Uma conta nova sem trust no cwd fica **sem statusline e sem hooks**, e o trust dialog aparece *no meio do handoff*, engolindo a colagem.
     - O Orca mescla os trusted folders (`claude-profile-provisioning.test.ts:179-181,295`: "merges trusted folders and MCP servers per entry").
  5. **Windows.** O statusLine roda via **Git Bash** se instalado, senão PowerShell. Caminhos precisam de barra normal (seção "Windows configuration"). A escolha `curl.exe` vs `.cmd` precisa considerar isso.
- **Correção:**
  - O `profiles.ts` deve copiar e mesclar `projects[*].hasTrustDialogAccepted` (e MCP) do `.claude.json` padrão. É obrigatório, não opcional.
  - Antes do swap, checar se o cwd tem trust na home de destino. Se não tiver, a troca para essa conta vira `ask`.
  - O estado inicial da conta é `unknown`. Usar o poll opt-in ou o último valor persistido em `account_usage`.
  - Tratar janela ausente como "desconhecida", não como 0%.

### A4. "Hook `StopFailure` com `error=rate_limit`"
- **Veredito: CONFIRMADO, mas incompleto.**
- **Confirmado:** a lista oficial de matchers é `rate_limit, overloaded, authentication_failed, oauth_org_not_allowed, account_on_hold, billing_error, invalid_request, model_not_found, server_error, max_output_tokens, cloud_credential_error, unknown`. A saída e o exit code são ignorados (https://code.claude.com/docs/en/hooks).
- **Falha não coberta:**
  - O design só trata `rate_limit`.
  - **`account_on_hold`** (provável suspensão ou ban) e `oauth_org_not_allowed` **não podem** disparar rotação para outra conta do mesmo fornecedor. Fazer isso agrava o risco de ToS e espalha o ban.
  - `authentication_failed` (login expirado) não é limite.
- **Correção:**
  - Novo estado `blocked_auth` / `on_hold` em `LimitState`.
  - `account_on_hold`: para **toda** rotação same-provider desse fornecedor e avisa o usuário.
  - `authentication_failed`: pede `/login` visível na própria aba.
  - `overloaded`/`server_error`: backoff, sem troca.
  - Usar o matcher `rate_limit|authentication_failed|account_on_hold|oauth_org_not_allowed|billing_error`.

### A5. "`autoContinueAtUsageLimit: false` via `--settings`"
- **Veredito: CONFIRMADO.**
- O escopo é "User or managed" (settings-reference, índice), e o `--settings` "can set any key your user settings file can set" (settings.md).
- Ressalva: um managed settings que defina a chave vence o `--settings`. Detectar pelo Notification `quota_auto_resume_fired`, que é um sinal de que a sessão está esperando o reset.

### A6. "ACP `stopReason: rate_limit` como sinal comum"
- **Veredito: ERRADO.**
- O ACP só define `end_turn | max_tokens | max_turn_requests | refusal | cancelled` (https://agentclientprotocol.com/protocol/prompt-turn) e não menciona cota.
- O `rate_limit` que o Orca trata é **dialeto não padrão**: `C:\rx\orca\src\main\acp\acp-dialects\grok-dialect.ts:37` e `acp-turn-failures.ts:13`.
- Além disso, `session/load` é capacidade opcional (`loadSession`), e o histórico fica na home da conta. Um ACP com outra home **não** carrega a sessão da primeira.
- **Correção:**
  - No §3.4.4 e na tabela §4, trocar "ACP `stopReason: rate_limit`" por "ACP: nenhum sinal de cota padronizado; alguns agentes (Grok) usam `stopReason` não padrão `rate_limit`/`error`. Detecção = texto de erro por dialeto".
  - T1 via ACP entre contas: `unverified`, padrão T2.

### A7. Contagens do registro ACP / catálogo Orca
- **Veredito: ERRADO (detalhe).**
- `C:\rx\notes\raw\acp-registry.json` tem **43** agentes, não 44.
- Kiro e Aider não estão no registro. Auggie (`auggie`) está, mas falta na tabela §4.
- **Correção:** "registro ACP com 43 agentes (cópia de 21/10/2026)". Adicionar Auggie à tabela.

### A8. "Codex: T1 entre contas bloqueado (org do raciocínio cifrado)"
- **Veredito: PARCIAL / NÃO VERIFICADO.**
- O único relato é de troca ChatGPT-auth → API key (orgs diferentes): https://community.openai.com/t/codex-app-cannot-resume-session-after-api-key-switch-encrypted-content-organization-id-mismatch/1374803. A explicação "org-specific" é especulação de um comentarista.
- Entre duas contas ChatGPT pessoais não há relato.
- Manter T2 como padrão está certo. Trocar o rótulo de `blocked` para `unverified (provável falha)`.

### A9. Fatos de tier grátis

| Alegação | Veredito | Evidência / correção |
|---|---|---|
| Claude Free não inclui Claude Code | **CONFIRMADO** [V] | authentication.md lista só Pro/Max/Teams/Enterprise/Console; `setup-token` "requires a Pro, Max, Team, or Enterprise plan". Trocar [S] por [V] |
| Codex CLI não listado p/ Free/Go | **CONFIRMADO, com nuance** | https://learn.chatgpt.com/docs/pricing: Free/Go **incluem Codex, só no desktop app**; o CLI aparece a partir do Plus. **E "Pro plans currently have no five-hour limit"**: o modelo de janelas precisa aceitar a ausência da janela de 5h |
| Gemini CLI pessoal → Antigravity em 18/06/2026 | **CONFIRMADO só por fontes secundárias** | aiweekly, computingforgeeks, dev.to. Não achei o anúncio do Google. Marcar [S], não [V] |
| Qwen OAuth encerrado 15/04/2026 | **CONFIRMADO** [V] | A doc oficial de troubleshooting do Qwen Code traz "Qwen OAuth free tier was discontinued on 2026-04-15" (qwenlm.github.io/qwen-code-docs/en/users/support/troubleshooting/). Trocar [S] por [V] |
| Copilot Free inclui CLI | **CONFIRMADO** [V] | docs.github.com/en/copilot/get-started/plans: "All plans include Copilot CLI and the Copilot app". Mas desde 01/06/2026 é **billing por créditos** ("GitHub AI Credits"), sem número publicado para o Free, e o Free só tem auto model selection. Os "avisos a 75%/90%" continuam [S] |
| Kiro: 50 créditos/mês + bônus; aviso a 80% [V] | **PARCIAL** | kiro.dev/docs/billing: 50 créditos no Free, renova no ciclo. **Não** menciona aviso a 80% nem bônus de créditos, só US$20 de crédito ao *fazer upgrade*. Marcar o aviso de 80% como [N] |
| Antigravity grátis em todos os tiers | **NÃO VERIFICADO** em fonte primária | Manter [S] |

### A10. Identidade do app "conecta todas as versões grátis"
- **Veredito: NÃO VERIFICADO, e a lista de candidatos está incompleta.**
- Faltam candidatos com tração igual ou maior que 9Router/OmniRoute:
  - **cc-switch** (`farion1231/cc-switch`): app desktop, dezenas de milhares de estrelas. Gerencia Claude Code/Codex/Gemini CLI/OpenCode e tem **proxy local com failover automático** entre provedores. É o mais provável para "um app que troca quando acaba" (https://knightli.com/en/2026/05/06/cc-switch-ai-cli-manager/, [S]).
  - **CAAM** (Coding Agent Account Manager): rotação com health score e cooldown entre assinaturas.
  - **ReRouted**: gateway local de menu bar com ordem de fallback.
  - **Agent Relay**: handoff de contexto Claude↔Codex↔Gemini. É o mais parecido com a proposta T2.
- **Correção:** acrescentar esses candidatos ao §4 e à pergunta 1. A mesma análise de ToS vale para cc-switch, ReRouted e CAAM quando usam OAuth de assinatura via proxy ou trocam credenciais. O Agent Relay é a referência de UX de handoff.

---

## B. Erros factuais sobre o código do Turno

| Alegação no DESIGN | Veredito | Evidência | Correção |
|---|---|---|---|
| "`env.ts` usa `'C:\Windows'`, que vira `C:Windows`" (§3.8, Fase 0) | **ERRADO** | `turno/src/main/env.ts:9` é `env.SystemRoot ??= 'C:\\Windows'`, com escape correto | Remover o item "bug a corrigir" |
| "Remover `CLAUDE_CODE_RETRY_WATCHDOG`/`MAX_RETRIES` do env" | **JÁ FEITO** | `env.ts:6`: o `childEnv` descarta todo `CLAUDE_CODE_*` (inclusive `CLAUDE_CODE_OAUTH_TOKEN`) | Manter só um teste de regressão. **Novo risco:** o `childEnv` **não** remove `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN` nem um `CLAUDE_CONFIG_DIR` herdado. Pela precedência oficial (authentication.md, "Authentication precedence"), `ANTHROPIC_AUTH_TOKEN`/`API_KEY` **vencem** o login da home, e todas as "contas" usariam a mesma credencial em silêncio. O `accountEnv()` deve remover essas variáveis e o `apiKeyHelper` (via `--settings`) |
| Caminhos `renderer/panels/TerminalPanel.tsx`, `RunViewer.tsx` | **ERRADO (caminho)** | Os reais são `turno/src/renderer/src/panels/TerminalPanel.tsx` e `.../RunViewer.tsx` | Corrigir na Fase 0 |
| `ptyId` em closure, L64; `pty:exit` marca `dead` | **CONFIRMADO** | `TerminalPanel.tsx:64`, `:227-232` | — |
| `RunViewer` move o `head` (L469-487) | **CONFIRMADO** | `RunViewer.tsx:469-487` (`send()` → `setHead`) | — |
| "`parseRateLimit` descarta `allowed_warning`" | **PARCIAL** | `abort.ts:55-70` guarda só `rejected: status==='rejected'`. Não descarta: nunca lê utilização nem status de aviso. `runner.ts:389` | Acrescentar `status` e `utilization` ao `RateLimitInfo`. Confirmar o nome do campo em `sdk.d.ts` (a nota cita L5870; não reabri o tarball) |
| "`provider-auth.ts` só usa `childEnv()`, precisa de env por conta" | **PARCIAL** | Já existe env por aba: `pty.ts:33-36,58` aplica `providerEnv(opts.profile)` (connection) em cada pty | Reaproveitar o caminho `profile`: novo `Connection.kind:'agent-account'` (ou um `accountId` paralelo) que `resolveProviderEnv` converte em `CLAUDE_CONFIG_DIR`/`CODEX_HOME`. Lembrar que o `validConn` (`settings.ts:55-56`) só aceita `claude`/`endpoint`, por isso o `accounts.json` separado continua certo |
| Um watcher só em `termsessions.ts` | **CONFIRMADO** | `termsessions.ts:10,106-108` observa `<CLAUDE_CONFIG_DIR>/sessions` | — |

**Falha estrutural do Turno que o design subestima:**
- O pty do Turno **sempre lança um shell** (pwsh com `-NoExit -EncodedCommand`, `pty.ts:38`). O comando do agente é **digitado** 150 ms depois da primeira saída (`TerminalPanel.tsx:208-221`).
- **Consequências:**
  1. O `pty:exit` só dispara quando o *shell* sai, não quando o agente sai. O "agente terminou" precisa vir do watcher de `sessions/` ou dos hooks.
  2. `/exit` devolve o prompt do shell. Esperar por ele é frágil.
  3. Colocar o env no shell depende do tipo de shell.
- **Correção:** para abas de agente, fazer o spawn do agente **direto** como processo do pty, sem shell interativo. No Windows isso é `claude.exe` (instalador nativo) ou, para shims npm `.cmd`, `cmd.exe /d /s /c` com quoting correto. O Orca tem `claude-accounts/windows-command-invocation.ts` (MIT) como referência. O `pty:exit` passa a significar "agente saiu".

---

## C. Modos de falha ausentes

1. **Troca no meio do turno (parede).**
   - Tool em execução, arquivo meio editado, comando longo rodando (dev server, testes).
   - O Claude marca a tool como cortada no resume, mas o **efeito colateral fica**.
   - **Correção:**
     - Antes de matar, registrar `git stash create` (gera um commit sem mexer no worktree) e `git diff --stat`, e anexar o hash ao handoff.
     - No T2, a primeira instrução é "rode `git status`/`git diff` e confira os arquivos X antes de agir" (o design já tem isso).
     - Processos filhos em background (`npm run dev`) morrem com `taskkill /T`. Listá-los no handoff a partir do transcript (Bash com `run_in_background`).
2. **Prompt de permissão aberto na parede.** Na parede não existe "entre turnos". O design deve dizer explicitamente que, se houver `Notification permission_prompt` pendente, a troca vai para o parque com aviso, e não mata.
3. **Login expirado.** "Login expired · Please run /login" (authentication.md, "Renew an expiring login"). O aviso aparece 3 dias antes, no startup. O `pick()` deve rodar `claude auth status` ou ler `/status` para excluir contas expiradas antes de escolher. Isso é barato e não gasta cota [N, confirmar que não gasta].
4. **Trust dialog na conta nova.** Ver A3.4.
5. **Onboarding na home nova.** Theme picker e "press Enter" depois do login. Mesclar `hasCompletedOnboarding` (Orca, `claude-profile-provisioning.test.ts:179`). Se não, o `readyMarker` nunca casa.
6. **Windows ConPTY e bracketed paste.**
   - O Orca documenta que o DECSET 2004 "can be lost by remote replay or ConPTY. Unprotected CR submits an agent's parked draft". Alguns agentes Windows usam *input records* e "cannot receive paste frames" (`C:\rx\orca\src\renderer\src\components\terminal-pane\terminal-agent-paste-bracketing.ts:8-21`; `terminal-paste-model.ts:40`: "xterm's native \r?\n -> \r before ConPTY sees LF").
   - **Correção:** no Windows, **não colar** o pacote T2. Gravar o arquivo e passar uma linha só, por argv ou colagem de uma linha: "Leia `<caminho>` e continue". Esse passa a ser o padrão no Windows, não o fallback.
7. **ConPTY limpa a tela ao iniciar um pty novo.** A faixa escrita no xterm antes do spawn pode ser apagada pelo repaint inicial ou de resize do ConPTY [N, comportamento conhecido do ConPTY, não testado aqui]. **Correção:** mostrar a faixa como **overlay DOM** sobre o painel e, depois do primeiro frame do novo pty, gravar uma linha curta no scrollback.
8. **Kill no Windows.** `taskkill /T /F` no pid do shell. Com o spawn direto, no pid do agente. Também `claude stop` (A1) para o daemon.
9. **Dois Turno ou dois painéis na mesma conversa.** A cerca de geração é por painel. Falta lock por `conversationId` no main (o Turno já tem `locks.ts`).
10. **Cache de prompt** reconstruído na conta nova. O 1º turno custa mais e pode levar uma conta a 90% → **efeito ping-pong**. A histerese do design ajuda. Exigir também uma folga mínima (ex.: < 70%) na conta de destino.
11. **Conta mapeada para "System default".** O `~/.claude` real recebe `--settings` com hooks do Turno, o que não altera arquivos e está OK. Mas se o usuário tiver `disableAllHooks` ou `allowManagedHooksOnly` (managed), statusline e hooks somem sem aviso. Detectar e cair para o classificador de texto do pty.

---

## D. ToS subestimado

1. **"Conectar conta" dentro do Turno.**
   - A Anthropic diz: "does not permit third-party developers to offer Claude.ai login into their own applications, or to route requests through Free, Pro, or Max plan credentials on behalf of their users". Ao mesmo tempo, isso não impede "an end user from signing in to the unmodified Claude Code binary with their own Claude subscription" (https://code.claude.com/docs/en/legal-and-compliance, "Authentication and credential use").
   - Para uso pessoal, rodar o CLI oficial num terminal visível está do lado permitido.
   - Se o Turno for **distribuído**, a UI não pode se apresentar como "login Claude do Turno". O botão deve abrir o CLI oficial, e o texto deve dizer isso.
   - As rotinas headless com assinatura (`claude -p`, Agent SDK) são o ponto mais cinza: "Developers ... including those using the Agent SDK, should use API key authentication".
   - **Correção:** acrescentar ao §5 uma linha "App distribuído vs uso pessoal". Num build distribuído, rotinas headless com OAuth de assinatura ficam desligadas por padrão.
2. **"limits assume ordinary, individual usage of Claude Code and the Agent SDK"** (mesma página). A troca automática same-provider é exatamente uso para além de "individual ordinary". O design já marca como cinza/arriscado. Acrescentar: **nunca rotacionar depois de `account_on_hold`** (A4).
3. **OpenAI.** A leitura literal proíbe contornar limites. Some-se que Free/Go não têm CLI. A cadeia "ChatGPT grátis" do usuário **não existe** no CLI. Dizer isso explicitamente na resposta ao usuário.
4. **GitHub Copilot Free.** Uma conta grátis por pessoa (ToS B.3). A Fase 4 já bloqueia a segunda. Confirmado.

---

## E. Inviabilidades / custo subestimado no Turno

- **Detectar "todos os agentes do mercado"** com sinal de limite é inviável de forma uniforme. Para a maioria, a única detecção é a parede por texto (o design admite). Os critérios de aceite da Fase 4 devem medir "troca na parede" e não "antes da parede".
- **Checkpoint pedido à sessão de saída** gasta um turno, escreve no transcript e pode bater na parede no meio. Só no `warning`, com orçamento curto, e nunca com `ask` pendente (o design já restringe).
- **Qwen local 35B como sumarizador**: latência de dezenas de segundos para resumir um transcript grande [N]. O swap na parede não pode esperar por ele. Primeiro vai o pacote determinístico; o resumo LLM chega depois como mensagem complementar.
- **safeStorage async**: está disponível no Electron 44 (`node_modules/electron/electron.d.ts:12483,12493`). A migração é viável já, e o sync fica deprecated na v45 e é removido na v46 (https://www.electronjs.org/docs/latest/api/safe-storage). Confirmado.

---

## F. Resumo das correções a aplicar no DESIGN.md

1. §3.5 passo 5: `claude stop <id>` com a home antiga e verificação de que a sessão não está viva antes do T1.
2. §3.1/§3.4: trust e onboarding mesclados obrigatoriamente. Trust ausente no destino vira `ask`.
3. §3.4: estados `blocked_auth`/`on_hold`. `account_on_hold` congela a rotação same-provider.
4. §3.4.4/§4: o ACP não tem cota padrão; `rate_limit` é dialeto (Grok). Registro com 43 agentes, mais Auggie.
5. §3.6: no Windows, entregar o handoff como arquivo + uma linha, sem bracketed paste multilinha.
6. §3.5/Fase 0: spawn direto do agente no pty (sem shell), com `windows-command-invocation` do Orca como referência.
7. `accountEnv()`: remover `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_BASE_URL` e `CLAUDE_CONFIG_DIR` herdado.
8. Remover o "bug" do `env.ts` e a remoção redundante de `CLAUDE_CODE_*`. Corrigir os caminhos `renderer/src/panels`.
9. MVP sem junctions (T1 por `transcript_path`). Junctions opt-in com `cleanupPeriodDays` uniforme.
10. Fatos de tier: Claude Free [V]; Codex Free/Go só no desktop app; Codex Pro sem janela de 5h; Gemini 18/06 [S]; Qwen [V]; Copilot por créditos; aviso de 80% do Kiro [N].
11. Candidatos do app "todos grátis": acrescentar cc-switch, CAAM, ReRouted e Agent Relay.
12. Faixa como overlay DOM (ConPTY).
13. Snapshot `git stash create` antes de matar na parede. Folga mínima no destino contra ping-pong.

## Fontes
- https://code.claude.com/docs/en/sessions · /statusline · /hooks · /settings · /settings-reference · /authentication · /legal-and-compliance
- https://agentclientprotocol.com/protocol/prompt-turn
- https://learn.chatgpt.com/docs/pricing
- https://docs.github.com/en/copilot/get-started/plans
- https://kiro.dev/docs/billing/
- https://www.electronjs.org/docs/latest/api/safe-storage
- https://community.openai.com/t/codex-app-cannot-resume-session-after-api-key-switch-encrypted-content-organization-id-mismatch/1374803
- Secundárias: aiweekly.co/node/3134, computingforgeeks.com (Gemini → agy); inventivehq.com/blog/qwen-code-still-free-2026-shutdown; knightli.com (cc-switch)
- Código: `C:\rx\orca\src\main\claude-accounts\claude-profile-history.ts:28-39`; `...\claude-profile-provisioning.test.ts:179-181,295`; `C:\rx\orca\src\main\acp\acp-dialects\grok-dialect.ts:37`; `...\acp-turn-failures.ts:13,100-103`; `C:\rx\orca\src\renderer\src\components\terminal-pane\terminal-agent-paste-bracketing.ts:8-21`; `C:\rx\cux\internal\paths\paths.go:80` (encoding só troca o separador, confirmando o bug `C:-Users`); `turno\src\main\env.ts:6,9`; `pty.ts:33-38,53-63`; `abort.ts:35-70`; `runner.ts:385-398`; `termsessions.ts:10,106-108`; `settings.ts:55-56`; `renderer\src\panels\TerminalPanel.tsx:64,208-232`; `RunViewer.tsx:469-487`; `node_modules\electron\electron.d.ts:12483,12493`.
