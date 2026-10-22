# Turno — Tasks externas, hub de MCP e conexões: recomendação

Data: 21/10/2026. Base: notas em `C:\rx\notes2` (orca-integrations, trackers, mcp-landscape, connections, pains, competitors, turno-fit). Legenda das fontes: **[V]** conferido em doc oficial ou código, **[S]** fonte secundária (blog, diretório, espelho), **[U]** não verificado. Reddit não pôde ser lido diretamente; tudo o que vem de lá chegou por blog ou espelho e conta como [S/U].

Regra usada em todo o documento: uma feature só entra se tiver (a) dor ou demanda real com evidência, (b) motivo para os agentes ou outras ferramentas ainda não resolverem e (c) custo de manutenção estimado. Escala de custo: **P** (pequeno, até ~300 linhas, quase sem manutenção), **M** (médio, alguns arquivos, manutenção ocasional quando a API ou CLI mudar), **G** (grande, subsistema próprio com manutenção contínua).

---

## 1. Resumo executivo

| Pergunta | Veredito | Em uma linha |
|---|---|---|
| Puxar tasks além do GitHub (Jira, Monday etc.)? | **Vale, mas só GitHub + Jira + Linear (+ GitLab via `glab`)**. Monday, Asana e ClickUp **não** ganham tela. | Esses 4 cobrem a grande maioria dos devs. Monday é 2,6% no Stack Overflow 2025 e nenhum concorrente integra. |
| Hub de MCP no Turno? | **Vale como "lançador", não como catálogo nem gateway.** | Um lugar só para definir servidores e segredos. O Turno injeta por sessão ou rotina via `--mcp-config` + `--strict-mcp-config`, sem editar `~/.claude`. Nenhum app faz isso entre CLIs. |
| Instrução inicial listando todos os MCPs e conexões para cada agente? | **Não do jeito proposto. Sim numa versão menor.** | Listar MCPs e tools é redundante: o protocolo já entrega isso, gasta tokens, fica velho no `--resume` e anula o carregamento adiado do Claude. O que vale é um **cartão de contexto** de 5–15 linhas, por pasta ou rotina, com o que o agente não consegue descobrir sozinho (perfil AWS dev vs prod, projeto Sentry deste repo, chave Jira, regras de somente leitura). |
| Quais conexões? | **Essenciais:** GitHub (`gh`), Atlassian Rovo (Jira + Confluence + **Bitbucket**), Sentry, Playwright/Chrome DevTools, "servidor customizado". **Depois:** AWS só leitura, Grafana/Datadog, Postgres só leitura, Linear MCP, Supabase/Vercel/Cloudflare, Figma. **Não fazer:** marketplace, Monday/ClickUp/Asana nativos, Slack, gateway próprio, OAuth próprio. | Bitbucket chega "de graça" pelo Rovo MCP, que agora cobre PRs, pipelines e deploys do Bitbucket Cloud [V]. |

**O que pesa mais que tasks e MCP:** a pesquisa de dores (seção 2) mostra que os maiores problemas desses apps são **limite de uso**, **"qual agente precisa de mim?"**, **revisar diff** e **agendador que falha em silêncio**. Tasks e MCP entram no plano, mas depois de dois itens baratos de altíssimo valor: status por terminal e o medidor de uso (fase 0).

---

## 2. As maiores dores dos devs com apps parecidos

Ranking por volume de evidência (reações em issues, threads do HN, pesquisa). Coluna "Turno": ✅ já resolve, 🟡 resolve em parte, ❌ não resolve.

