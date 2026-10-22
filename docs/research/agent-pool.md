# Botão "Agent": várias sessões de agentes, ranking e troca automática no limite

Pesquisa de 21/10/2026. Consolida o design do arquiteto (`agent-pool/DESIGN.md`) com as correções da revisão adversarial (`agent-pool/CRITIQUE.md`). As notas brutas, com linhas de código e fontes, estão em `docs/research/agent-pool/`:
- `orca-agents.md` e `orca-tasks.md`: Orca;
- `cux.md`: cux;
- `limits.md`: detecção de limite;
- `handoff.md`: passagem de contexto;
- `connectivity.md`: protocolos e agentes;
- `compliance.md`: termos de uso;
- `turno.md`: pontos de integração no Turno.

Legenda: **[V]** fonte primária (doc oficial ou código); **[O]** visto no código do Orca (engenharia reversa de endpoint não documentado); **[S]** fonte secundária; **[N]** não verificado. Nada foi rodado contra contas reais.

---

## 1. Resposta curta: a melhor forma

**O Turno passa a ser o dono da conversa, e a sessão de cada fornecedor vira uma "tentativa" descartável.** Trocar de conta ou de agente é encerrar a tentativa atual e abrir a próxima **na mesma aba**, com um pacote de continuação. É a separação Task/Dispatch que o Orca usa na orquestração.

- **Conta = um agente CLI + uma pasta de config isolada.** Cada conta usa a própria pasta: `CLAUDE_CONFIG_DIR`, `CODEX_HOME`, `KIRO_HOME`, `COPILOT_HOME`… O login é feito pelo usuário, com o comando oficial, num terminal visível. **O Turno nunca lê, copia, renova nem guarda token de assinatura.** É o modelo do Orca e o único compatível com os termos da Anthropic.
- **Ranking.** O usuário ordena as contas. O Agent abre na de maior rank que esteja com folga.
- **Detecção de "perto do limite", em três camadas:**
  - **push durante a sessão:**
    - Claude: `statusLine` com `rate_limits.five_hour/seven_day.used_percentage`, mais o hook `StopFailure` [V];
    - Codex: `token_count.rate_limits` no rollout [V];
  - **poll raro**, só para contas paradas;
  - **"parede"**: classificador de texto de erro, para os agentes que não avisam antes.
- **A troca acontece entre turnos, nunca no meio de uma ferramenta.** Com ~90% de uso, o Turno prepara o handoff. A troca ocorre no fim do turno, ou na parede, se ela vier antes.
- **Handoff em duas camadas:**
  - **T1, mesmo agente com outra conta.** Retoma *a mesma transcrição* com o comando nativo (`claude --resume <caminho do .jsonl>`), quase sem perda.
  - **T2, agente diferente.** Pacote estruturado: resumo ancorado, últimas mensagens literais, estado do git e arquivos a reler. Trocar de agente **sempre perde algo**. Nenhum protocolo, nem o ACP, importa o histórico de outro agente.
- **Termos de uso:**
  - liberado: troca automática entre **fornecedores diferentes**;
  - opt-in, no modo "Perguntar": várias contas **pagas** do mesmo fornecedor;
  - bloqueado: várias contas **grátis** do mesmo fornecedor, proxy de tokens e cadastro automático de contas.

O desenho reaproveita peças que o Turno já tem:
- o `TermHandle` separado do painel;
- a `RunViewer` que já troca a run "cabeça" sem sair da tela;
- o `parseRateLimit` das rotinas;
- o `ai.ts`, como molde de sumarizador.

---

## 2. O que aprendemos

