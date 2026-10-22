# Dores dos devs com apps parecidos com o Turno (pesquisa de 21/10/2026)

Escopo: terminais/IDEs multiagente e orquestradores de agentes: Orca, Conductor, Crystal, Claude Squad, Vibe Kanban, Sculptor, Superset, Emdash, Omnara, Warp, Cursor background agents, Codex app, Claude Code (CLI/desktop/web), Zed agent panel e setups com tmux.

Método:
- **GitHub**: issues mais reagidas por repositório, via `gh api search/issues sort=reactions` (somente leitura). O número antes de cada link é o total de reações, depois vêm os comentários.
- **Hacker News**: threads mais votadas (busca Algolia) e leitura dos comentários.
- **Pesquisas**: Stack Overflow Developer Survey 2025, seção de IA.
- **Reddit**: o acesso direto (JSON e site:reddit.com) foi bloqueado ou não retornou threads. As referências de Reddit são **indiretas**, citadas por blogs e espelhos, e estão marcadas **[N]** (não verificado).

Legenda: **[V]** fonte primária lida (issue, thread ou página da pesquisa); **[S]** secundária (blog, imprensa); **[N]** não verificado.

Citações curtas, com menos de 15 palavras, copiadas dos comentários. Na tabela de ranking, a coluna **Freq.** é a frequência e a coluna **Int.** é a intensidade.

---

## 0. Ranking resumido

| # | Cluster de dor | Freq. | Int. | Turno hoje | Custo p/ resolver no Turno |
|---|---|---|---|---|---|
| 1 | Limites de uso e custo: estouro, falta de visibilidade, multi-conta | muito alta | muito alta | parcial (`parseRateLimit` nas rotinas; design do agent-pool) | médio (o agent-pool já está desenhado) |
| 2 | Gargalo de revisão de diffs e carga cognitiva | muito alta | alta | baixo (run viewer mostra a conversa, sem diff) | médio |
| 3 | Saber qual agente precisa de mim (input ou permissão) e notificar quando estou longe | alta | alta | parcial (ntfy só nas rotinas; nada nos terminais) | **baixo** |
| 4 | Worktrees: ambiente (.env, deps), portas, limpeza, merge conflicts | alta | alta | parcial (worktree.ts por run de rotina) | médio |
| 5 | Terminal instável: flicker, scroll, render, perf/RAM do Electron | alta | média-alta | xterm próprio (risco de herdar) | baixo-médio |
| 6 | Windows/Linux de segunda classe (quase todos são só Mac) | alta | alta para quem usa | **vantagem do Turno** (feito no Windows) | já resolvido em parte |
| 7 | Permissões: prompts demais vs. `--dangerously-skip-permissions`, ações destrutivas | alta | alta | rotinas headless já precisam de política | baixo-médio |
| 8 | Perda de contexto entre sessões e compactação; resume preso ao diretório | média-alta | alta | pastas com sessões salvas; histórico de runs | médio |
| 9 | Tarefas longas sem supervisão, controle remoto ou mobile | média | média-alta | ntfy + keep-awake + agendamento (**forte**) | baixo para estender |
| 10 | Setup e config de MCP; inchaço de contexto pelas ferramentas | média | média | não tem | ver nota (cuidado com "tralha") |
| 11 | Privacidade, telemetria, login obrigatório, escopo OAuth do GitHub | média | alta (rejeição) | local-first, sem login (**vantagem**) | manter |
| 12 | Trocar de modelo ou agente; prender a um fornecedor | média | média | conexões Ollama/Anthropic-compat | baixo |
| 13 | Observabilidade: o que o agente fez, quanto gastou, por quê | média | média | run history (**forte**) | baixo para custo e tokens |
| 14 | Workflows que envelhecem rápido ("mudam a cada 2-4 meses") e risco de o projeto morrer | média | média | n/a | design: ficar fino sobre as CLIs |
| 15 | Multi-repo e submódulos | média | média | não | médio |

---

## 1. Limites de uso e custo (dor nº 1 em volume)

