# Tasks externas, hub de MCP, conexões e dores dos devs: o que vale construir no Turno

Pesquisa de 21/10/2026. Consolida a recomendação (`integracoes/RECOMENDACAO.md`) com as correções da revisão adversarial (`integracoes/CRITICA.md`). As notas brutas, com todas as fontes, estão em `docs/research/integracoes/`:
- `orca-integrations.md`: como o Orca faz;
- `trackers.md`: rastreadores mais usados e suas APIs;
- `mcp-landscape.md`: MCP nos agentes;
- `connections.md`: Sentry, AWS, Bitbucket etc.;
- `pains.md`: dores dos devs;
- `competitors.md`: concorrentes;
- `turno-fit.md`: onde isso entra no Turno.

Legenda: **[V]** fonte primária; **[S]** secundária; **[U]** não verificado.

**Regra usada:** uma feature só entra se tiver três coisas:
- uma dor real com evidência;
- um motivo para os agentes e as outras ferramentas ainda não resolverem;
- um custo de manutenção estimado.

Custo: **P** (pequeno), **M** (médio), **G** (grande, com manutenção contínua).

---

## 1. Respostas curtas

| Pergunta | Veredito |
|---|---|
| Puxar tarefas além do GitHub (Jira, Monday…)? | **Sim para GitHub e Jira** (fase 1). GitLab (via `glab`), Linear e Azure DevOps ficam **sob demanda**. **Monday, Asana, ClickUp, Notion e Trello não ganham tela**: entram como "servidor MCP customizado" para o agente usar (todos têm MCP oficial, menos o Trello [U]). |
| Hub de MCP no Turno? | **Vale, como lançador, não como catálogo nem gateway.** Um lugar só para cadastrar servidores e segredos. O Turno injeta o conjunto escolhido **por sessão ou rotina** (`--mcp-config` + `--strict-mcp-config`), sem editar `~/.claude`. Cada CLI já resolveu o próprio escopo. O que nenhuma resolve é **entre CLIs, por run, segredo fora de arquivo e checagem antes de rotina**. |
| Instrução inicial listando MCPs e conexões para todos os agentes? | **Não do jeito proposto. Sim numa versão menor.** Listar MCPs e ferramentas é redundante, porque o protocolo já entrega isso ao agente. Ligar tudo em todo agente aumenta o risco de prompt injection e piora a escolha de ferramentas. O que vale é um **cartão de contexto** curto (5–15 linhas), por pasta ou rotina, com só o que o agente não descobre sozinho. Ver §4.2. |
| Quais conexões? | **Essenciais:** GitHub (via `gh`), Atlassian Rovo (Jira + Confluence; Bitbucket com ressalva), Sentry e "customizado". **Depois:** AWS só leitura, Grafana/Datadog, Postgres só leitura, Playwright/DevTools. **Não fazer:** marketplace, gateway próprio, OAuth próprio, Slack como ferramenta do agente, Monday/ClickUp/Asana nativos. |

**Mais importante que tasks e MCP:** as maiores dores desses apps são quatro:
- limite de uso;
- "qual agente está esperando por mim?";
- revisar o diff;
- agendador que falha em silêncio.

Duas coisas baratas devem vir **antes** de tasks e MCP: o status por aba e o medidor de uso.

**Alerta estratégico:** o fabricante está absorvendo features desse tipo de app. O Claude Code já tem:
- agent view, com status "precisa de input" e notificações;
- `claude agents --json`;
- sessões em background;
- `/loop`;
- tarefas agendadas no Desktop;
- Remote Control.

O Codex app tem Automations, e Cursor, Orca e Superset também têm agendador. Por isso **cada feature do plano precisa passar pelo teste "o Claude ou o Codex já fazem isso nativamente?"**. O que resiste é o que só o Turno tem:
- **multi-CLI e multi-conta** (o agent-pool);
- **Windows de primeira classe**;
- **ntfy**;
- **rotinas locais** com precheck e keep-awake.

---

## 2. Maiores dores dos devs com apps parecidos