### Orca (MIT: dá para reaproveitar código, com atribuição)
- **Não tem troca automática nem fallback.** Ao bater no limite, só oferece "Continue where you left off". O grep por autoSwitch/rotate deu zero no fonte e no app instalado. Mas tem todas as peças:
  - **Catálogo declarativo de agentes** (`shared/tui-agent-config.ts`): como detectar, lançar e injetar prompt em cada um. Junto vem a **tabela de resume** por agente (`shared/agent-resume-argv.ts`).
  - **Conta Claude = `CLAUDE_CONFIG_DIR` próprio**, em `<userData>/claude-profiles/<id>/home`:
    - provisionamento com junctions para skills, agents e plugins;
    - `.claude.json` mesclado sem `oauthAccount`;
    - antes de apagar o perfil, **desfaz as junctions**; senão, o delete apaga o histórico real.
    - Não definir `CLAUDE_CONFIG_DIR` com o caminho padrão, porque isso quebra o login do Windows Credential Manager.
  - **Feed do statusline:** um script que não imprime nada e repassa `rate_limits` para um servidor local. É o melhor detector de "perto do limite" e não gasta cota.
  - **Mover a sessão para outra conta:** espera o fim do turno, mata o processo e roda `--resume` **no mesmo pane** (`claude-session-account-move.ts`). É o esqueleto da nossa troca.
  - **Tasks/orquestração:**
    - o estado da tarefa fica fora do agente, em SQLite;
    - cada nova tentativa ganha um "contexto de despacho" montado pelo coordenador;
    - um **contador de geração cerca** eventos atrasados do processo antigo;
    - contexto grande vai para um arquivo, e o prompt só aponta o caminho;
    - a colagem é **feita uma única vez**, mesmo sem confirmação;
    - circuit breaker de 3 falhas.
  - A tela "Tasks" dele puxa issues do GitHub, do Linear e do Jira. Isso é assunto da próxima pesquisa.

### cux (GPL-3: só ideias, nenhuma linha de código)
- **Detecção pela parede:**
  - hook `StopFailure` com `error=rate_limit`;
  - lista de frases fortes ("usage limit", "hit your limit");
  - **denylist** de falsos positivos ("context window", "max tokens"). A denylist existe porque um classificador amplo já matou 20 subagentes.
- **Momento da troca:**
  - **proativa:** no fim do turno;
  - **na parede:** imediata;
  - **sem conta livre:** "estaciona" a conversa, com contagem até o reset, em vez de matar.
- **Erros a não repetir:**
  - troca **global** de `~/.claude/.credentials.json`, que afeta todas as sessões da máquina;
  - refresh de token com o client_id do Claude;
  - bug de caminho no Windows (`-C:-Users` em vez de `C--Users`).

---

## 3. Arquitetura proposta no Turno

```
Renderer                                   Main
Botão Agent + seletor  ──IPC──▶  accounts.ts   registro + ranking (accounts.json)
agentStore.ts                    profiles.ts   pasta isolada por conta
TerminalPanel (swapPty)          drivers/      um AgentDriver por CLI
Faixa "continuado em…" ◀──────   limits.ts     sinais push/poll/parede → LimitState
Painel do handoff                hookserver.ts loopback com token (statusline/hooks)
                                 broker.ts     conversa, tentativas, troca
                                 handoff.ts    pacote determinístico + resumo
                                 db.ts         agent_conversations, agent_segments, handoffs
```

### 3.1 Contas e drivers
- **`AgentDriver` (código):**
  - binário;
  - variável da pasta de config;
  - comando de login;
  - argv de novo e de resume;
  - como injetar o prompt;
  - `readyMarker` (prompt do agente pronto);
  - sondas de limite;
  - se o T1 entre contas é `verified`, `unverified` ou `blocked`.
- **`AgentAccount` (dados)**, em `%APPDATA%\turno\accounts.json`, com o mesmo leitor protegido do `settings.json`:
  - agente, rótulo, rank;
  - pasta (`profiles\<id>\home`, ou a padrão do sistema);
  - modo de troca `manual` / `ask` / `auto`;
  - limiares;
  - aceite dos termos.
- **Login:** "Conectar conta" abre uma aba de terminal com a variável da pasta definida e roda o login oficial. O Turno só **lê o resultado**: `.claude.json` ou `auth status`.
- **Provisionamento da pasta Claude:**
  - **obrigatório** mesclar `hasTrustDialogAccepted` e `hasCompletedOnboarding` do `.claude.json` padrão. Sem isso, a conta nova não roda statusline nem hooks até aceitar o trust, e o diálogo aparece no meio do handoff;
  - **MVP sem junctions** de `projects/`: o T1 usa o caminho absoluto da transcrição. Junctions ficam opt-in e, se ligadas, com `cleanupPeriodDays` igual em todas as pastas; senão, a limpeza de uma apaga o histórico das outras.