**Evidência primária:**
- anthropics/claude-code#16157 "Instantly hitting usage limits with Max subscription": **726 reações, 1499 comentários**, aberta. É a issue com mais comentários do repositório. https://github.com/anthropics/claude-code/issues/16157 [V]
- #38335 "Max plan session limits exhausted abnormally fast since March 23, 2026": 544 reações e 879 comentários. https://github.com/anthropics/claude-code/issues/38335 [V]
- #9424 "Weekly Usage Limits Making Claude Subscriptions Unusable": 155 reações. https://github.com/anthropics/claude-code/issues/9424 [V]
- #19673 "You've hit your limit · While usage is still at 84%" e #29579 "Rate limit reached despite … only 16% usage": o medidor não bate com o bloqueio. https://github.com/anthropics/claude-code/issues/19673 , https://github.com/anthropics/claude-code/issues/29579 [V]
- #46829 "Cache TTL silently regressed from 1h to 5m … quota and cost inflation": 341 reações. https://github.com/anthropics/claude-code/issues/46829 [V]
- #11008 "Expose token usage and cost data in hook inputs". https://github.com/anthropics/claude-code/issues/11008 [V]
- Multi-conta:
  - #18435 "manage multiple Claude accounts … easy switching": **1159 reações**. https://github.com/anthropics/claude-code/issues/18435 [V]
  - #36151, multi-conta no mobile: 1060 reações. [V]
- Codex:
  - #1986 "Show global usage and reset time for 5h/weekly guardrails": 151 reações. https://github.com/openai/codex/issues/1986 [V]
  - #23794 "Codex Desktop no longer shows visible context/token usage indicator": 253 reações. https://github.com/openai/codex/issues/23794 [V]
  - #28879, custo por token "jumped ~10-20x": 561 reações. https://github.com/openai/codex/issues/28879 [V]
  - #34035 "Make the temporary removal of the 5-hour usage limit permanent": 279 reações. [V]
- Orca:
  - #11557 "Support multiple Claude Code subscriptions": 23 reações. https://github.com/stablyai/orca/issues/11557 [V]
  - #9496 "Per-worktree account pinning". [V]
  - #20512 "Automatic account failover on rate limit": 18 comentários. https://github.com/stablyai/orca/issues/20512 [V]
  - #15516, #6892 e #21476: rastrear uso de Cursor, Copilot, OpenRouter e Ollama Cloud na barra de status. [V]
- Crystal #18 "Auto-Resume after limits timeout when on Claude Max". https://github.com/stravu/crystal/issues/18 [V]
- Zed #31531 "Wait/retry when agent hits rate limits (don't just error)": 55 reações. https://github.com/zed-industries/zed/issues/31531 [V]

**Citações de HN:**
- "I usually hit weekly quota by around day 3-4" (gck1, plano de $200). https://news.ycombinator.com/item?id=47218318 [V]
- "Churns through tokens extremely quickly" (ecliptik, mesma thread). [V]
- "burn through 100% usage through a single day" (Tooster, Launch HN Superset). https://news.ycombinator.com/item?id=48236770 [V]
- "Blew through the Pro quota really fast." (kami23, Omnara). https://news.ycombinator.com/item?id=44878650 [V]
- Superset: Conductor passaria a ser medido como "programmatic usage" (collin128). [V] É um risco para apps que embrulham a assinatura. [N quanto ao estado atual]
- "Each session loads about 39.6k tokens of config before I type anything" (lilhawk0312, thread do tmux). https://news.ycombinator.com/item?id=50148855 [V]

**Pesquisa:** SO 2025: 53,3% concordam que o "custo de certas plataformas é uma barreira" para agentes. https://survey.stackoverflow.co/2025/ai [V]

**Imprensa:**
- The Register sobre limites surpresa: https://www.theregister.com/2026/01/05/claude_devs_usage_limits/ [S]
- DevOps.com: quota esgotada em "19 minutes". https://devops.com/claude-code-quota-limits-usage-problems/ [S]
- Post do r/ClaudeAI sobre gastar ~US$ 6.000 numa noite, citado por blog. [N]

**Turno:**
- Já tem o `parseRateLimit` nas rotinas e o design do Agent com ranking e troca (docs/research/agent-pool.md). Isso ataca a dor 1 diretamente, e quase nenhum concorrente tem; o Orca ainda está com a issue #20512 aberta.
- Barato e de alto valor: um medidor sempre visível, com % de 5h e 7d e o horário de reset, por conta (via `statusLine` / `rate_limits`, como no agent-pool).
- Também barato: um "auto-resume após o reset" para rotinas e terminais pausados no limite. É o pedido do Crystal #18 e do Zed #31531.