| # | Dor | Evidência principal | Turno | O que fazer |
|---|---|---|---|---|
| 1 | **Limite de uso e falta de visibilidade de custo** | claude-code #16157 (726 reações, 1499 comentários), #38335 (544), #19673 "hit your limit… at 84%", #18435 trocar de conta (1159); codex #1986 mostrar 5h/semana (151), #28879 (561); Orca #20512 troca automática ainda aberta; SO 2025: 53,3% citam custo como barreira [V/S] | 🟡 rotinas já interpretam rate limit; agent-pool.md desenha a troca | Medidor sempre visível (5h/7d, reset por conta, lido de arquivos locais como o Orca faz) e **retomar automaticamente após o reset**. Já está no desenho do agent-pool |
| 2 | **"Qual agente está esperando por mim?"** | claude-code #57230, #36885, #29438, #28765; #8985 (hook não dispara no VS Code); codex #10760; Orca #4375 (spam de notificações), #13600; emdash #531. HN: "very easy to forget about one and have it paused waiting for confirmation" [V/S] | ❌ ntfy só cobre rotinas; terminais não têm status | Status por aba (rodando, precisa de input, precisa de permissão, terminou, erro), toast/ntfy só no fim do turno ou num pedido de permissão, e uma lista "Precisa de mim". **Mais barato e de maior valor** |
| 3 | **Revisar o diff é o gargalo** | codex #2998 (238), zed #59157 (150), emdash #1635, Orca #1099 (78, top do Orca). SO 2025: 66% "quase certo, mas não" [V/S] | ❌ o run viewer mostra conversa, não mudanças | Aba "Mudanças" por run (git diff do worktree) e um resumo final (arquivos, comandos, testes) |
| 4 | **Agendador que falha em silêncio** | Claude Desktop: #55565 (Windows acordado tratado como "dormindo"), #95966 (~14 tarefas puladas), #74432, #73927; #80037 limite mata agentes de fundo [S, espelhos claudeissues.com] | 🟡 keep-awake, catchup e precheck já estão no ROUTINE.md | Mostrar o **motivo** de cada pulo ou falha no histórico; aviso ntfy de "MCP X precisa de novo login" antes do run |
| 5 | **Worktrees: .env, portas, limpeza** | claude-squad #260, vibe-kanban #765/#1947, claude-code #23622/#27282/#21236; HN: "every worktree needs its own ports" [V/S] | 🟡 `worktree.ts` existe | `.worktreeinclude`, script de setup por projeto, limpeza de órfãos |
| 6 | **Windows e Linux de segunda classe** | Conductor só macOS; Superset "nobody on the team daily drives windows"; codex #11023 (1464), #2860; claude-code #4928 (235); Orca #6487 (sem assinatura) [V/S] | ✅ diferencial | Assinar o instalador e testar paths com espaço e barra invertida nos hooks |
| 7 | **Permissões: prompts demais vs pular tudo** | claude-code #28240 (209), #30519, #6608/#82165 (`rm -rf`); Crystal #178 e Superset #2419 forçam skip-all [V] | 🟡 `permission_mode` por rotina | Perfis por rotina/sessão; nunca forçar skip-all |
| 8 | **Contexto perdido / resume quebrado** | claude-code #6235 (6687, top do repo), #5768, #41458 (490 sessões apagadas) [V] | 🟡 pastas com sessões salvas | Backup dos .jsonl das sessões que o Turno abriu; resume de qualquer diretório |
| 9 | **Tarefas longas longe do PC / celular** | codex #10450 (878), #9224 (544); Orca #8129 [V] | ✅ agendador, keep-awake, ntfy | Depois: botões de ação no ntfy (exige token e não pode expor a máquina) |
| 10 | **Inferno de configurar MCP e inchaço de contexto** | claude-code #7328 (225), #1774 (161), #6915 (377), #4476 (183), #26073, #28942, #87838 (`mcp list` mostra segredos), #3433; codex #2628 (162), #17265; GitHub MCP com ~42–55k tokens [V/S]; SO 2025: 34,4% dos usuários de agentes usam MCP, 46,2% acham difícil integrar com ferramentas existentes [S] | ❌ | **Seção 4.** A dor é config espalhada, segredo em texto puro, inchaço e OAuth expirando. **Não é falta de servidor** |
| 11 | **Privacidade, telemetria, login obrigatório** | Vibe Kanban (telemetria colhendo e-mails), Superset #2685, Crystal #95, Conductor pedindo acesso total ao GitHub; SO 2025: 81,4% preocupados [V/S] | ✅ local, sem login, sem backend | Toda integração opcional e com escopo mínimo |
| 12 | **Ferramentas que envelhecem e são abandonadas** | Vibe Kanban fechou (10/04/2026); claude-squad #250; Crystal descontinuado [V/S] | — | Ficar como camada fina sobre as CLIs oficiais. **Por isso não clonar integrações** |

**Leitura para tasks e MCP:** as dores 10 e 11 justificam um hub **pequeno e local**. Nenhuma dor pede "mais integrações". Pedidos de Monday, ClickUp ou Asana não apareceram em nenhuma das issues levantadas.

---

## 3. Tasks

### 3.1 Quais rastreadores, em ordem