- **`accountEnv()` precisa limpar** `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_BASE_URL` e um `CLAUDE_CONFIG_DIR` herdado. Essas variáveis **vencem** o login da pasta, e todas as "contas" usariam a mesma credencial sem aviso.

### 3.2 Ranking
- **Escolha:** a conta habilitada de menor rank cujo estado seja `ok` ou `unknown` (que conta como "tem espaço"), abaixo dos limiares (5h < 90%, semanal < 95%) e fora do cooldown.
- **Folga mínima no destino**, por exemplo < 70%: o primeiro turno numa conta nova reconstrói o cache de prompt e custa mais. Sem folga, a troca fica indo e voltando.
- **Política padrão "drenar":** esgota a conta 1 antes de passar à 2. Limite por modelo (Opus/Sonnet): tenta o modelo alternativo na mesma conta antes de trocar de conta.
- **Proteções:** circuit breaker de 3 falhas de launch, no máximo 6 trocas por hora e histerese (não volta para uma conta antes do reset dela).

### 3.3 Botão Agent
- Substitui os três lançadores fixos de Claude: botão da sidebar, menu "+" e tela de boas-vindas.
- **Clique:** "Auto", a melhor conta disponível. **Seta ou clique direito:** lista dos agentes instalados, cada um com as contas e um badge de uso (`5h 42% · sem 61%` ou `esgotado até 14:00`), e "Gerenciar contas…".
- **Settings › "Agentes e contas":** lista arrastável (rank), modo de troca por conta, limiares, Conectar e Remover.
- Uma função única `agentOf(panel)` substitui as heurísticas espalhadas em `layout.ts`, `App.tsx` e `Sidebar.tsx`.

### 3.4 Monitor de limite
- **Estado normalizado:** `{conta, agente, janelas[{tipo, usedPct, resetsAt}], estado: ok|warning|exhausted|unknown|blocked_auth|on_hold, fonte: push|poll|parede}`.
- **Claude no terminal:**
  - cada sessão é lançada com `--settings <arquivo da sessão>`, sem editar `~/.claude`. O arquivo inclui:
    - o `statusLine`, que repassa ao `hookserver`;
    - os hooks `StopFailure`, `Stop`, `SessionStart` (captura `session_id` e `transcript_path`) e `Notification`;
    - `autoContinueAtUsageLimit: false`;
  - fallback: regex sobre o texto do pty ("You've used 85%…", "You've hit your … limit · resets …").
- **Ressalvas que mudam o design:**
  - `rate_limits` só chega **depois da 1ª resposta** da sessão e só para Pro/Max. Ao abrir, a conta fica `unknown`.
  - Uma janela que some do JSON significa "desconhecido", não 0%.
  - O statusline só roda depois do trust, e no Windows roda via Git Bash ou PowerShell.
- **Erros que não são limite:**
  - `account_on_hold` (suspensão/ban provável) e `oauth_org_not_allowed` **congelam toda rotação no mesmo fornecedor** e avisam. Rotacionar ali espalharia o ban.
  - `authentication_failed` pede `/login` na própria aba.
  - `overloaded` e 429 por minuto pedem backoff, sem troca.
- **Rotinas (headless):** o `rate_limit_event` com `allowed_warning` vira `warning`, e `rejected` vira `exhausted`. Hoje o `abort.ts` só lê `rejected`.
- **Codex:** `token_count.rate_limits` no rollout, ou `account/rateLimits/updated` no app-server. Detalhe: o plano **Pro não tem janela de 5h**, e o modelo precisa aceitar a ausência dela.
- **Demais agentes:** só a parede, e às vezes um `/usage` do próprio CLI. O ACP **não padroniza cota**: `stopReason` só tem `end_turn|max_tokens|max_turn_requests|refusal|cancelled`, e o `rate_limit` do Grok é dialeto próprio.