## 2. Gargalo de revisão e carga cognitiva

**Citações:**
- "I can trust nothing and have to verify every assumption." (munk-a). https://news.ycombinator.com/item?id=45489884 [V]
- "My biggest hesitation about this is being stuck in merge hell." (babyshake, mesma thread). [V]
- "My problem is QAing and reviewing the code all these agents write" (stavros, Omnara). [V]
- "my time shifted from producing code to reviewing code" (dalejh, Sculptor). https://news.ycombinator.com/item?id=45427697 [V]
- "we now have to review 11 PRs" (sexeriy237, Vibe Kanban). https://news.ycombinator.com/item?id=44533004 [V]
- "Two parallel sessions already feel like my limit" (sukit, Ask HN). https://hn.nuxt.dev/item/47573483 [V]
- "being a pilot landing a plane _all day long_" (medi8r); "The current bottleneck is validation" (CuriouslyC). https://news.ycombinator.com/item?id=47218318 [V]
- "simply couldn't manage more than like 20 terminal tabs without losing track" (micro23xd, Superset). [V]
- Anthropic disse que a revisão de código "has become a bottleneck" e lançou o Code Review. https://claude.com/fr/blog/code-review [S]

**Pedidos concretos:**
- Codex #2998 "IDE-integrated diff / approval": 238 reações. https://github.com/openai/codex/issues/2998 [V]
- Zed #59157 "PR-style review comments in Git Diff UI that feed into the active agent thread": 150 reações. https://github.com/zed-industries/zed/issues/59157 [V]
- Superset #935 "All diff commenting". [V]
- Emdash #1635 "Diff mode to view changes since last turn". https://github.com/generalaction/emdash/issues/1635 [V]
- Orca #1099, diffs multi-repo: 78 reações, a mais reagida do Orca. https://github.com/stablyai/orca/issues/1099 [V]

**Pesquisa:**
- SO 2025: 66% se frustram com soluções "almost right"; 45,2% dizem que depurar código de IA toma mais tempo. [V]
- Só 37,5% dos usuários de agentes dizem que a qualidade do código melhorou. [V]

**Turno:**
- A run viewer mostra a conversa, mas não o resultado.
- Barato:
  - aba "Mudanças" na run, com `git diff` da worktree da run contra a base, mais estatísticas;
  - "diff desde o último turno";
  - resumo final da run, com arquivos tocados, comandos e testes.
- Médio: comentar uma linha do diff e reenviar o comentário ao agente.

## 3. "Qual agente está esperando por mim?" e notificações

**Issues:**
- claude-code #57230, toast nativo quando o Claude precisa de atenção. https://github.com/anthropics/claude-code/issues/57230 [V]
- #8985, o hook Notification não funciona na UI nativa do VS Code. [V]
- #29438, push no iOS quando há aprovação pendente. [V]
- #28765, push ao concluir tarefa. [V]
- #36885, notificar ao esperar input. https://github.com/anthropics/claude-code/issues/36885 [V]
- Payload do hook de permissão sem dizer qual ferramenta está pendente: espelho #84801. https://claudeissues.com/issue/84801-feature-richer-permission-prompt-notifications-sharing-a-workaround-ref-32952-29 [S]
- Codex:
  - #4306 e #7083, notificar ao completar. [V]
  - #10760 "Stuck 'Awaiting approval' prompt": 76 reações. [V]
- Orca:
  - #4375 "Non turn-end notification spam". https://github.com/stablyai/orca/issues/4375 [V]
  - #13600, falsos alertas de atenção. [V]
  - #15148, silenciar workers. [V]
  - **#9871 "Custom Notification Channels (Webhook / Bark / ntfy / Telegram)"**: o Turno já tem ntfy. https://github.com/stablyai/orca/issues/9871 [V]
- Emdash #531 "distinct icon for tool call approval requests instead of spinner". https://github.com/generalaction/emdash/issues/531 [V]
- Crystal #109 e #58, som de notificação quebrado ou na hora errada. [V]