| # | Dor | Evidência (reações em issues etc.) | Turno hoje | O que fazer |
|---|---|---|---|---|
| 1 | **Limite de uso e falta de visibilidade de custo** | claude-code #16157 (726 reações / 1499 comentários), #38335 (544), #18435 trocar de conta (1159); codex #1986 mostrar 5h/semana (151); SO 2025: 53,3% citam custo como barreira [V] | parcial | Medidor 5h/7d sempre visível e **retomar após o reset**. Já está no `agent-pool.md` |
| 2 | **"Qual agente está esperando por mim?"** | claude-code #57230 (51), HN ("easy to forget about one… paused waiting for confirmation"), Orca #4375/#13600 (7–9) [V/S] | não | Status por aba (rodando, precisa de input, de permissão, terminou, erro) e lista "Precisa de mim"; ntfy **só** no fim do turno ou em pedido de permissão. Para o Claude, ler **`claude agents --json`**, que já traz `status` e `waitingFor` (é research preview); hooks e saída do terminal ficam como fallback para os outros CLIs |
| 3 | **Revisar o diff é o gargalo** | codex #2998 (238), zed #59157 (150), Orca #1099 (78, diff de vários repos); SO 2025: 66% acham as respostas "quase certas, mas não" [V] | não | Aba "Mudanças" por run (git diff do worktree) e resumo final: arquivos, comandos, testes |
| 4 | **Agendador que falha em silêncio** | Claude Desktop #55565, #80037 (fechados, 0 reações: evidência fraca, mas plausível) [V] | parcial | Mostrar o **motivo** de cada pulo ou falha; checar antes da rotina se o MCP precisa de novo login, e avisar pelo ntfy. As duas coisas são baratas |
| 5 | **Worktrees: .env, portas, limpeza** | claude-squad #260, vibe-kanban #765/#1947, claude-code #23622; HN: "every worktree needs its own ports" [V/S] | parcial (`worktree.ts`) | `.worktreeinclude`, script de setup por projeto, limpeza de órfãos |
| 6 | **Windows e Linux tratados como segunda classe** | Conductor só macOS; codex #11023 (1464); claude-code #4928 (235) [V] | ✅ diferencial | Assinar o instalador; testar caminhos com espaço e barra invertida |
| 7 | **Permissões: prompts demais ou pular tudo** | claude-code #28240 (209); Crystal e Superset forçam skip-all [V] | parcial | Perfis por rotina ou sessão; nunca forçar skip-all |
| 8 | **Tarefas longas longe do PC / celular** | codex #10450 (878), #9224 (544) [V] | ✅ agendador, keep-awake, ntfy | depois: ações pelo ntfy (com token, sem expor a máquina) |
| 9 | **Configurar MCP em cada CLI, segredos em arquivo** | 24.008 segredos em configs MCP públicas, 2.117 válidos (GitGuardian 2026) [S]; 7+ formatos de config; rotinas `-p` carregam o `.mcp.json` de qualquer repo sem perguntar [V] | não | §4 |
| 10 | **Privacidade e login obrigatório** | telemetria do Vibe Kanban, Conductor pedindo acesso total ao GitHub; SO 2025: 81,4% preocupados [V/S] | ✅ local, sem login | toda integração opcional e com escopo mínimo |
| 11 | **Ferramentas abandonadas** | Vibe Kanban perdeu a empresa e voltou a ser local; Crystal descontinuado [V] | — | ser uma camada fina sobre as CLIs oficiais; não clonar rastreador |

Correções da revisão:
- **"Contexto perdido / resume quebrado" saiu da lista.** A evidência citada era de outro assunto, e o resume de qualquer pasta já é nativo do Claude desde a v2.1.223.
- **Issues com 0 reações** não contam como "volume".

---

## 3. Tasks: o que puxar e como

### 3.1 Uso entre devs profissionais (Stack Overflow 2025, "documentation and collaboration tools") [V]

| Ferramenta | Uso | Decisão |
|---|---|---|
| GitHub (plataforma) | 80,5% | **Fase 1**, via `gh` (sem segredo no Turno) |
| Jira | 52,1% | **Fase 1**, REST pequeno (e-mail + API token; Server/DC com PAT) |
| GitLab | 36,7% | sob demanda, via `glab` (aparece só se estiver instalado) |
| Confluence | 36,5% | é documentação: entra pelo Rovo MCP, não como task |
| Azure DevOps | 18,6% | sob demanda; caminho barato `az boards query --wiql` com PAT [U] |
| Notion | 17,2% | mais documentação e gestão do que rastreador de dev: MCP customizado |
| Trello | 13,9% | kanban genérico: MCP customizado |
| Asana | 4,5% | MCP customizado |
| ClickUp | 4,2% | MCP customizado |
| Linear | 4,1% (pouco no geral, forte em startups de IA [S]) | sob demanda; API com `branchName` bom |
| Monday | 2,6% | MCP customizado (`mcp.monday.com/mcp`, oficial) |