### 3.5 Broker: troca o processo, mantém a aba
1. **Destino:** `pick()` excluindo a conta atual. Se for outro fornecedor ou outro tier de custo em modo `ask`, abre a aprovação, com o handoff editável.
2. **Sem destino:** estaciona, sem matar, e retoma no reset.
3. **Cerca:** `generation++`. Eventos do pty antigo são ignorados; hoje um `pty:exit` atrasado mataria o handle novo.
4. **Entrada:** fica numa fila durante a troca.
5. **Parar o antigo:**
   - esperar o `Stop` (fim do turno). Na parede, agir já;
   - se houver um prompt de permissão aberto, estacionar, sem matar;
   - snapshot `git stash create` + `git diff --stat`, anexados ao handoff;
   - `claude stop <id>` com a pasta antiga. Se a sessão estiver em background, ela vive no daemon da pasta antiga e o resume faria *attach* e sairia com erro. Só depois, `taskkill /T /F`.
6. **Novo processo no mesmo xterm** (`swapPty`): mesmas colunas, linhas e cwd, com o env da conta nova.
   - O agente roda **direto** como processo do pty, sem shell no meio. Hoje o Turno abre um shell e digita o comando, então `pty:exit` só significa "o shell saiu". A referência é o `windows-command-invocation.ts` do Orca.
   - A faixa "continuado em…" é um **overlay no DOM**, porque o ConPTY pode apagar texto escrito antes do spawn. Depois do primeiro frame, grava uma linha no scrollback.
7. **Continuar:**
   - T1: `--resume <caminho>`, repassando explicitamente `--model`, **modo de permissão** (o `bypassPermissions` não volta sozinho), `--mcp-config`, `--add-dir` e `--settings`;
   - ou T2 com o pacote.
8. **Idempotência:** cada troca tem um `opId` gravado antes de matar. Se o Turno cair no meio, retoma o passo sem colar duas vezes.

Lock por conversa no main, porque dois painéis podem estar na mesma conversa. Ao reiniciar o Turno, a aba de agente oferece "Retomar na melhor conta disponível".

### 3.6 Handoff
- **T1 (mesmo agente):**
  - **Claude:** `--resume <caminho absoluto>`. Não verificado: se o resume sob outra pasta grava no mesmo arquivo, e a assinatura de *thinking* entre duas contas Anthropic. Se der erro, cai para T2.
  - **Codex:** T2 por padrão. Há relato de falha ao trocar ChatGPT → chave de API (org do raciocínio cifrado). Entre duas contas ChatGPT não há relato, então fica `unverified`.
  - **Demais:** `unverified` até testar com conta descartável.
- **T2 (agente diferente):**
  - **arquivo completo:** `%APPDATA%\turno\handoffs\<conversa>-<n>.md`;
  - **conteúdo:**
    - parte **determinística**, sem LLM: arquivos editados, comandos e exit code, erros, último comando possivelmente incompleto, plano/todos, `git status`/`diff --stat`/`log -5`;
    - **resumo ancorado**: intenção, decisões, preferências, feito/descoberto/falta, dúvidas;
    - **últimas 3-10 mensagens literais**;
    - instrução em texto simples, sem maiúsculas imperativas, que parecem prompt injection: "confira com git e releia X, Y antes de agir";
  - **orçamento:** ≤ 10-15k tokens ou 10% da janela do modelo de destino;
  - **redação de segredos.**
  - **Entrega no Windows:** grava o arquivo e envia **uma linha** ("Leia `<arquivo>` e continue"), por argv ou digitada. Colar várias linhas é frágil no ConPTY, porque o bracketed paste se perde e o CR envia o rascunho. Espera o `readyMarker`, envia uma vez só e confirma o início do turno.
- **Quem resume:**
  1. no `warning`, a própria sessão de saída escreve um checkpoint curto. Gasta 1 turno e só roda em modo `auto`;
  2. se a parede vier antes, **vai primeiro o pacote determinístico**. O resumo pelo Qwen local chega depois, como complemento, porque leva dezenas de segundos e a troca na parede não pode esperar.

### 3.7 UX
- Faixa: "continuado em Codex · conta B · motivo: limite 5h 92% (volta 14:00) · [ver handoff] [desfazer]".
- Barra de uso na aba, amarela no limiar e vermelha na parede. Subtítulo "handoff N". Linha do tempo dos segmentos. Painel "o que o novo agente recebeu", editável em `ask`.
- Estacionado: "Todas as contas no limite. Volta às 14:00 · [escolher outro agente] [esperar]".
- Primeira ativação: tela de consentimento, com o aceite gravado.