**Citações:**
- "very easy to forget about one and have it paused waiting for confirmation" (freedomben, Conductor). https://news.ycombinator.com/item?id=44594584 [V]
- "waiting 5-10 minutes just to provide input when needed" (kmansm27, Omnara); as ferramentas "lack push notifications" (mesmo autor). [V]
- Ferramenta da comunidade com hook Stop + ntfy.sh ("free, no account needed"), num snapshot de Reddit. https://reddit.sentinel-team.org/posts/1sgj41t/snapshots/2026-04-09T16%3A41%3A00.47446Z [N]

**Turno:**
- **A dor mais barata de resolver**: hoje o ntfy cobre só as rotinas.
- Plano:
  - badge por terminal/aba com o estado (rodando, esperando input, esperando permissão, concluído, erro);
  - toast e ntfy quando um terminal passa a "esperando";
  - fonte do estado: hooks `Notification`/`Stop` do Claude Code e `notify` do Codex, injetados por variáveis de ambiente ou settings da sessão, sem editar o ~/.claude global (ver regra no agent-pool); fallback: heurística no stream do xterm.
  - Uma lista "Precisa de mim" na sidebar.
- Evitar o erro do Orca: notificar só em fim de turno ou em pedido de permissão, nunca a cada evento.

## 4. Worktrees: ambiente, portas, limpeza e conflitos

**Citações:**
- "they don't include things that are not tracked by git" (pjm331, Conductor). [V]
- "you need to run all the dependency installs, etc. for every workspace." (_1tem, Conductor). [V]
- "every worktree needs its own ports" (jorl17, Emdash). [V]
- "I've never used lsof so much in my life." (toddmorey, Superset). [V]
- "too annoying to deal with dependencies and ports" (sprobertson, Ask HN). [V]
- "to many hanging worktrees can quickly also become a nightmare" (rox_kd). [V]
- "they don't deal with merge conflicts automatically" (mashlol, Superset). [V]
- "parallel cards can clobber each other when they touch the same files." (akifq, Vibe Kanban). [V]
- "worktrees simply do not work with submodules." (clbrmbr, Conductor). [V]

**Issues:**
- claude-squad #260 "worktree environment setup hook (deps, env files, port isolation)". https://github.com/smtg-ai/claude-squad/issues/260 [V]
- vibe-kanban #765, limpeza automática de worktrees. [V]
- vibe-kanban #1947 `.worktreeinclude`. [V]
- claude-code:
  - #23622, escolher a branch base. [V]
  - #27282, local configurável. [V]
  - #21236 e #12513, desligar worktree automática para dev solo (80-110 reações). [V]
  - #11005, `.git/index.lock` órfão. [V]
- Codex:
  - #10599, local das worktrees. [V]
  - #13762, WSL guarda worktrees no lugar errado. [V]
  - #26648 e Orca #1082, Jujutsu workspaces (46 reações no Orca). [V]

**Turno:**
- Já cria worktree por run (`src/main/worktree.ts`, fora do repo, em `../.turno-worktrees`, branch `turno/...`).
- Barato:
  - suporte a `.worktreeinclude`, para copiar .env e afins;
  - script de setup por projeto;
  - variável `PORT_OFFSET` por worktree;
  - limpeza de worktrees órfãs com uma tela de "worktrees do Turno";
  - aviso de conflito previsto: duas runs mexendo nos mesmos arquivos (`git diff --name-only` cruzado).
- Tornar worktree opcional por padrão, porque muita gente não quer.

## 5. Terminal instável, render e performance

**Issues:**
- claude-code #769 "In-progress Call causes Screen Flickering": 336 reações e 307 comentários. https://github.com/anthropics/claude-code/issues/769 [V]
- #1913 "Terminal Flickering": 321 reações. [V]
- #3648 e #826, scroll descontrolado (836 e 822 reações). https://github.com/anthropics/claude-code/issues/3648 [V]
- #10794, flicker derrubando o VS Code. [V]
- #41965, regressão do "flicker-free" que destrói o scrollback. [V]
- Superset #2861, input lag. [V]
- claude-squad #215 "TUI Interactions very slow" e #137, scroll do diff. [V]
- Codex:
  - #16857, GPU alta "due to tiny useless animation". [V]
  - #20214, o app trava no Windows 11. [V]
  - #48074, janelas de terminal piscando no Windows. [V]
  - #28224, logs SQLite "~640 TB/year" (616 reações). [V]