**Resposta direta:** dá para puxar o Jira de forma nativa. Para o Monday e afins, não compensa uma tela:
- **Uso baixo:** abaixo de 5% dos devs, cada um.
- **Nenhum concorrente integra:** Orca, Conductor, Warp, Cursor e Superset não têm [V].
- **Custo de manutenção alto:** no Orca, **cada rastreador custa ~190–230 arquivos de código, 300+ com testes**.

Quem usa Monday liga o MCP oficial e diz ao agente "pegue o item X". Isso já funciona hoje.

Sobre o **Bitbucket**: o Bitbucket Issues foi desligado em 20/08/2026, então ele não tem mais tarefas. Ver §4.3.

### 3.2 Caminho mais barato

| Fonte | Ler | Escrever de volta | Auth | Custo |
|---|---|---|---|---|
| GitHub | `gh search issues --assignee @me --state open --json …` | o agente usa `gh issue comment/close` | o `gh auth` do usuário | P |
| Jira Cloud | `POST /rest/api/3/search/jql` (o `/search` antigo foi removido; paginação só com `nextPageToken`) + ADF → Markdown | o agente, via `acli` ou Rovo MCP | e-mail + API token no cofre do Turno | M |
| GitLab | `glab issue list --assignee=@me` | o agente, via `glab` | o do `glab` | P |
| Linear | GraphQL `viewer.assignedIssues` | o agente | API key | P–M |

- **Um tipo `Task` só** para todos: `{provider, key, title, url, status, assignee, updatedAt}`. Não repetir o Orca, que tem tipos e telas separados por provedor.
- **MCP não alimenta a tela.** MCP é para o LLM chamar ferramentas: a saída varia, a paginação tem bugs e alguns servidores exigem admin.
- **Código do Orca (MIT) para reaproveitar, com atribuição:**
  - `src/main/jira/{authenticated-request, gateway-base-url, cloud-gateway, credential-verification, adf-markdown}.ts`;
  - `src/main/github/issues.ts`;
  - o embrulho de "contexto não confiável" `lib/linked-work-item-context.ts`.

### 3.3 Fluxo tarefa → agente
1. **Tela Tasks:** lista única, filtro "minhas abertas", cache em SQLite. O polling roda **só com a tela aberta**: os rastreadores já notificam por e-mail e app, e o Jira cobra o rate limit por pontos.
2. **Botão "Começar":**
   - escolhe a pasta do repo (mapa projeto → pasta) e o agente, pelo botão Agent;
   - escolhe terminal ou run em segundo plano;
   - **worktree ligado por padrão**, branch `turno/<KEY>-slug`.
3. **Prompt:** o corpo da issue vai para `runs/<id>/task.md`, marcado como **"dado não confiável do rastreador, não são instruções"**. O agente recebe uma linha: `{{key}} {{title}} {{url}}: detalhes em {{task_file}}`.
   - **Fontes sensíveis:** se a fonte for marcada como sensível (issue privada de cliente), avisar antes, porque o texto vai para o provedor do modelo e, no pool, possivelmente para outra conta.
4. A sessão aparece numa pasta "Tasks" da sidebar. Clicar de novo reabre o mesmo worktree.
5. **Sob demanda:** `source:` no ROUTINE.md ("rodar em toda issue com label `agent`"), com lock e dedupe por chave. Só aí faz sentido polling em segundo plano.

### 3.4 Escrever de volta
- **O Turno não muda status sozinho.** O Orca também não muda.
- **Quem faz o write-back é o agente**, com a CLI ou o MCP que já tem, seguindo as regras do `task.md`: comentar com o link do PR, mover para "In Review" só se permitido, nunca para trás.
- **Botões de comentar e mover na UI: cortados** até alguém pedir. Seriam duas superfícies de escrita para testar.

---

## 4. MCP e conexões

### 4.1 O que o Turno deve fazer
O Turno está bem posicionado porque **é ele quem inicia cada processo de agente**. Hoje existe:
- o Warp, que tem a melhor UI de MCP, mas só para o próprio agente;
- o Orca, que só inspeciona configs e aceita `--mcp-config` manual.