Fonte: Stack Overflow Developer Survey 2025, tabela "Code documentation and collaboration tools" (https://survey.stackoverflow.co/2025/technology) [V]. Números de devs profissionais:

| Ordem | Rastreador | Uso | Decisão |
|---|---|---|---|
| 1 | **GitHub Issues** | 80,5% (plataforma inteira, não só Issues) | **Fase 1** — via `gh`, zero segredo no Turno |
| 2 | **Jira Cloud** (+ Server/DC) | 52,1% | **Fase 1** — cliente REST pequeno, e-mail + API token |
| 3 | **GitLab** | 36,7% | **Fase 1b** — via `glab`; só aparece se `glab` estiver instalado |
| 4 | **Linear** | 4,1% no survey, mas >40k clientes pagantes e dominante em startups AI-native [S] | **Fase 1b** — um arquivo GraphQL com API key |
| 5 | Azure DevOps Boards | 18,6% | **Só se alguém pedir.** OAuth antigo morre em 2026, MCP remoto sem DCR |
| — | Notion, Trello, Asana, ClickUp, Monday (2,6%), YouTrack, Shortcut, Plane | <5% cada (Notion/Trello são mais docs/não-dev) | **Sem tela.** Entram como conexão MCP para o agente (todos têm MCP hospedado oficial [V], exceto Trello [U]) |
| — | Bitbucket Issues | Removido em 20/08/2026 [V] | Bitbucket só importa para PR/repo → via Rovo MCP |

**Resposta direta à pergunta "dá pra puxar Jira, Monday etc.?":** Jira sim, de forma nativa. Monday e afins não valem uma tela: juntos somam menos que o Linear entre devs, nenhum concorrente integra (Orca, Conductor, Warp, Cursor, Superset [V]) e cada integração do Orca custa ~40 arquivos de manutenção. Para quem usa Monday, o caminho é ligar o MCP oficial (`mcp.monday.com/mcp`) e dizer ao agente "pegue o item X". Isso já funciona hoje sem o Turno escrever código.

### 3.2 Caminho de integração mais barato

| Rastreador | Ler (tela de Tasks) | Escrever de volta | Auth | Custo |
|---|---|---|---|---|
| GitHub | `gh search issues --assignee @me --state open --json …` | `gh issue comment/edit/close` | a do `gh auth` do usuário | **P** |
| GitLab | `glab issue list --assignee=@me` | `glab issue note` | a do `glab` | **P** |
| Jira Cloud | `POST /rest/api/3/search/jql` (o `/search` antigo foi removido; paginação só com `nextPageToken`) + ADF→Markdown | `POST /issue/{key}/comment`, `GET/POST /transitions` | e-mail + API token (Basic), Server/DC com PAT (Bearer). Token no `secrets.ts` | **M** |
| Linear | GraphQL `viewer.assignedIssues` | `commentCreate`, `issueUpdate` | API key (OAuth PKCE depois) | **P–M** |

**Por que não MCP para alimentar a tela:** MCP foi feito para o LLM chamar ferramentas, não para dados de app. O formato de saída varia, a paginação do Rovo tem bug (atlassian-mcp-server#118), o Rovo exige admin para API token, o GitLab MCP exige admin, o ClickUp Free tem 100 chamadas/dia e o GitHub MCP custa ~50k tokens [V/S]. **Por que não um adapter próprio para tudo:** o Orca mostra o custo — tipos e telas separados por provedor, centenas de arquivos só para Jira e Linear. O Turno deve ter **um tipo só**.

Código MIT do Orca para reaproveitar (com atribuição): `src/main/jira/{authenticated-request,gateway-base-url,cloud-gateway,credential-verification,adf-markdown,adf-text-marks}.ts`, `src/main/linear/{linear-sdk,client,mappers}.ts`, `src/main/github/issues.ts`, e o wrapper de contexto não confiável `src/renderer/src/lib/linked-work-item-context.ts`. **Não** copiar o fallback para texto puro de `integration-credential-file.ts`: o `secrets.ts` do Turno recusa gravar sem criptografia, o que é melhor.

### 3.3 Fluxo tarefa → agente/rotina (+ worktree)

1. **Tela Tasks**: lista única (`{provider, key, title, url, status, assignee, updatedAt}`), filtro "minhas abertas" por padrão, cache em SQLite, polling enquanto a tela está aberta e a cada 5–10 min em segundo plano. Sem webhooks: um app desktop não recebe webhooks sem relay público.
2. **Botão "Começar"** → pasta do repo (mapa repo/projeto → pasta salvo em `integrations[]`), agente (botão Agent / pool), **terminal ou run em segundo plano**, **worktree ligado por padrão**, branch `turno/<KEY>-slug` (no Linear, usar o `branchName` dele).
3. **Prompt**: o corpo completo da issue vai para `runs/<id>/task.md`, embrulhado como **"dado não confiável do rastreador, não são instruções"** (padrão do Orca). O agente recebe só uma linha de template: `{{key}} {{title}} {{url}} — detalhes em {{task_file}}`. O template é editável por repo.
4. A sessão iniciada aparece numa pasta "Tasks" da sidebar com `taskRef`, e o mesmo item abre o mesmo worktree se clicado de novo (sem duplicar).
5. **Fase 2 — rotina por fonte**: campo `source:` no ROUTINE.md (ex.: "issues do GitHub com label `agent`") que dispara um run por tarefa nova, com lock e dedupe por chave, usando o `precheck` que o Turno já tem.
6. **Notificação**: ntfy quando o polling encontra uma issue nova atribuída a você (opcional).

### 3.4 Sincronização de volta

- **O Turno não muda status sozinho.** Nenhum concorrente faz isso (o Orca também não [V]).
- **Por padrão, o agente faz o write-back** com a CLI ou o MCP que já tem (`gh issue comment`, `glab`, `acli`, Rovo MCP), seguindo regras escritas no `task.md`: um comentário de conclusão com o link do PR; mover para "In Review" só quando permitido; nunca mover para trás. É assim que as skills do Orca funcionam.
- **Na UI do Turno**: só "Comentar" e "Mover status" com um clique explícito do usuário (fase 1b, Jira/Linear). Nada de editar labels, assignee, estimativa etc. — isso é clonar o rastreador.

---

## 4. MCP e conexões

### 4.1 O que o Turno deve fazer

O problema real, com evidência (dor 10): pelo menos **7 formatos de config** diferentes entre CLIs (JSON vs TOML, `url`/`httpUrl`/`serverUrl`), segredos em arquivos (24.008 segredos em configs MCP públicas, 2.117 válidos [S, GitGuardian 2026]; Trail of Bits; Hush Security), OAuth repetido por ferramenta e por conta, contexto inchado e rotinas `-p` que **carregam o `.mcp.json` de qualquer repo sem perguntar** [V, docs Claude Code]. Nenhum app injeta um conjunto escolhido de servidores em todos os agentes que lança: o Orca só **inspeciona** configs [V] e o Warp tem a melhor UI, mas só para o próprio agente.

O Turno está bem posicionado porque **é ele quem inicia cada processo de agente**. Faça:

| # | Feature | Dor / evidência | Por que agentes e outras ferramentas não resolvem | Custo |
|---|---|---|---|---|
| A | **Um registro só** (`userData/mcp-hub.json`): id, transporte, comando/url, env com `${TURNO_MCP_X}`, escopo (pastas), "usar em rotinas" (opt-in), allowlist de tools, uma linha de contexto | #6915/#4476 (MCP por agente/projeto, 377+183), codex #2628 (162), config espalhada | Cada CLI tem seu formato; os sincronizadores (mcp-sync, mcpx…) só escrevem arquivos estáticos e nenhum cobre Claude+Codex+Cursor+Gemini | **M** |
| B | **Cofre de segredos**: reusar `secrets.ts` (safeStorage/DPAPI), passar como env só para o processo filho | #28942 (`envFile`), #87838 (segredo exposto no `mcp list`), relatórios GitGuardian/Hush | As CLIs guardam token em JSON/TOML (Codex client secret e Gemini OAuth em texto puro [V]) | **P** (já existe) |
| C | **Injeção por sessão/rotina sem editar configs do usuário**: Claude com `--mcp-config <temp>` + `--strict-mcp-config` (rotinas) + `--allowedTools` derivado da allowlist; arquivo temporário com placeholders só, ACL do dono, apagado ao fim (mantido em runs pausados). Fallback do Orca se política enterprise recusar o strict | #1774 toggle rápido (161), #7328 filtro por servidor (225); rotinas hoje herdam tudo e tools fora do `allowed_tools` são negadas em silêncio (`dontAsk`) [V, turno-fit] | Só quem lança o processo pode escolher o conjunto por run | **M** |
| D | **ROUTINE.md: `mcp: [ids]` e `strict_mcp` (padrão true)**. Id desconhecido é descartado com aviso, nunca amplia | Segurança de runs sem supervisão; prompt injection via dados (Invariant Labs/GitHub MCP [S]) | — | **P** |
| E | **Painel de status somente leitura**: importa (lê, nunca escreve) `~/.claude.json`, `.mcp.json`, `~/.codex/config.toml`; mostra needs-login/falhou/nº de tools a partir do `system/init` (`mcp_servers`, `mcp_server_errors`) que o `runner.ts` já lê; botão "Login" abre terminal com `claude mcp login <nome>` | #26073 MCP "silently fail", #24057, Warp e Conductor têm alerta de reconexão | O agente só descobre no meio do run; no headless não dá para logar | **P–M** |
| F | **Checagem antes de rotina agendada**: servidor alcançável e logado → senão pula com motivo + ntfy "Sentry precisa de novo login" | #29718/#50743 OAuth quebra em headless; dor 4 (falha silenciosa) | Nenhum agendador concorrente faz isso | **P** (reusa precheck) |
| G | **Presets curtos** (seção 4.3) + "colar URL / comando" | Configurar MCP é chato; o usuário pediu Sentry/AWS/Bitbucket | Catálogos existentes (Docker, ToolHive, Smithery) são runtimes separados | **P** por preset |

**Não fazer:**
- **Marketplace ou catálogo** — Docker MCP Toolkit, ToolHive e Smithery já existem; manter um catálogo é G e envelhece.
- **Gateway ou proxy próprio** — G, ponto único de falha, exige ser dono da lógica de OAuth. Só reconsiderar se a dor de processos stdio duplicados aparecer de fato, e aí **embutir** um existente (TBXark/mcp-proxy, 1MCP).
- **Fluxo OAuth próprio** — as CLIs já fazem (`claude mcp login`, `codex mcp login`). Preferir `auth: oauth-by-agent`.
- **O Turno chamar tools MCP ele mesmo** — vira cliente MCP; não é o produto.
- **Escrever nos configs dos agentes** (`~/.claude.json`, `config.toml`) — formatos mudam toda hora e é risco de quebrar o setup do usuário. Exportar só como "opcional com diff + backup", lá na frente.
- **Expor um servidor MCP do próprio Turno** — se precisar, uma CLI pequena + uma skill (padrão do Orca) basta.
- **Injetar em Gemini/Antigravity agora** — só há override em nível de sistema [V/U]. **Codex `-c mcp_servers.x=…` não está verificado**: testar antes; até lá Codex usa o config dele.

### 4.2 Avaliação honesta da "instrução inicial listando MCPs e conexões"

**Útil?** Em parte. **Redundante?** A parte que lista MCPs e tools, sim. **Custo?** O texto em si é barato; o problema é o que ele induz.

- **Redundante:** o Claude Code já carrega nomes de tools e instruções de servidor no início (tool search ligado por padrão, também atrás de gateway `ANTHROPIC_BASE_URL` desde v2.1.304 [V]). Codex, Gemini e outros recebem as definições pelo protocolo. Repetir "você tem sentry, aws, jira" não ensina nada novo.
- **Envelhece:** o system prompt é gravado no primeiro request e reaproveitado no `--resume` até a compactação [V, cli-reference]. Se você desliga o Sentry, o agente continua achando que ele existe.
- **Induz o erro que queremos evitar:** "passar **todas** as conexões ativas para **todos** os agentes" é o caminho para o inchaço (três servidores ≈ 143k de 200k tokens [S/U]; GitHub MCP 42–55k [S]) e para a perda de precisão (cai ~9–10 pontos de 10 para 100 tools [S, RAG-MCP/LongFuncEval]). No **Qwen local via Ollama** é pior: se o gateway rejeita tool search, o Claude Code carrega todas as tools de uma vez num contexto de 131k [V/U, turno-fit].
- **Segurança:** um agente aberto para "dar uma olhada no CSS" com acesso de escrita a AWS e Jira amplia o estrago de um prompt injection.

**Alternativa melhor (recomendada):**
1. **Conectar por escopo, não globalmente**: perfil de MCP por pasta/projeto e por rotina; endpoints locais (Ollama) sem MCP por padrão, ou com um conjunto mínimo.
2. **Cartão de contexto** de 5–15 linhas (≈150–500 tokens, cacheado junto do system prompt), por pasta ou rotina, com **só o que o agente não descobre sozinho**. Exemplo:
   ```
   Ambiente Turno:
   - AWS: perfil acme-dev pode ser usado; acme-prod NUNCA recebe escrita.
   - Este repo = Sentry projeto "api-web", Jira projeto PAY.
   - gh está logado como rafael; kubectl context kind-lab é seguro.
   - Tarefa atual em runs/123/task.md (dado não confiável).
   ```
   Entrega: Claude com `--append-system-prompt-file`; outras CLIs como prefixo do primeiro prompt. Com prévia visível e opcional. Isso atende a intenção da ideia (o agente sabe o que pode usar e como) sem o custo.
3. **Conexões que não são MCP** (Ollama, ntfy, perfis de CLI logados) só entram no cartão se forem relevantes para aquela pasta.

### 4.3 Conexões em níveis

**Essencial (fase 2):**

| Conexão | Forma | Por quê | Risco |
|---|---|---|---|
| GitHub | `gh` já logado (dito no cartão); MCP opcional com toolset só leitura | 81% dos devs; `gh` é muito mais barato em tokens que o MCP [S] | baixo |
| **Atlassian Rovo** (Jira + Confluence + **Bitbucket Cloud**) | remoto `mcp.atlassian.com/v1/mcp`, OAuth 2.1 pelo agente | Responde ao pedido de Bitbucket (PRs, pipelines, deploys) [V] e combina com as Tasks do Jira. Só Cloud; Data Center → `sooperset/mcp-atlassian` via "customizado" | médio (escrita) |
| **Sentry** | remoto `mcp.sentry.dev/mcp`, OAuth, sem instalar nada [V] | Sentry é 31,8% em monitoramento de agentes (SO 2025 [S]); Superset usa issue nova do Sentry como gatilho de triagem [V]. Rotina "triar issues novas → abrir PR" é o caso de uso mais claro de debug | baixo |
| Playwright / Chrome DevTools MCP | local, sem login | alto valor para frontend; o Turno já passa `--chrome` | baixo |
| Customizado | URL + headers, ou comando + env; import somente leitura dos configs existentes | cobre a cauda longa (Monday, ClickUp, Notion, Linear MCP, Data Center…) sem código | depende |

**Depois (desligado e só leitura por padrão, quando houver pedido):**
- **AWS** — servidor gerenciado GA em 05/2026, cross-account em 06/2026 [V]. Preset com seletor de perfil rotulado dev/staging/prod e flag de somente leitura; o IAM é o controle real. Para muita coisa, `aws` CLI + cartão de contexto basta. **Risco alto** — por isso não é essencial.
- Grafana (oficial [V]) / Datadog (remoto GA 03/2026 [S]).
- Postgres só leitura (o servidor de referência foi arquivado e seu modo só leitura pode ser burlado [S] → DBHub ou Postgres MCP Pro restrito).
- Kubernetes só leitura com seletor de contexto [S/U].
- Supabase (`read_only` + `project_ref` [V]), Vercel (beta), Cloudflare, Neon (só dev).
- Linear MCP (`/mcp/readonly`), GitLab MCP (conflito nas notas: GA em todos os tiers desde 19.5 segundo trackers.md [V] vs beta Premium/Ultimate segundo connections.md [V] — **conferir antes**), Figma, PostHog (pode virar feature flags → médio).

**Não fazer (agora):** Monday/ClickUp/Asana/Notion como integração nativa (customizado resolve), Slack como tool do agente (risco de vazar PII; o ntfy cobre notificação), New Relic (preview), LogRocket (sem MCP [U]), PlanetScale (MCP não confirmado), presets Azure/GCP até alguém pedir, integração com o Docker Toolkit, gateway próprio.

### 4.4 Riscos que o design tem que cobrir

- **Prompt injection** vindo de ticket ou evento do Sentry + tools com escrita → worktree por padrão, nunca bypass, presets só leitura, strict em rotinas, write-back só por clique.
- **Segredo em env é legível** pelo Bash do agente e por qualquer comando num terminal com shell → arquivo temporário só com placeholders; avaliar `headersHelper` para manter o token fora do env.
- **Cadeia de suprimentos**: presets com `npx …@latest` executam código remoto a cada launch (caso `postmark-mcp` [S]) → fixar versões, mostrar o comando antes de ativar e alertar se a descrição das tools mudar depois de aprovada.
- **OAuth em headless**: confirmar se o token de `claude mcp login` é reaproveitado quando o mesmo servidor vem por `--mcp-config` [U — **crítico, testar primeiro**]. No agent-pool, **cada conta (CLAUDE_CONFIG_DIR) precisa do próprio login MCP**, e o conjunto de MCP tem que ser repassado a cada resume ou troca de conta (agent-pool.md §3.5; o Orca mescla `mcpServers` por conta [V]).
- Nomes duplicados entre o config do usuário e o hub → prefixo `turno-` ou strict.

---

## 5. O que os concorrentes têm e ninguém usa (evitar)

| Feature | Quem tem | Evidência de que é peso morto |
|---|---|---|
| Kanban/rastreador próprio | Vibe Kanban, Nimbalyst | A empresa do Vibe Kanban fechou (10/04/2026) e o kanban na nuvem foi o primeiro corte; o issue mais votado agora é "Bring back old UI" (#2687); Nimbalyst sem evidência de uso [V/S] |
| Telas de task por provedor, com edição completa | Orca | Centenas de arquivos só para Jira e Linear; Orca tem >2k issues abertas e reclamações de memória [V/S] |
| Monday/Asana/ClickUp nativos | ninguém | Nenhum concorrente fez; <5% dos devs |
| Navegador embutido, emuladores, computer use, voz, publicação de artefatos | Orca | Amplitude associada a reclamações de bugs e memória [S] |
| Sandboxes ou rotinas na nuvem | Cursor, Warp, Conductor (pago) | Custo, infra, cobrança; Cursor: "cloud agent failures, going on 24h" [S] |
| 25 gatilhos por automação | Superset | Sem evidência de uso; começar com um (Sentry ou PR do GitHub) |
| Servidor MCP / SDK próprio do app | Superset, Conductor, Vibe Kanban | O Orca mostra que CLI + skill basta |
| Marketplace de MCP | Docker, ToolHive, Smithery | Já existem; o Warp acerta com "lista + status + aprovação", não com catálogo |

---

## 6. Plano em fases

Ordem por valor/custo. Caminhos são do repo `C:\Users\Rafael\Desktop\turno` (levantados em turno-fit.md; não editei nada).

### Fase 0 — Dores baratas de maior valor (antes de tasks e MCP)
1. **Status por terminal + "Precisa de mim"** (dor 2). Estado vindo dos hooks Notification/Stop do Claude e do `notify` do Codex, configurados **por sessão** (`--settings` no launch, sem tocar `~/.claude`), com fallback observando a saída do terminal; toast/ntfy só no fim do turno ou num pedido de permissão. *Aceite:* uma aba que pede permissão fica marcada em ≤2 s e chega **um** ntfy; nenhuma notificação a cada token. Arquivos: `sidebarStore.ts` (presets AGENTS), launch dos terminais, `notify`. Custo **M**.
2. **Medidor de uso 5h/7d + reset por conta, e retomar após o reset** (dor 1; já está no agent-pool.md). Custo **M** (parte do agent-pool).

### Fase 1 — Tasks (GitHub + Jira)
- Novos: `src/main/tasks/{types,github,jira}.ts` (`TaskSource {list, get, comment?, transition?}`, um `Task` normalizado), cache SQLite, IPC em `index.ts`/preload, tela Tasks no renderer, seção "Integrações" ao lado de `src/renderer/src/panels/ConnectionsSection.tsx`.
- `src/shared/types.ts`: `Integration`, `SidebarItem.taskRef?`, `RunRequest.contextFile?`. `src/main/settings.ts`: chave `integrations[]` (só metadados; `clean()` já preserva chaves desconhecidas). Tokens via `src/main/secrets.ts` (migrar para safeStorage assíncrono antes do Electron 46).
- `src/main/engine.ts`: permitir `isolation:'worktree'` em runs adhoc; reusar `worktree.ts`.
- *Aceite:* (a) com `gh` logado, "minhas issues abertas" aparecem sem configurar nada; (b) Jira Cloud com e-mail+token lista via `/search/jql` com paginação por `nextPageToken`; (c) "Começar" cria um worktree `turno/<KEY>-slug`, grava `task.md` marcado como não confiável e abre o agente com a linha de template; (d) clicar de novo reabre o mesmo worktree; (e) nenhum token aparece em `settings.json`, log ou argv.
- Custo **M** (~10–15 arquivos). Manutenção: mudanças de API do Jira (já houve a remoção do `/search`).

### Fase 1b — GitLab (`glab`) + Linear (API key) + write-back por clique
- `src/main/tasks/{gitlab,linear}.ts`; botões "Comentar" e "Mover status" com confirmação.
- *Aceite:* GitLab some da UI se `glab` não estiver instalado; status do Jira só muda depois de clique e confirmação. Custo **P–M**.

### Fase 2 — Hub de MCP (só Claude)
- **Antes de codar:** testar (1) se o OAuth de `claude mcp login` vale para o mesmo servidor passado via `--mcp-config`; (2) `--strict-mcp-config` sob política enterprise.
- Novo `src/main/mcphub.ts` (carregar/validar/gerar). `src/shared/types.ts`: `McpServerDef`, `RunRequest.mcp?: string[]`, `RoutineConfig.mcp`, `strict_mcp`. `src/main/routines.ts`: `mcp: z.array(z.string()).default([])`, `strict_mcp`. `src/main/runner.ts buildArgs`: `--mcp-config runs/<id>/mcp.json`, `--strict-mcp-config`, `--append-system-prompt-file`, allowedTools mesclado; env `TURNO_MCP_*` passado ao filho (e pelo sandbox). Painel de status lendo `system/init`. Presets: Sentry, Atlassian Rovo, Playwright/DevTools, GitHub (só leitura), customizado.
- *Aceite:* (a) rotina sem `mcp:` roda com **zero** servidores, mesmo com `.mcp.json` no repo; (b) rotina com `mcp: [sentry]` vê só o Sentry, e o `mcp.json` em disco tem só placeholders, com ACL do dono, apagado no fim; (c) `~/.claude.json` com hash igual antes e depois; (d) servidor sem login → run pulado com motivo + ntfy; (e) o painel mostra o nº de tools e uma estimativa de tokens do conjunto; (f) id desconhecido gera aviso e não amplia nada.
- Custo **M**. Manutenção: flags da CLI do Claude (baixa; são documentadas).

### Fase 3 — Cartão de contexto + perfis por pasta
- Perfil de MCP + cartão de contexto por pasta da sidebar e por rotina, com prévia. Endpoints Ollama sem MCP por padrão.
- *Aceite:* o cartão tem ≤15 linhas e ≤500 tokens estimados; trocar o perfil afeta só sessões novas, e o resume/troca de conta do agent-pool repassa o mesmo conjunto. Custo **P**.

### Fase 4 — Sob demanda
- `source:` no ROUTINE.md (um run por task nova, lock e dedupe por chave) — **M**.
- Injeção em Codex (`-c` ou `CODEX_HOME` temporário, depois de verificar) e OpenCode (`OPENCODE_CONFIG_CONTENT`), quando o agent-pool trocar de CLI — **M**.
- Presets AWS só leitura, Grafana/Datadog, Postgres só leitura — **P** cada, só com pedido.
- Azure DevOps Boards — só com pedido.
- Gateway local embutido — **G**, só se processos stdio duplicados virarem dor medida.

---

## 7. Perguntas para você

1. **Quais rastreadores você e o público-alvo usam de verdade?** Se ninguém próximo usa Jira, a fase 1 pode ser só GitHub e o Linear sobe.
2. **Monday:** era pedido de alguém específico ou exemplo? Se for de um cliente/time real, um preset MCP + cartão de contexto resolve sem tela — ok?
3. **Bitbucket:** você usa Cloud ou Data Center? O Rovo MCP só cobre Cloud.
4. **A fase 0 (status por terminal + medidor de uso) pode vir antes de tasks e MCP?** A evidência diz que dá mais retorno.
5. **Write-back pelo Turno** (comentar e mover status por clique) ou só pelo agente? Só pelo agente é mais barato.
6. **AWS:** você quer o agente com acesso real a contas (mesmo só leitura) ou basta o cartão dizer qual perfil da `aws` CLI usar?
7. **Cartão de contexto:** global por máquina, por pasta, ou por rotina? A recomendação é por pasta + rotina, sem global.
8. **Codex/Gemini** precisam do hub já, ou o Claude primeiro é suficiente?
9. **Rotinas por fonte** ("rodar o agente em toda issue com label X"): interessa? Mexe em custo de cota.
10. **Pool de contas:** confirma que o login MCP por conta (cada `CLAUDE_CONFIG_DIR`) é aceitável? E a ressalva de termos de uso ao rodar várias assinaturas pessoais [U]?

---

## Fontes principais

- Stack Overflow Developer Survey 2025: https://survey.stackoverflow.co/2025/technology ; IA: https://shiftmag.dev/stack-overflow-survey-2025-ai-5653/ [S]
- Claude Code MCP / CLI: https://code.claude.com/docs/en/mcp , https://code.claude.com/docs/en/cli-reference , agendamento: https://code.claude.com/docs/en/desktop-scheduled-tasks
- Codex MCP: https://developers.openai.com/codex/mcp ; OpenCode: https://opencode.ai/docs/config/ ; ACP: https://agentclientprotocol.com/protocol/session-setup ; Gemini: https://geminicli.com/docs/tools/mcp-server/
- Jira rate limit: https://developer.atlassian.com/cloud/jira/platform/rate-limiting ; Rovo MCP: https://developer.atlassian.com/cloud/rovo-mcp/guides/authentication-and-authorization/ ; Rovo + Bitbucket: https://www.atlassian.com/blog/bitbucket/the-atlassian-rovo-mcp-server-now-supports-bitbucket-cloud ; fim do Bitbucket Issues: https://community.atlassian.com/forums/discussion/3193882/announcing-sunset-of-bitbucket-issues-and-wikis ; acli: https://developer.atlassian.com/cloud/acli/guides/how-to-get-started/
- GitLab MCP: https://docs.gitlab.com/user/model_context_protocol/mcp_server/ e https://docs.gitlab.com/user/gitlab_duo/model_context_protocol/mcp_server (divergem sobre tier)
- Linear: https://linear.app/developers/oauth-2-0-authentication , https://linear.app/docs/mcp ; Monday MCP: https://developer.monday.com/api-reference/docs/mondaycom-mcp ; ClickUp: https://developer.clickup.com/docs/connect-an-ai-assistant-to-clickups-mcp-server ; Asana: https://developers.asana.com/docs/using-asanas-mcp-server ; Azure DevOps: https://learn.microsoft.com/en-us/azure/devops/mcp-server/mcp-server-overview
- Sentry MCP: https://docs.sentry.io/ai/mcp/ ; AWS MCP: https://aws.amazon.com/about-aws/whats-new/2026/06/aws-mcp-server/ ; Supabase: https://supabase.com/docs/guides/ai-tools/mcp ; Grafana: https://grafana.com/docs/grafana/v13.1/developer-resources/mcp/ ; Datadog: https://www.datadoghq.com/blog/datadog-remote-mcp-server
- Custo de tokens: https://getunblocked.com/blog/github-mcp-token-cost/ , https://simonwillison.net/2025/Aug/22/too-many-mcps/ , https://www.apideck.com/blog/mcp-server-eating-context-window-cli-alternative [S]
- Segurança: https://invariantlabs.ai/blog/mcp-github-vulnerability , https://snyk.io/blog/malicious-mcp-server-on-npm-postmark-mcp-harvests-emails/ , https://blog.trailofbits.com/2025/04/30/insecure-credential-storage-plagues-mcp/ , https://www.helpnetsecurity.com/2026/09/18/hush-security-mcp-credential-exposure-report/ [S]
- OAuth em headless: https://github.com/anthropics/claude-code/issues/29718 , https://github.com/anthropics/claude-code/issues/50743
- Dores (issues): https://github.com/anthropics/claude-code/issues/16157 , /18435 , /6235 , /57230 , /30519 ; https://github.com/openai/codex/issues/1986 , /2998 , /11023 ; https://github.com/stablyai/orca/issues/20512 , /1099 , /4375 ; https://github.com/zed-industries/zed/issues/59157 ; https://github.com/smtg-ai/claude-squad/issues/260
- Agendadores com falha: https://claudeissues.com/issue/55565-bug-scheduled-tasks-skipped-as-computer-asleep-on-awake-windows-system , https://claudeissues.com/issue/80037-session-usage-limit-silently-kills-background-agents-and-prevents-scheduled-task [S, espelho]
- Concorrentes: https://docs.warp.dev/knowledge-and-collaboration/mcp , https://docs.superset.sh/automations , https://vibekanban.com/blog/shutdown , https://www.conductor.build/changelog.md , https://forum.cursor.com/t/repeated-cloud-agent-failures-going-on-24h/161038
- Código do Orca (MIT, HEAD fcac5cf0): `C:\rx\orca` — `src/shared/task-providers.ts`, `src/shared/mcp-config.ts`, `src/shared/claude-background-run-isolation.ts`, `src/main/claude-accounts/claude-profile-provisioning.ts`, `src/main/jira/*`, `src/main/linear/*`.
- Notas completas com todas as URLs: `C:\rx\notes2\*.md`.