**Citações:**
- "Anthropic took took 6 months to fix a flickering claude code." (lurking_swe, Codex App). https://news.ycombinator.com/item?id=46859054 [V]
- "8GB of RAM usage for Codex App is clown-level ridiculous." (behnamoh). [V]
- "2GB! is too much for this kind of app" (desireco42, Superset). [V]
- "a single session could drag my whole machine down" (sukit, Ask HN). [V]
- "I have never been able to get copy-paste to work 100% of the time." (mkw5053, tmux). [V]
- "Tmux inside git bash is really slow." (febed). [V]

**Turno:**
- Usa xterm + node-pty. O xterm não tem o flicker do Ink de graça, mas os TUIs (Claude/Codex) redesenham a tela.
- Barato:
  - garantir o renderer WebGL/canvas;
  - limitar o scrollback;
  - um "modo leitura" pela run viewer (stream-json) em vez do TUI para sessões longas;
  - medir RAM por aba.
- Copiar e colar com imagem é um pedido recorrente.

## 6. Windows e Linux de segunda classe

**Evidências:**
- Conductor: só Mac/Apple Silicon. [S]
- Superset:
  - #2692 e #499, Windows (14 e 12 reações). [V]
  - #405, Linux. [V]
  - "nobody on the team daily drives windows yet" (avipeltz, Superset team). [V]
  - "Why Mac only?" (mashlol). [V]
- Codex:
  - #11023 "Codex desktop app for Linux": **1464 reações**. https://github.com/openai/codex/issues/11023 [V]
  - #13993, instalador standalone para Windows (265 reações). [V]
  - #2860 "Unusable on Windows due to permission ask for every shell command": 110 reações. [V]
- Claude:
  - #65697, Desktop oficial para Linux (655 reações). [V]
  - #4928, arquivo `nul` criado no Windows (235 reações). [V]
  - #42776, relançamento falha no Windows por lock (203 comentários). [V]
  - #85891, janela sempre no topo (291 reações). [V]
  - #12506, executar no WSL (147 reações). [V]
- Emdash:
  - WSL2 "doesn't work at all for me" (martinald); "Please codesign your Windows installer exes". [V]
  - #2140, agentes no WSL não detectados. [V]
- Orca:
  - #6487, bloqueado pelo Smart App Control (sem assinatura). [V]
  - #1328, barras invertidas quebram hooks. [V]
  - #1394, ferramentas resolvidas no host em vez do WSL. [V]

**Turno:** é desenvolvido no Windows, o que é um diferencial real. Barato e com alto valor percebido:
- assinatura de código do instalador (evita SAC/SmartScreen);
- suporte explícito a perfis WSL nos terminais e rotinas;
- testar caminhos com espaços e barras invertidas em hooks.

## 7. Permissões: prompts demais vs. YOLO; ações destrutivas

**Issues:**
- claude-code:
  - #28240, o prompt dispara no `cd` de comandos compostos (209 reações). [V]
  - #16561, parsear comandos compostos (176). [V]
  - #30519 "Permissions matching is fundamentally broken — 30+ open issues". https://github.com/anthropics/claude-code/issues/30519 [V]
  - #18950, skills/subagentes não herdam permissões. [V]
  - #6608 "ran `rm -rf` command without permission". [V]
  - #82165 "Catastrophic data loss … rm -rf /*". [V]
- Codex:
  - #2860 (acima). [V]
  - #13476, aprovações excessivas no Playwright MCP. [V]
  - #11915, modo somente leitura. [V]
- Crystal #178 "Allow running without --dangerously-ignore-permissions". [V]
- Superset #2419 "always uses hardcoded … --dangerously-skip-permissions". [V]

**Citações:**
- "Claude once bypassed the deny list and nuked an important untracked directory." (schipperai). [V]
- "Every new rule just taught the agent a new workaround" (v_CodeSentinal). [V]
- "endless approvals" (ecliptik). [V]
- "--dangerously-skip-permissions and --permission-mode plan can't be used together." (dbbk, Superset). [V]