**Nenhum app tem um registro gerenciado que injete por run em várias CLIs.**

| # | Feature | Por que | Custo |
|---|---|---|---|
| A | **Registro único** `userData/mcp-hub.json`: id, transporte, comando/url, env com `${TURNO_MCP_X}`, pastas onde vale, "usar em rotinas" (opt-in), allowlist de ferramentas, 1 linha de contexto | cada CLI tem um formato (JSON, TOML, `url`/`httpUrl`/`serverUrl`) | M |
| B | **Cofre de segredos**: o `secrets.ts` (safeStorage/DPAPI) passa os segredos só ao processo filho | as CLIs guardam token em texto puro (Codex, Gemini) [V] | P |
| C | **Injeção por sessão/rotina sem editar configs**: Claude com `--mcp-config <temp>` + `--strict-mcp-config` + `--allowedTools` vindo da allowlist; arquivo temporário só com placeholders, permissão só do dono, apagado no fim | só quem lança o processo escolhe o conjunto por run | M |
| D | **ROUTINE.md `mcp: [ids]`**, com strict por padrão. Id desconhecido gera aviso e nunca amplia o acesso | rotina sem supervisão + prompt injection vindo de dados | P |
| E | **Painel de status só leitura**: importa (lê, nunca escreve) `~/.claude.json`, `.mcp.json` e `~/.codex/config.toml`; mostra "precisa de login", "falhou" e o nº de ferramentas, a partir do `system/init` que o `runner.ts` já lê; botão "Login" abre o terminal com `claude mcp login <nome>` | o agente só descobre a falha no meio do run | P–M |
| F | **Checagem antes de rotina agendada**: servidor alcançável e logado; senão, pula com o motivo e manda ntfy ("Sentry precisa de novo login") | OAuth quebra em headless | P |
| G | **Presets curtos** + "colar URL / comando" | facilidade | P cada |

**Não fazer:**
- **marketplace ou catálogo:** Docker MCP Toolkit, ToolHive e Smithery já existem;
- **gateway ou proxy próprio:** só embutir um existente (mcp-proxy, 1MCP) se o problema de processos duplicados aparecer de verdade;
- **OAuth próprio:** as CLIs já têm o próprio login;
- **o Turno chamar ferramentas MCP ele mesmo;**
- **escrever nos configs dos agentes;**
- **expor um servidor MCP do Turno:** se for preciso, uma CLI pequena + uma skill, como faz o Orca;
- **injetar em Gemini/Antigravity agora:** só há override em nível de sistema;
- **Codex via `-c mcp_servers…`:** não verificado para definir um servidor inteiro. O Codex fica com o config dele até testar.

**Detalhes técnicos que entram no aceite:**
- **Prefixo:** usar sempre `TURNO_MCP_` nos placeholders. Em servidor remoto, o Claude Code lê como vazias as variáveis com nome de credencial conhecida (`ANTHROPIC_API_KEY`, `NPM_TOKEN`…).
- **Remoção:** **nunca** usar `claude mcp remove` para limpar o hub, porque isso apaga o login OAuth do usuário.
- **Login OAuth:** é guardado por endpoint, então provavelmente vale também via `--mcp-config` [U, testar primeiro]. No agent-pool, cada `CLAUDE_CONFIG_DIR` precisa do próprio login MCP, e o conjunto tem que ser repassado a cada resume ou troca de conta.

### 4.2 A ideia da "instrução inicial": avaliação honesta
- **Redundante:** o Claude Code já carrega nomes de ferramentas e instruções de servidor (com tool search ligado por padrão). Os outros CLIs recebem as definições pelo protocolo. Dizer "você tem sentry, aws, jira" não ensina nada.
- **Envelhece:** o system prompt é gravado no 1º request e reaproveitado no `--resume`. Isso vale também para o cartão; "cartão novo = sessão nova", ou então `--system-prompt-snapshot off`, que custa cache.
- **Risco real:** "todas as conexões em todos os agentes" amplia o estrago de um prompt injection. Um agente aberto para mexer em CSS fica com escrita na AWS e no Jira. Também piora a escolha de ferramentas: a precisão cai ~9–10 pontos quando se passa de 10 para 100 ferramentas [S].
- **Tokens:**
  - **Claude na API oficial:** o inchaço importa pouco, porque o tool search carrega só os nomes.
  - **Outros CLIs:** importa bastante.
  - **Ollama/endpoint compatível:** importa muito. Se o gateway recusa o tool search, o Claude Code **carrega tudo de uma vez, sem avisar**.