### 3.8 Persistência e segredos
- **`accounts.json`:** só metadados.
- **SQLite:** uso, conversas, segmentos, handoffs e log de trocas.
- **Logins:** ficam na pasta de cada conta, guardados pelo próprio CLI. No Windows, o Claude usa `.credentials.json` em texto puro, e infostealers visam esse arquivo; o Turno deve avisar.
- **`secrets.json` do Turno:** só **chaves de API** coladas pelo usuário. Migrar para `safeStorage` assíncrono (o síncrono sai no Electron 46) e escrita atômica.

---

## 4. Agentes do mercado (out/2026)

| Agente | Como o Turno conversa | Multi-conta | Grátis no CLI | Sinal de limite | Resume |
|---|---|---|---|---|---|
| Claude Code | terminal; stream-json; ACP via adaptador | `CLAUDE_CONFIG_DIR` [V] | **Não**: Claude Free não inclui Claude Code [V] | push statusline + `StopFailure` [V] | `--resume <id\|caminho>` [V] |
| Codex CLI | terminal; `app-server` JSON-RPC | `CODEX_HOME` [V] | **Não no CLI**: Free/Go só no app desktop; CLI a partir do Plus [V] | push `token_count.rate_limits` [V]; Pro sem janela 5h | `codex resume` (entre contas: T2) |
| Antigravity (`agy`, sucessor do Gemini CLI pessoal) | terminal; ACP separado | store próprio [O] | Sim; limite semanal não publicado [S] | `agy -p /usage` (não gasta cota) [O]; parede | `--conversation` [O] |
| Gemini CLI | terminal; `--acp`; stream-json | `GEMINI_CLI_HOME` [S] | Só chave de API sem pagamento (250 req/dia Flash); tier pessoal migrou para Antigravity em 18/06/2026 [S] | parede `TerminalQuotaError` [V] | `--resume` [V] |
| GitHub Copilot CLI | terminal; `--acp` | `COPILOT_HOME` [O] | Sim: Free inclui o CLI, por créditos desde 01/06/2026 [V]; **1 conta grátis por pessoa** [V] | avisos 75/90% [S]; parede [S] | `--resume=` [O] |
| Kiro CLI | terminal; `kiro-cli acp` | `KIRO_HOME` [O] | Sim: 50 créditos/mês [V] | parede; `/usage` (gasta crédito? [N]) | `--resume-id` [O] |
| Cursor CLI | terminal; ACP; stream-json | [N] | Hobby limitado [S] | parede | `--resume` [O] |
| OpenCode | terminal; ACP; HTTP | `XDG_DATA_HOME` [O] | modelos "free" do Zen, mudam sem aviso [S] | 429 `FreeUsageLimitError` [S] | `--session` [O] |
| Qwen Code | terminal; `--acp` | [N] | **OAuth grátis encerrado em 15/04/2026** [V] | depende do provedor | `--resume` [O] |
| Amp | terminal; adaptador ACP | [N] | admissão fechada [S] | [N] | [N] |
| Grok Build | terminal; ACP | `GROK_HOME` [O] | [N] | `stopReason` próprio | `--resume` [O] |
| Auggie, Kimi, Goose, Devin, Droid, Cline, Kilo, Junie, Mistral Vibe… | ACP (registro oficial com **43** agentes) | variável própria de cada um [O] | varia | só parede | ACP `session/load` (opcional) |
| OpenRouter `:free` | API | por chave | 50 req/dia, ou 1000/dia com ≥10 créditos [V] | `/api/v1/key` [V] | T2 |
| Ollama local | API local | — | ilimitado (hardware) | — | T2 (também é o sumarizador) |

**Para "conectar com todos":**
- Fase 1: drivers manuais para Claude, Codex, agy, Copilot, Kiro e OpenCode.
- Depois: drivers gerados do **registro ACP** (`cdn.agentclientprotocol.com/registry/v1/latest/registry.json`) e um "driver genérico" cadastrável (binário + variável de pasta + resume).
- Limite honesto: para a maioria dos agentes, o Turno só detecta a **parede**, não o "perto do limite".