**Turno:**
- Rotinas headless precisam de política explícita.
- Barato:
  - perfis de permissão por rotina/sessão ("só leitura", "edita na worktree", "YOLO na worktree");
  - nunca forçar `--dangerously-skip-permissions` sem escolha do usuário;
  - snapshot/branch antes da run, para desfazer;
  - log das ações destrutivas no histórico.

## 8. Perda de contexto entre sessões, compactação e resume

**Issues:**
- claude-code:
  - #17428, compactação com resumo em arquivo (117 reações). [V]
  - #27242 "No working mechanism to review previous context after compaction". [V]
  - #14258, hook PostCompact. [V]
  - #5768 "Resuming sessions only works from the directory in which they were started". https://github.com/anthropics/claude-code/issues/5768 [V]
  - #28745, retomar a partir de outro diretório. [V]
  - #26123, /resume quebrado. [V]
  - #41458 "490 sessions silently deleted despite explicit setting". https://github.com/anthropics/claude-code/issues/41458 [V]
  - #63147, retomar sessão com thinking falha para sempre. [V]
  - #2511 "Connect Claude code to Claude projects" (658). [V]
- AGENTS.md: #6235 tem **6687 reações**, a issue mais reagida do Claude Code. Pede uma instrução compartilhada entre agentes. https://github.com/anthropics/claude-code/issues/6235 [V]
- Zed #37074 "Support history with external ACP agents": 260 reações. [V]
- Espelhos com relatos de memória perdida após o auto-compact. https://claudeissues.com/issue/29890-bug-context-compaction-loses-critical-working-knowledge-mid-session [S]
- "How do you prevent the agents 'going rogue' through compactification" (philipwhiuk, Emdash). [V]
- "it's not working because I'm not in the right directory" (nathan_douglas). [V]