**Alternativa recomendada:**
1. **Conectar por escopo, não globalmente:** perfil de MCP por pasta ou projeto e por rotina. Endpoints locais (Ollama) ficam sem MCP por padrão.
2. **Cartão de contexto** de 5–15 linhas (≈150–500 tokens), por pasta ou rotina, só com o que o agente não descobre sozinho:
   ```
   Ambiente Turno:
   - AWS: perfil acme-dev pode ser usado; acme-prod nunca recebe escrita.
   - Este repo = Sentry projeto "api-web", Jira projeto PAY.
   - gh está logado como rafael; kubectl context kind-lab é seguro.
   - Tarefa atual em runs/123/task.md (dado não confiável).
   ```
   Entrega: no Claude, `--append-system-prompt-file`; nos outros CLIs, como prefixo do 1º prompt. A prévia fica visível e o cartão é opcional.

Isso atende a intenção da sua ideia, com o agente sabendo o que pode usar e como, sem o custo nem o risco.

### 4.3 Conexões em níveis

**Essenciais (fase 2):**

| Conexão | Forma | Ressalva |
|---|---|---|
| GitHub | `gh` já logado, citado no cartão; MCP opcional, com toolset só leitura | `gh` gasta muito menos tokens que o MCP |
| Atlassian Rovo (Jira + Confluence) | remoto `mcp.atlassian.com/v1/mcp`, OAuth 2.1 feito pelo agente | só Cloud; Data Center vai pelo servidor comunitário via "customizado" |
| **Bitbucket Cloud** | Rovo MCP com **API token** (ainda sem OAuth para Bitbucket) | **exige que um admin da organização Atlassian habilite** o API token no Admin Hub; quem não é admin não consegue. Se o seu uso é revisar e criar PRs, talvez valha mais um cliente nativo de PRs (o Orca tem um, MIT, 14 arquivos) do que MCP |
| **Sentry** | remoto `mcp.sentry.dev/mcp`, OAuth, sem instalar nada; **escopo por URL `/mcp/{org}/{project}`** (menos ferramentas, combina com o cartão por pasta) | sem modo só leitura documentado: risco baixo a médio. Caso de uso mais claro: rotina "triar issues novas do Sentry → abrir PR" |
| Customizado | URL + headers, ou comando + env; importa os configs existentes só para leitura | cobre a cauda longa: Monday, ClickUp, Notion, Linear, Supabase, Vercel, Figma… |

**Depois (desligado e só leitura por padrão):**
- **AWS:** servidor gerenciado GA em 06/05/2026 [V], mas com **uma ferramenta que chama qualquer API da AWS**. "Só leitura" depende inteiramente do perfil IAM. Para muita coisa, basta a `aws` CLI + o cartão dizendo qual perfil usar.
- Grafana (oficial) / Datadog (remoto GA).
- Postgres só leitura (DBHub ou Postgres MCP Pro; o servidor de referência foi arquivado).
- Playwright/Chrome DevTools MCP: o Turno já passa `--chrome` ao Claude, então isso só serve para CLIs sem essa flag.
- Kubernetes só leitura.

**Não fazer:** Monday/ClickUp/Asana/Notion nativos (o customizado resolve), Slack como ferramenta do agente (vaza PII; o ntfy cobre notificação), New Relic (preview), LogRocket (sem MCP), presets Azure/GCP sem pedido, lista longa de presets (Supabase, Vercel, Cloudflare, Neon, Figma, PostHog: ficam só como exemplos do customizado).

### 4.4 Riscos que o design tem que cobrir
- **Prompt injection** vinda de ticket ou evento do Sentry somada a ferramentas com escrita. Defesas: worktree por padrão, nunca bypass, presets só leitura, strict em rotinas.
- **Segredo em env** é legível pelo Bash do agente. Defesas: o arquivo temporário só leva placeholders; avaliar `headersHelper` para manter o token fora do env.
- **Cadeia de suprimentos:** `npx …@latest` executa código remoto a cada launch (caso `postmark-mcp`). Defesas: fixar versões, mostrar o comando antes de ativar e alertar se a descrição das ferramentas mudar depois de aprovada.
- **Nomes duplicados** entre o config do usuário e o hub. Defesa: prefixo `turno-` ou strict.

