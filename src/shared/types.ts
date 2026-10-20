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
}

export interface Routine {
  id: string // nome da pasta
  dir: string
  config: RoutineConfig
  prompt: string
  error?: string
  nextRuns: string[] // ISO
  lastRun?: RunRecord
}

export interface RoutineDraft {
  id: string
  originalId?: string
  config: RoutineConfig
  prompt: string
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

export interface Settings {
  keepAwake: AwakeMode
  routinesDir: string
  openAtLogin: boolean
  ntfyTopic: string
  ntfyServer: string
  theme: string
  uiFontFamily: string
  uiFontSize: number
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
  ai: {
    // NL -> comando no terminal: devolve { command, explanation }. command=null => UI nao oferece Execute.
    suggestCommand(connId: string, ctx: { ask: string; lastCommand?: string; output?: string }): Promise<{ command: string | null; explanation: string }>
  }
  stats: {
    ptyMemory(): Promise<Array<{ ptyId: number; pid: number; memKb: number }>>
  }
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