**Turno:**
- Já tem pastas com sessões salvas e histórico de runs.
- Barato:
  - fazer backup dos .jsonl das sessões que o Turno abriu (proteção contra o cleanup do #41458);
  - "retomar" independente do diretório, porque o Turno sabe o cwd e o caminho do .jsonl;
  - o pacote de handoff do agent-pool, reaproveitado como "resumo para continuar amanhã".

## 9. Tarefas longas sem supervisão, remoto e mobile

**Issues:**
- claude-code:
  - #29006, Remote Control no Desktop (165). [V]
  - #34255, reconexão silenciosa (110). [V]
  - #28351, slash commands via remote (138). [V]
- Codex:
  - #10450, Remote Development (878). [V]
  - #9224, Remote Control (544). [V]
  - #32908, push no iOS não entregue. [V]
- Orca:
  - #8129, push real no mobile (eventos perdidos em background). [V]
  - #4280, modo headless/servidor. [V]
- Crystal #26 e #89 (remoto, modo servidor, mobile). [V]
- Superset #1513 (ssh). [V]
- Emdash #901 e #1215 (tmux para sessões persistentes). [V]

**Citações:**
- "can't just shut my laptop while it worked" (jama211, Omnara). [V]
- "a mobile integration to check the agent status" (_1tem, Sculptor). [V]
- "I need it on-prem or it will never get approved" (frazbin). [V]
- "No way I'm sending my code to your central servers" (_1tem). [V]
- Blog: o Remote Control cai se a máquina fica inacessível por ~10 min; o modelo primário fica sobrecarregado "at 2 a.m." e o job para. https://rickhigh.substack.com/p/claude-code-advanced-the-four-ways [S]

**Turno:**
- **Forte aqui**: agendamento, keep-awake, ntfy, histórico e sessões persistentes no processo principal.
- Barato:
  - ação no ntfy ("aprovar", "continuar", "parar") via botões de ação do ntfy apontando para um endpoint local. **Cuidado com a segurança**: precisa de token e não deve expor a máquina;
  - fallback de modelo/conta quando der overload (já previsto no agent-pool).

## 10. Setup e config de MCP; inchaço de contexto

**Issues:**
- claude-code:
  - #7328, filtrar ferramentas por servidor (225). [V]
  - #1774, ligar/desligar MCP rapidamente (161). [V]
  - #6915 e #4476, MCP com escopo por agente/subagente (377 e 183). [V]
  - #24057, recarregar sem reiniciar. [V]
  - #3098, inconsistência entre config via CLI e via arquivo. [V]
  - #26073, no Windows MSIX o "Edit Config" abre o arquivo errado e os MCP "silently fail". [V]
  - #16837, MCP_TIMEOUT ignorado. [V]
  - #28942 `envFile` para segredos do MCP. [V]
  - #87838, `claude mcp list` imprime os segredos em texto puro. [V]
  - #3433, o MCP remoto do GitHub não conecta via OAuth (153). [V]
  - #27302, várias contas do mesmo connector (608). [V]
- Codex:
  - #2628, MCPs por projeto (162). [V]
  - #17265, o token OAuth do MCP não é renovado. [V]
  - #40715, transporte inválido quebra o app no Windows. [V]
  - #4226, MCP no Codex Web. [V]
- Inchaço:
  - 3 servidores (GitHub, Playwright, IDE) usariam ~143k de 200k tokens [S/N];
  - a precisão de seleção de ferramentas cai com o número de ferramentas [S/N];
  - https://getunblocked.com/blog/mcp-tool-overload/ ; https://thenewstack.io/how-to-reduce-mcp-token-bloat/ [S]
  - "Each session loads about 39.6k tokens of config before I type anything" (HN). [V]
- Pesquisa SO 2025:
  - "MCP servers" é usado por 34,4% dos usuários de agentes (uso geral);
  - GitHub MCP Server: 42,8% (ferramentas de memória e dados);
  - observabilidade de agentes: Grafana+Prometheus 43%, **Sentry 31,8%**, Snyk 18,2%;
  - "Integration with existing tools is difficult": 46,2%. [V]
- Emdash: integração com kanban feita via MCP como gambiarra ("setting up an MCP connection to your kanban provider", rockostrich). [V]

**Turno (relevante para a pergunta 2 do usuário):** a dor real **não** é "falta de MCP". É:
- (a) config espalhada e inconsistente por agente;
- (b) segredos em texto puro;
- (c) inchaço de contexto quando tudo fica ligado sempre;
- (d) OAuth que expira.

Logo, a ideia de "injetar todas as conexões em todos os agentes" **piora** o item (c). O valor está em:
1. um registro central de MCPs no Turno, com segredos no cofre do SO (safeStorage);
2. habilitar **por projeto/rotina**, não global;
3. gerar a config temporária por sessão (`--mcp-config` / `CODEX_HOME` isolado), sem tocar no ~/.claude;
4. uma instrução inicial curta, listando só os servidores ativos naquela sessão.

Isso ataca as issues #1774, #7328, #6915, #2628, #28942 e #87838 de uma vez. Sentry, GitHub/Bitbucket e o tracker de tarefas são os candidatos com evidência de uso (dados da SO). AWS e cloud: só sob demanda e com credenciais somente leitura.

## 11. Privacidade, telemetria, login obrigatório e escopo OAuth

**Evidências:**
- Vibe Kanban:
  - telemetria opt-out "harvesting email addresses and github usernames" (gpm). [V]
  - "This asks for unlimited private access to ones repo." (csomar). [V]
  - #2952 "Why do I need to log in to use features such as Kanban?" [V]
- Conductor: "Full read-write access" ao GitHub (itsalotoffun). [V]
- Superset: #2685 "Make login non-required" (23); "it's behind a login wall" (tacone). [V]
- Crystal #95 "Is this app secretly phoning home?" [V]
- Warp "sends a terminal session to LLM without user consent" (HN, 94 pontos). https://news.ycombinator.com/item?id=44953470 [V, título]
- SO 2025: 81,4% preocupados com a segurança e privacidade dos dados nos agentes. [V]

**Turno:** local-first, sem login e sem backend. **Manter isso como bandeira.** Toda integração nova (Jira, Sentry, AWS) deve ser opt-in, local e com escopo mínimo.

## 12. Modelo/agente: troca e lock-in

**Evidências:**
- claude-code #17118, OpenCode com o plano Max (1414). [V]
- Superset: "ACP is pretty much dead for Claude subscription usage" (ilja). [V]
- Zed #37074, histórico com agentes ACP. [V]
- Warp #7326, ACP. [V]
- vibe-kanban #1708 e #2162, Kiro e goose. [V]
- Crystal #177, Codex. [V]
- Sculptor: "Cool, now do it for Codex and gemini-cli" (pmarreck); "Lacks an option to configure anthropic base url" (kuroko). [V]
- Orca #13843 "Automations have no way to pin the model (or effort) for a scheduled run". https://github.com/stablyai/orca/issues/13843 [V]
- Crystal #15, modelo por sessão. [V]

**Turno:** já tem conexões Ollama/Anthropic-compatíveis. Barato: fixar modelo e esforço por rotina, evitando a lacuna do Orca #13843.

## 13. Observabilidade: o que o agente fez

**Evidências:**
- claude-code #11008, tokens e custo nos hooks. [V]
- Codex #2109 "Event Hooks" (688). [V]
- Codex #9203 "/undo" (538). [V]
- Codex #23794, indicador de contexto (253). [V]
- Zed #60882, o painel git fica desatualizado quando o agente edita em outra janela. [V]
- "how do you keep an eye on it?" (jasonjmcghee, tmux). [V]

**Turno:** o run history é exatamente isso. Barato: tokens e custo estimado por run, ferramentas usadas, arquivos tocados e um "desfazer run" (reset da branch da worktree).

## 14. Workflows e ferramentas que envelhecem; risco de abandono

**Evidências:**
- "patterns shift every 2-4 months now" (mycall). [V]
- "leaving behind full workflows I've built" (nkko). [V]
- claude-squad:
  - #214 "No more updates?" [V]
  - #250 "Project Seems Abandoned". https://github.com/smtg-ai/claude-squad/issues/250 [V]
- Vibe Kanban teria sido desligado pela Bloop e hoje é mantido pela comunidade (agentsroom.dev). [S/N]
- vibe-kanban #2687 "Bring back old UI": a mais reagida do repo, com 33 reações. [V]
- "Custom AI tools like these have an uphill battle to fight." (Bishonen88, Emdash). [V]
- "Only problem with Herdr is the VC funding." (yoyohello13). [V]

**Turno:** ficar fino em cima das CLIs oficiais (que absorvem features rápido) e não reescrever o que elas fazem. Mudanças de UI precisam preservar o fluxo antigo (lição do Vibe Kanban).

## 15. Multi-repo e submódulos

**Evidências:**
- Orca:
  - #1099 (78). [V]
  - #7568 (40). [V]
- Superset #2364. [V]
- claude-squad #56 e #89. [V]
- claude-code #23627. [V]
- Emdash #1104, submódulos. [V]
- Conductor: "worktrees simply do not work with submodules." [V]

---

## Notas sobre o Reddit (limitação)

O endpoint JSON do Reddit e o `site:reddit.com` não retornaram threads utilizáveis nesta sessão. Os temas de Reddit aparecem só por fontes indiretas:
- custo de US$ 6k numa noite (r/ClaudeAI, citado por blog);
- ferramenta de notificação via ntfy (snapshot);
- quotas de Max se esgotando, agregadas na issue #9424, cujo corpo cita relatos do Reddit.

Tudo isso está marcado [N]. Se precisar de citações literais do Reddit, abrir as threads manualmente.

## Fontes principais (sem repetir todas as issues)

- SO Survey 2025, IA: https://survey.stackoverflow.co/2025/ai
- HN:
  - Superset: https://news.ycombinator.com/item?id=48236770
  - Emdash: https://news.ycombinator.com/item?id=47140322
  - Conductor: https://news.ycombinator.com/item?id=44594584
  - Vibe Kanban: https://news.ycombinator.com/item?id=44533004
  - Sculptor: https://news.ycombinator.com/item?id=45427697
  - Omnara: https://news.ycombinator.com/item?id=44878650
  - Simon Willison sobre agentes paralelos: https://news.ycombinator.com/item?id=45489884
  - tmux com specs: https://news.ycombinator.com/item?id=47218318
  - tmux e Claude Code: https://news.ycombinator.com/item?id=50148855
  - Codex App: https://news.ycombinator.com/item?id=46859054
  - Ask HN sobre sessões paralelas (espelho): https://hn.nuxt.dev/item/47573483
- GitHub (reações): anthropics/claude-code, openai/codex, stablyai/orca, superset-sh/superset, generalaction/emdash, BloopAI/vibe-kanban, smtg-ai/claude-squad, stravu/crystal, zed-industries/zed, warpdotdev/warp.