---

## 5. O que concorrentes têm e ninguém usa (evitar)
- **Kanban ou rastreador próprio** (Vibe Kanban, Nimbalyst).
- **Telas de task por provedor com edição completa** (Orca): centenas de arquivos por provedor.
- **Monday/Asana/ClickUp nativos:** nenhum concorrente fez.
- **Navegador embutido, emuladores, computer use, voz** (Orca): amplitude que vem junto com reclamações de bugs e memória.
- **Sandboxes ou rotinas na nuvem** (Cursor, Warp, Conductor): custo e infraestrutura.
- **Dezenas de gatilhos por automação** (Superset): começar com um, Sentry ou PR do GitHub.
- **Servidor MCP ou SDK próprio do app;** marketplace de MCP.

---

## 6. Plano em fases

### Fase 0: barato e de maior valor (antes de tasks e MCP)
1. **Status por aba + lista "Precisa de mim"** (dor 2).
   - Claude: `claude agents --json` (`status`, `waitingFor`).
   - Outros CLIs: hooks por sessão e observação da saída.
   - ntfy só no fim do turno ou em pedido de permissão.
   - Atenção: injetar hooks com `--settings` pode **substituir** os hooks do usuário naquela sessão [U]. Por isso o `agents --json` vem primeiro.
   - *Aceite:* uma aba que pede permissão fica marcada em ≤ 2 s e manda **um** ntfy. **M**
2. **Medidor de uso 5h/7d + retomar após o reset** (dor 1; parte do agent-pool). **M**
3. **Isolar as chamadas internas do Turno.**
   - Hoje o `src/main/ai.ts` chama `claude -p` sem `--strict-mcp-config`, e o helper de linguagem natural carrega **todos os MCPs e hooks do usuário**.
   - Corrigir como o Orca faz: `--strict-mcp-config` + `--settings '{"disableAllHooks":true}'`, repetindo sem strict se uma política enterprise recusar. **P**
4. **Motivo de pulo ou falha visível em cada run de rotina** (dor 4). **P**

### Fase 1: Tasks (GitHub + Jira)
- **Arquivos novos:** `src/main/tasks/{types,github,jira}.ts`, cache SQLite, IPC, tela Tasks, seção "Integrações" ao lado de Connections.
- **Mudanças:**
  - `Integration`, `SidebarItem.taskRef` e `RunRequest.contextFile` nos tipos;
  - `integrations[]` no `settings.json`, só metadados;
  - tokens no cofre;
  - runs ad hoc com `isolation:'worktree'`.
- **Aceite:**
  - com `gh` logado, "minhas issues abertas" aparecem sem configurar nada;
  - o Jira pagina por `nextPageToken`;
  - "Começar" cria o worktree, grava o `task.md` não confiável e abre o agente;
  - clicar de novo reabre o mesmo worktree;
  - nenhum token aparece em settings, log ou argv.
- **Custo:** M (~10–15 arquivos).

### Fase 2: Hub de MCP (Claude primeiro)
- **Antes de codar, testar:**
  - se o login de `claude mcp login` vale via `--mcp-config`;
  - o mesmo endpoint em `CLAUDE_CONFIG_DIR` diferentes;
  - o `--strict-mcp-config` sob política enterprise.
- **Arquivos:**
  - novo `src/main/mcphub.ts`;
  - `mcp`/`strict_mcp` no ROUTINE.md;
  - `runner.ts` passa `--mcp-config runs/<id>/mcp.json --strict-mcp-config --allowedTools …`;
  - painel de status lendo `system/init`;
  - presets: Sentry, Atlassian Rovo, GitHub só leitura e customizado.
- **Aceite:**
  - rotina sem `mcp:` roda com **zero** servidores, mesmo com `.mcp.json` no repo;
  - rotina com `mcp: [sentry]` vê só o Sentry, e o arquivo no disco só tem placeholders;
  - o hash de `~/.claude.json` fica igual antes e depois;
  - servidor sem login: run pulado com motivo + ntfy;
  - id desconhecido gera aviso e não amplia o acesso.