### O app de "todas as versões grátis"
Não deu para confirmar qual você viu. Candidatos:
- **cc-switch** (`farion1231/cc-switch`): app desktop que gerencia Claude Code, Codex, Gemini e OpenCode, com proxy local e failover. É o mais provável.
- **9Router** e **OmniRoute**: proxy local que reaproveita os tokens OAuth dos CLIs e roda várias contas.
- **CAAM**, **ReRouted**: rotação com health score, gateway com ordem de fallback.
- **Agent Relay**: handoff Claude↔Codex↔Gemini. É a melhor referência de UX para o nosso T2.

Os que funcionam como **proxy de tokens de assinatura** violam os termos da Anthropic, da OpenAI, do Google e do GitHub, e houve banimentos em 2026.

**No Turno, o mesmo resultado sem proxy:**
- **Catálogo "Tiers grátis"** com **uma conta por fornecedor**, cada uma no CLI oficial:
  - Antigravity;
  - Copilot Free;
  - Kiro Free;
  - OpenCode Zen;
  - OpenRouter `:free`;
  - Gemini API sem pagamento;
  - **Ollama local como piso que nunca acaba**.
- Preset de ranking **"grátis primeiro"**, com handoff T2 entre eles.
- **Aviso honesto:** os tiers grátis estão encolhendo. Claude Code e Codex CLI não têm; Qwen saiu; Amp fechou. Uma cadeia grátis aguenta poucas horas de uso pesado por dia [N].

---

## 5. Termos de uso: o que fazer e o que evitar

| Padrão | Veredito | No Turno |
|---|---|---|
| CLI oficial, logado pelo usuário, num terminal do Turno | Permitido [V] | base de tudo |
| Troca automática entre **fornecedores diferentes**, uma conta de cada | Permitido | `auto` liberado |
| Várias contas **pagas** do mesmo fornecedor, troca manual | Cinza, aceitável | com aviso |
| Várias contas pagas do mesmo fornecedor, troca **automática** | Cinza a arriscado. Anthropic: "limits assume ordinary, individual usage" [V], e houve bans de multi-Max em fev/2026 [S]. OpenAI: proibido na leitura literal ("circumvent any rate limits") [V] | opt-in, `ask` por padrão; `auto` exige consentimento por fornecedor, cooldown e teto de trocas/hora |
| Várias contas **grátis** do mesmo fornecedor | Proibido [V] | bloqueado |
| Proxy que reaproveita OAuth dos CLIs | Proibido [V], com bans [S] | não embutir; no máximo "endpoint manual" com aviso |
| O Turno guardar ou renovar token de assinatura | Proibido para app distribuído [V] | nunca |
| Chaves de API com automação e fallback | Permitido [V] | tier "API" com teto de gasto |
| Rotinas headless (`claude -p`) com login de assinatura num app **distribuído** | Cinza. A Anthropic recomenda chave de API para quem desenvolve sobre o Agent SDK [V] | uso pessoal: ok; build distribuído: desligado por padrão |

**Recomendação:**
- Lançar com cross-provider automático e same-provider em "Perguntar".
- Sem proxy e sem tokens.
- Com consentimento gravado, faixa visível, log de trocas e nada de rotação 24/7 sem supervisão.
- **Nunca rotacionar depois de `account_on_hold`.**
- Num app distribuído, o botão "Conectar" abre o CLI oficial. A interface não pode se apresentar como "login Claude do Turno".

---

## 6. Plano em fases

**Fase 0, fundações:**
- agente rodando direto no pty, sem shell; `swapPty` com contador de geração; kill de árvore;
- watcher de sessões por pasta;
- `accountEnv()` com a limpeza das variáveis `ANTHROPIC_*`;
- `agentOf(panel)` único.

Aceite: testes de que um `pty:exit` atrasado não mata o handle novo.

**Fase 1, MVP: Claude multi-conta, troca automática na mesma aba, só T1**
- Arquivos novos: `accounts.ts`, `profiles.ts` (atribuição MIT ao Orca), driver Claude, `hookserver.ts`, `limits.ts`, `broker.ts`, `agentStore.ts`, seção "Agentes e contas".
- Mudanças: botão e menu "Agent" e as tabelas novas no SQLite.
- Aceite:
  1. Login visível de 2 contas sem alterar `~/.claude` (hash antes e depois).
  2. Badge com o % no 1º turno.
  3. Uso simulado a 92% troca no próximo `Stop`, na mesma aba, e a sessão nova responde "qual número eu pedi para lembrar?".
  4. `StopFailure rate_limit` simulado troca já. Sem conta livre, estaciona.
  5. A sessão antiga em background é parada, e a transcrição não intercala.
  6. Remover um perfil não apaga nada do histórico real.
  7. Reabrir o Turno oferece retomar.

