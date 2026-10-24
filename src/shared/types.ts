// id de uma Connection (ver Settings.connections). String aberta: o conjunto de provedores
// e configuravel pelo usuario, nao um union fixo. 'claude-max' e 'qwen-local' sao apenas os ids
// das connections semeadas por padrao.
export type ProfileId = string

// Um provedor de IA configurado. kind 'claude' = login do CLI (sem segredo guardado pelo app);
// kind 'endpoint' = endpoint Anthropic-compativel (Ollama, OpenAI-compat via shim, proxy).
export interface Connection {
  id: string
  name: string
  kind: 'claude' | 'endpoint'
  baseUrl?: string
  model?: string
  tokenRef?: string // referencia ao cofre (safeStorage); nunca o valor em claro
  token?: string // token inline (legado/local, ex. 'ollama'); preferir tokenRef
  extraEnv?: Record<string, string>
  bootCommand?: string // ex. "ollama serve": sobe o servidor local antes de usar
  healthUrl?: string // ex. "http://localhost:11434/api/version": checa se esta de pe
  // 'translate' = provedor no formato OpenAI: o Claude Code fala com o tradutor local do Turno, que repassa ao baseUrl
  via?: 'direct' | 'translate'
  catalogId?: string // provedor do catalogo de onde a conexao veio
}
export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max'
// Modos do `claude --permission-mode`. bypassPermissions = --dangerously-skip-permissions.
export type PermissionMode = 'manual' | 'acceptEdits' | 'auto' | 'dontAsk' | 'bypassPermissions'
export type Weekday = 'sun' | 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat'
// Sandbox opcional por rotina; 'none' = DEFAULT (sem sandbox). 'docker'/'wsl' sao opt-in.
export type SandboxMode = 'none' | 'docker' | 'wsl'
export const WEEKDAYS: Weekday[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']

// Configuracao de uma rotina = frontmatter do ROUTINE.md.
export interface RoutineConfig {
  name: string
  description: string
  enabled: boolean
  schedule: {
    days: Weekday[]
    times: string[] // "HH:MM"
    cron?: string // avancado: substitui days/times
  }
  timezone: string
  profile: ProfileId
  model: string
  effort: Effort
  permission_mode: PermissionMode
  allowed_tools: string[]
  chrome: boolean
  locks: string[]
  lock_policy: 'skip' | 'queue'
  timeout_min: number
  idle_timeout_min: number
  budget_usd?: number // LEGADO/acucar: equivale a uma AbortPolicy cost_usd. Ausente = sem teto de custo.
  abort?: AbortPolicy[] // politicas de parada agnosticas (custo/passos/duracao/limite de sessao/semanal)
  sandbox: SandboxMode // 'none' por padrao (sem sandbox)
  isolation: 'none' | 'worktree' // 'worktree' roda a rotina num git worktree isolado
  triggers?: RoutineTrigger[] // dispara a rotina por evento local (file-watch), alem do cron
  catchup: boolean
  catchup_window_h: number
  precheck?: string
  notify: 'failures' | 'always' | 'never'
  mcp?: string[] // servidores do hub de MCP desta rotina
  strict_mcp?: boolean // so os do hub: ignora os MCPs do usuario e o .mcp.json do repo
  context_card?: string // cartao de contexto (5-15 linhas) para o agente
  account_pool?: boolean // usa o ranking de contas Claude e continua noutra conta no limite
  account?: string // conta Claude fixa desta rotina (id); ignorado quando account_pool e true
}

export interface Routine {
  id: string // nome da pasta
  dir: string
  config: RoutineConfig
  prompt: string
  error?: string
  nextRuns: string[] // ISO
  lastRun?: RunRecord
  mtimeMs?: number // quando o ROUTINE.md foi gravado (o editor usa para nao sobrescrever edicao externa)
}

export interface RoutineDraft {
  id: string
  originalId?: string
  config: RoutineConfig
  prompt: string
  expectContent?: string // JSON [config, prompt] que o editor acha que esta no disco; diferente -> nao grava
}

export interface RunRequest {
  profile: ProfileId
  prompt: string
  cwd?: string
  model?: string
  effort?: Effort
  permissionMode?: PermissionMode
  allowedTools?: string[]
  chrome?: boolean
  resume?: string // session_id para continuar a conversa
  accountId?: string // conta do botao Agent (pasta isolada do Claude)
  pool?: boolean // usa o ranking de contas Claude e troca de conta no limite (chat do Agent, rotinas com account_pool)
  mcp?: string[] // servidores do hub de MCP para esta run
  strictMcp?: boolean // so os servidores do hub (ignora .mcp.json do repo e os do usuario)
  contextCard?: string // cartao de contexto (system prompt extra)
}

export type RunStatus =
  | 'queued' | 'running' | 'ok' | 'failed' | 'skipped' | 'timeout' | 'idle_timeout' | 'rate_limited' | 'stopped'
  | 'aborted' // bateu uma policy de threshold (custo/passos/duracao)
  | 'paused' // bateu o limite de sessao/semanal; aguarda o reset para retomar (resume_at)

// Politica de parada de uma run (ver src/main/abort.ts). Thresholds + gatilhos de limite da assinatura.
export type AbortPolicy =
  | { kind: 'cost_usd'; limit: number }
  | { kind: 'steps'; limit: number }
  | { kind: 'duration_min'; limit: number }
  | { kind: 'session_limit' } // limite de 5h → pausa e retoma no reset
  | { kind: 'weekly_limit' } // limite semanal → pausa e retoma no reset
export type RunTrigger = 'manual' | 'cron' | 'catchup' | 'adhoc' | 'followup' | 'watch'

// Gatilhos de evento local (alem do cron). Hoje: mudanca de arquivo/pasta (file-watch, com debounce).
export type RoutineTrigger = { kind: 'watch'; path: string }

export interface RunRecord {
  id: string
  routine: string | null
  trigger: RunTrigger
  status: RunStatus
  scheduled_at: string | null
  started_at: string | null
  ended_at: string | null
  skip_reason: string | null
  exit_code: number | null
  cost_usd: number | null
  session_id: string | null
  result: string | null
  profile: string
  model: string | null
  cwd: string | null
  parent_id: string | null
  resume_at: string | null // ISO; quando uma run 'paused' deve ser retomada (reset do limite)
}

export type RunEventKind =
  | 'start' | 'init' | 'prompt' | 'user' | 'text' | 'thinking' | 'tool_call' | 'tool_result' | 'retry' | 'final' | 'stderr' | 'exit'
  | 'permission' | 'permission_reply'

export interface RunEvent {
  runId: string
  seq: number
  ts: string
  kind: RunEventKind
  summary: string
  detail?: string // conteudo completo (expandivel)
  ref?: string // liga tool_call ao tool_result
}

export interface PtyCreateOptions {
  shell?: string
  cwd?: string
  profile?: ProfileId
  launchId?: string // terminal de agente: env da conta preparado pelo main (agents.prepare)
  cols: number
  rows: number
}

export type CursorStyle = 'block' | 'bar' | 'underline'

export interface TerminalSettings {
  fontFamily: string
  fontSize: number
  lineHeight: number
  letterSpacing: number
  fontWeight: 'normal' | '500' | '600'
  cursorStyle: CursorStyle
  cursorBlink: boolean
  scrollback: number
  copyOnSelect: boolean
  rightClickPaste: boolean
  defaultShell: string
  drawBoldInBright: boolean // negrito usa a cor "bright" da paleta
  cursorWidth: number // largura do cursor (bar)
  minimumContrastRatio: number // 1 = desligado; >1 forca contraste minimo (acessibilidade)
  padding: number // respiro interno (px) entre o texto e a borda
  ligatures: boolean // ligaduras de fonte (=>, !=); OFF por padrao (divisivo + custo). Aplica em terminal novo.
  windowOpacity: number // opacidade da janela do app (0.3–1); 1 = opaco
}

export type PreflightState = 'ok' | 'missing_binary' | 'not_logged_in' | 'unhealthy' | 'endpoint_unreachable' | 'bad_token'
export interface PreflightResult {
  state: PreflightState
  message: string
}

export type AwakeMode = 'on' | 'auto' | 'off'

export interface AwakeStatus {
  mode: AwakeMode
  active: boolean
  working: number
}

export interface DetectedAgent {
  id: string
  name: string
  url: string // onde instalar
  path?: string // caminho no PATH; undefined = nao instalado
}

export interface Settings {
  keepAwake: AwakeMode
  routinesDir: string
  openAtLogin: boolean
  ntfyTopic: string
  ntfyServer: string
  theme: string
  uiFontFamily: string
  uiFontSize: number
  integrations?: Integrations // tarefas externas (Jira) e pasta de cada projeto
  onboardedAt: string // '' = ainda nao viu a introducao (instalacao nova)
  seenVersion: string // ultima versao cujas novidades o usuario ja viu
  terminal: TerminalSettings
  connections: Connection[]
}

export interface ShellInfo {
  id: string
  name: string
  path: string
}

// ---- barra lateral: pastas com chats (sessoes de agentes) e links ----
export type AgentId = 'claude' | 'claude-qwen' | 'codex' | 'gemini' | 'qwen-code' | 'opencode' | 'custom'

export interface TermSession {
  agent: 'claude'
  sessionId: string
  cwd: string
  name?: string
}

export interface SidebarItem {
  id: string
  // terminal = aba arrastada para a pasta: reabre na ultima pasta/sessao em que estava
  kind: 'chat' | 'link' | 'terminal'
  name: string
  agent?: AgentId
  sessionId?: string
  cwd?: string
  model?: string
  command?: string // sobrescreve o comando; {id} vira o id da sessao
  url?: string
  shell?: string
  profile?: ProfileId
}

export interface SidebarFolder {
  id: string
  name: string
  items: SidebarItem[]
  mcp?: string[] // servidores do hub de MCP injetados nos agentes abertos desta pasta
  context?: string // cartao de contexto (5-15 linhas) para os agentes desta pasta
}

export interface SidebarState {
  collapsed: Record<string, boolean>
  folders: SidebarFolder[]
}

export interface ClaudeSession {
  id: string
  cwd: string
  title: string
  updatedAt: string
}


// ---- tarefas externas (GitHub Issues, Jira) ----
export interface Integrations {
  jira?: { baseUrl: string; email: string } // token no cofre
  repoMap?: Record<string, string> // projeto (owner/repo ou chave Jira) -> pasta do repositorio
}
export interface Task {
  provider: 'github' | 'jira'
  key: string // owner/repo#123 ou PAY-42
  title: string
  url: string
  project: string
  status?: string
  updatedAt?: string
}
export interface TaskStart {
  cwd: string
  prompt: string
  branch?: string
  file: string
}

// ---- hub de MCP ----
export interface McpServerDef {
  id: string
  name: string
  transport: 'stdio' | 'http'
  command?: string
  args?: string[]
  url?: string
  headers?: Record<string, string>
  env?: Record<string, string>
  secrets?: string[] // nomes de headers/env cujo valor fica no cofre do Turno
  secretSet?: Record<string, boolean> // (leitura) quais segredos ja tem valor
  everyTab?: boolean // injeta tambem em abas de agente abertas fora de uma pasta
  note?: string
  preset?: string
}
export interface McpStatusRow {
  source: 'turno' | 'claude-user' | 'project' | 'codex'
  id: string
  name: string
  transport: 'stdio' | 'http'
  target: string
}

// ---- botao Agent: contas ranqueadas de agentes CLI ----
export interface AgentAccount {
  id: string
  agent: string // id do catalogo (shared/agents.ts)
  label: string
  rank: number // 1 = primeira escolha
  enabled: boolean
  home: string | null // pasta de config isolada; null = login padrao do usuario
  email?: string
  createdAt: string
}
export interface UsageWindow {
  pct: number // 0-100
  resetsAt?: string // ISO
}
export interface AccountUsage {
  fiveHour?: UsageWindow
  weekly?: UsageWindow
  state: 'ok' | 'warning' | 'exhausted' | 'unknown' | 'blocked'
  reason?: string
  until?: string // volta a ter cota (ISO)
  observedAt?: string
}
// Como escolher a conta: ordem da lista; mais folga primeiro; ou a que reseta antes (gasta o que se perderia)
export type RankStrategy = 'rank' | 'headroom' | 'reset-soonest'
export interface AgentsState {
  accounts: AgentAccount[]
  usage: Record<string, AccountUsage>
  thresholds: { fiveHour: number; weekly: number; strategy?: RankStrategy }
  installed: string[] // ids de agentes encontrados no PATH
  signedOut: string[] // contas isoladas sem login encontrado (fora do ranking)
  best?: string // conta que o botao Agent abriria agora (mesma regra e estrategia do main)
}
// Uma conversa de agente aberta num terminal (sobrevive a trocas de conta na mesma aba)
export type AgentTabStatus = 'starting' | 'working' | 'needs-input' | 'needs-permission' | 'idle' | 'error' | 'swapping' | 'parked'
export interface AgentSessionInfo {
  key: string // id da conversa no Turno
  agent: string
  accountId: string
  status: AgentTabStatus
  message?: string
  sessionId?: string // id nativo da sessao (Claude: session_id)
  handoffs: number
}
export interface AgentLaunch {
  launchId: string // o pty:create usa o env guardado por este id
  key: string
  agent: string
  accountId: string
  command: string
  typeAfter?: string // texto digitado depois que o agente subir
  banner?: string
}

export interface TurnoApi {
  pty: {
    create(opts: PtyCreateOptions): Promise<number>
    write(id: number, data: string): void
    resize(id: number, cols: number, rows: number): void
    kill(id: number): void
    onData(cb: (id: number, data: string) => void): () => void
    onExit(cb: (id: number, code: number) => void): () => void
    onSession(cb: (id: number, s: TermSession | null) => void): () => void // null = o Claude saiu
  }
  run: {
    start(req: RunRequest): Promise<string>
    // Fan-out: roda o mesmo prompt em varias connections; devolve um runId por connection (ou erro).
    fanout(prompt: string, connectionIds: string[], cwd?: string): Promise<Array<{ connId: string; runId?: string; error?: string }>>
    startRoutine(id: string): Promise<string>
    stop(runId: string): Promise<void>
    send(runId: string, text: string): Promise<{ runId: string; mode: 'live' | 'followup' }>
    permission(runId: string, requestId: string, decision: 'allow' | 'allow_session' | 'deny'): Promise<boolean>
    thread(runId: string): Promise<RunRecord[]>
    events(runId: string): Promise<RunEvent[]>
    get(runId: string): Promise<RunRecord | undefined>
    list(routine?: string, limit?: number): Promise<RunRecord[]>
    onEvent(cb: (ev: RunEvent) => void): () => void
    onChanged(cb: (run: RunRecord) => void): () => void
  }
  routines: {
    list(): Promise<Routine[]>
    save(draft: RoutineDraft): Promise<Routine>
    setEnabled(id: string, enabled: boolean): Promise<void>
    openFolder(id?: string): Promise<void>
    delete(id: string): Promise<void>
    // marca a pasta como confiavel (e o Chrome como ligado) antes de abrir o Claude num terminal
    prepareClaude(cwd: string | undefined, chrome: boolean): Promise<void>
    template(): Promise<RoutineDraft>
    onChanged(cb: (rs: Routine[]) => void): () => void
  }
  settings: {
    get(): Promise<Settings>
    set(s: Partial<Settings>): Promise<Settings>
    testNotify(): Promise<void>
    shells(): Promise<ShellInfo[]>
    awake(): Promise<AwakeStatus>
    onAwake(cb: (s: AwakeStatus) => void): () => void
    fonts(): Promise<string[]>
    onChanged(cb: (s: Settings) => void): () => void
  }
  ui: {
    onOpenRun(cb: (id: string) => void): () => void
    openExternal(url: string): Promise<void>
    pickFolder(): Promise<string | undefined>
    pathExists(p: string): Promise<boolean>
    fileExists(p: string): Promise<boolean>
    notices(): Promise<Array<{ file: string; message: string }>> // avisos do main (arquivo de dados ilegivel etc.)
    setModalOpen(open: boolean): Promise<void> // modal aberto: janela opaca (window opacity so na tela principal)
    detectAgents(): Promise<DetectedAgent[]> // CLIs de agentes encontrados no PATH (onboarding)
    ollamaModels(baseUrl?: string): Promise<string[]> // modelos instalados no Ollama
    version(): Promise<string>
  }
  sidebar: {
    get(): Promise<SidebarState>
    save(s: SidebarState): Promise<SidebarState>
    claudeSessions(): Promise<ClaudeSession[]>
    claudeSessionExists(id: string): Promise<boolean>
  }
  provider: {
    claudeStatus(): Promise<boolean>
    claudeLogin(): Promise<boolean>
    claudeLogout(): Promise<void>
    setToken(connId: string, token: string): Promise<string> // guarda no cofre, devolve o tokenRef
    deleteToken(connId: string): Promise<void>
    preflight(connId: string): Promise<PreflightResult>
  }
  agents: {
    state(): Promise<AgentsState>
    onState(cb: (s: AgentsState) => void): () => void
    detect(): Promise<string[]>
    sessions(): Promise<AgentSessionInfo[]>
    onSessions(cb: (s: AgentSessionInfo[]) => void): () => void
    prepare(o: { key?: string; agent?: string; accountId?: string; cwd?: string; resumeSessionId?: string; prompt?: string; chrome?: boolean; folderId?: string; model?: string; banner?: string }): Promise<AgentLaunch>
    add(agent: string, label?: string): Promise<{ account: AgentAccount; launchId: string; command: string }>
    login(id: string): Promise<{ launchId: string; command: string }>
    refreshLogin(id: string): Promise<boolean>
    update(id: string, patch: { label?: string; enabled?: boolean }): Promise<void>
    reorder(ids: string[]): Promise<void>
    remove(id: string): Promise<void>
    setThresholds(t: { fiveHour?: number; weekly?: number; strategy?: RankStrategy }): Promise<void>
    clearLimit(id: string): Promise<void>
    swap(key: string, accountId?: string): Promise<void>
    close(key: string): Promise<void>
    onSwap(cb: (l: AgentLaunch) => void): () => void
    onType(cb: (key: string, text: string) => void): () => void
  }
  tasks: {
    list(): Promise<{ tasks: Task[]; errors: Record<string, string>; jiraConnected: boolean }>
    connectJira(o: { baseUrl: string; email: string; token?: string }): Promise<string>
    disconnectJira(): Promise<void>
    start(t: Task, folder: string, worktree: boolean): Promise<TaskStart>
  }
  mcp: {
    list(): Promise<McpServerDef[]>
    save(def: McpServerDef, secrets: Record<string, string>): Promise<McpServerDef>
    remove(id: string): Promise<void>
    status(cwd?: string): Promise<McpStatusRow[]>
  }
  ai: {
    // NL -> comando no terminal: devolve { command, explanation }. command=null => UI nao oferece Execute.
    suggestCommand(connId: string, ctx: { ask: string; lastCommand?: string; output?: string }): Promise<{ command: string | null; explanation: string }>
  }
  stats: {
    ptyMemory(): Promise<Array<{ ptyId: number; pid: number; memKb: number }>>
  }
  winBuild?: number // build do Windows (ConPTY); undefined fora do Windows
  smoke: {
    enabled: boolean
    view?: string // abre um painel por nome (ex. 'fanout') p/ prova visual
    runRoutine?: string
    followup?: string
    theme?: string
    approve?: boolean
    drag?: boolean
    openItem?: string
    edit?: string
    waitSec: number
    done(): void
  }
}