- **Custo:** M.

### Fase 3: Cartão de contexto + perfis de MCP por pasta e rotina
- **Escopo:** prévia visível; Ollama sem MCP por padrão.
- **Aceite:** ≤ 15 linhas e ≤ 500 tokens; o resume e a troca de conta do agent-pool repassam o mesmo conjunto.
- **Custo:** P.

### Fase 4: só sob demanda
- `source:` em rotinas;
- GitLab, Linear e Azure DevOps na tela de Tasks;
- injeção no Codex (depois de verificar);
- presets AWS, Grafana/Datadog e Postgres só leitura;
- cliente de PRs do Bitbucket, se for o seu caso;
- gateway embutido, só se processos stdio duplicados virarem um problema medido.

---

## 7. Perguntas para você
1. Quais rastreadores você e o público do Turno usam de verdade? Se ninguém próximo usa Jira, a fase 1 pode ser só GitHub.
2. O Monday era pedido de alguém específico ou só um exemplo? Se for de alguém, preset MCP + cartão de contexto resolve sem tela: tudo bem?
3. **Bitbucket:** Cloud ou Data Center? E o que você faz nele: revisar e criar PRs, pipelines? O Rovo exige que um admin da organização habilite o API token.
4. A fase 0 (status por aba, medidor de uso, isolar `ai.ts`, motivo de pulo) pode vir antes de tasks e MCP?
5. **AWS:** você quer o agente com acesso real às contas, mesmo só leitura, ou basta o cartão dizer qual perfil da `aws` CLI usar?
6. Cartão de contexto: por pasta + rotina (recomendado), ou também global?
7. Codex e outros CLIs precisam do hub já, ou o Claude primeiro basta?
8. Rotinas por fonte ("rodar o agente em toda issue com label X") te interessam? Isso mexe em consumo de cota.

---

## Fontes principais
- **Stack Overflow Developer Survey 2025:**
  - survey.stackoverflow.co/2025/technology
  - survey.stackoverflow.co/2025/ai
- **Claude Code:**
  - code.claude.com/docs/en/mcp
  - code.claude.com/docs/en/cli-reference
  - code.claude.com/docs/en/agent-view
  - code.claude.com/docs/en/desktop-scheduled-tasks
- **Codex:** learn.chatgpt.com/docs/extend/mcp
- **Gemini:** geminicli.com/docs/tools/mcp-server
- **ACP:** agentclientprotocol.com/protocol/session-setup
- **Atlassian:**
  - Rovo MCP: developer.atlassian.com/cloud/rovo-mcp/guides/authentication-and-authorization
  - Rovo + Bitbucket: atlassian.com/blog/bitbucket/the-atlassian-rovo-mcp-server-now-supports-bitbucket-cloud
  - fim do Bitbucket Issues: community.atlassian.com/forums/discussion/3193882
  - Jira `/search/jql`: KB da Atlassian
- **GitLab MCP:** docs.gitlab.com/user/model_context_protocol/mcp_server (GA desde a 19.5, em todos os tiers, precisa ser habilitado)
- **Monday:** developer.monday.com/api-reference/docs/mondaycom-mcp
- **Sentry:** mcp.sentry.dev
- **AWS:** aws.amazon.com/about-aws/whats-new/2026/05/aws-mcp-server
- **Supabase:** supabase.com/docs/guides/ai-tools/mcp
- **Grafana:** grafana.com/docs/grafana/v13.1/developer-resources/mcp
- **Datadog:** datadoghq.com/blog/datadog-remote-mcp-server
- **Segurança:**
  - invariantlabs.ai/blog/mcp-github-vulnerability
  - snyk.io/blog/malicious-mcp-server-on-npm-postmark-mcp-harvests-emails
  - blog.trailofbits.com/2025/04/30/insecure-credential-storage-plagues-mcp
  - GitGuardian via snyk.io/articles/state-of-secrets
- **Concorrentes:**
  - docs.warp.dev/knowledge-and-collaboration/mcp
  - docs.superset.sh/automations
  - vibekanban.com/blog/shutdown
  - conductor.build/changelog
- **Código do Orca (MIT):** `src/shared/task-providers.ts`, `src/shared/mcp-config.ts`, `src/shared/claude-background-run-isolation.ts`, `src/main/{jira,linear,github,gitlab,bitbucket,azure-devops}/`