**Fase 2, cross-agent (T2) e drivers Codex, agy, Copilot, Kiro e OpenCode:**
- handoff completo, classificador de parede por driver, entrega por arquivo + 1 linha;
- painel do handoff e aprovação entre fornecedores.

Aceite: numa troca Claude→Codex, 4 de 5 perguntas sobre a conversa anterior respondidas certo; pacote ≤ 4k tokens; zero colagem dupla em 20 trocas; 429 por minuto não troca.

**Fase 3, rotinas:**
- política `rotate_on_limit`; `allowed_warning` vira `warning`;
- `followUp` com outra conta; `resumePaused` escolhe a próxima conta.

**Fase 4, todos os agentes, tiers grátis e tier API:**
- drivers a partir do registro ACP e driver genérico;
- catálogo grátis com "último verificado" e aviso de uso para treino;
- preset "grátis primeiro → Ollama";
- tier API com teto de gasto;
- bloqueio da 2ª conta Copilot Free.

**Fase 5, robustez:** `safeStorage` assíncrono, cap por modelo, "voltar à conta prioritária após o reset", poll opcional de endpoints não documentados (só exibição).

---

## 7. Decisões que precisam de você

1. Qual app de "todas as versões grátis" você viu (cc-switch, 9Router, OmniRoute…)? Com o link dá para confirmar o mecanismo.
2. Rotação **automática** entre várias contas **do mesmo fornecedor**:
   - Claude: aceita o risco cinza em `auto`, ou fica em `ask`?
   - Codex: a leitura literal dos termos proíbe.
3. Quantas contas e de quais agentes você tem hoje? Isso define a ordem dos drivers.
4. Só terminal (como hoje), ou também uma aba "chat" estruturada (Agent SDK/ACP)? A aba chat tem sinais melhores e handoff mais limpo, mas dá mais trabalho.
5. Limiares: 90% (5h) e 95% (semanal)? Trocar no aviso, ou só preparar e trocar na parede?
6. Sumarizador: Qwen local (grátis, mais lento) ou o agente de destino?
7. O checkpoint pode ficar em `.turno/checkpoint.md` no repositório, ou só em `%APPDATA%`?
8. MVP sem junctions (só `--resume <caminho>`, mais conservador; o `/resume` interativo não lista sessões das outras contas) ou com junctions (modelo Orca)?

**Para testar com conta descartável:**
- resume entre duas contas Anthropic;
- Codex entre contas;
- textos de parede de Copilot, Kiro, Amp e Grok;
- se o `/usage` do Kiro gasta crédito;
- onde as credenciais ficam no perfil no Windows.

---

## Fontes principais

- **Claude Code:** code.claude.com/docs/en/statusline · /hooks · /sessions · /settings · /authentication · /errors · /legal-and-compliance
- **Agent Client Protocol:** agentclientprotocol.com/protocol/prompt-turn · registro: cdn.agentclientprotocol.com/registry/v1/latest/registry.json
- **Planos e cobrança:**
  - Codex: learn.chatgpt.com/docs/pricing · developers.openai.com/codex/auth · github.com/openai/codex
  - Copilot: docs.github.com/en/copilot/get-started/plans
  - Kiro: kiro.dev/docs/billing
  - OpenRouter: openrouter.ai/docs/api-reference/limits
  - Qwen Code: qwenlm.github.io/qwen-code-docs (troubleshooting)
- **Electron:** electronjs.org/docs/latest/api/safe-storage
- **Termos:** anthropic.com/legal/consumer-terms · /aup · openai.com/policies/row-terms-of-use · developers.google.com/terms · GitHub ToS §B.3
- **Código de referência:**
  - Orca (MIT): github.com/stablyai/orca
  - cux (GPL-3, só ideias): github.com/inulute/cux
  - claude-swap, cx, cli-continues
  - 9Router, OmniRoute, cc-switch
  - Amp Handoff: ampcode.com/news/handoff
  - Factory, compressão: factory.com/news/evaluating-compression
