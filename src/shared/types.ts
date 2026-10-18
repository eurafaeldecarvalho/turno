export type ProfileId = 'claude-max' | 'qwen-local'
export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max'
// Modos do `claude --permission-mode`. bypassPermissions = --dangerously-skip-permissions.
export type PermissionMode = 'manual' | 'acceptEdits' | 'auto' | 'dontAsk' | 'bypassPermissions'
export type Weekday = 'dom' | 'seg' | 'ter' | 'qua' | 'qui' | 'sex' | 'sab'
export const WEEKDAYS: Weekday[] = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sab']

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
  catchup: boolean
  catchup_window_h: number
  precheck?: string
  notify: 'falhas' | 'sempre' | 'nunca'
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
export type RunTrigger = 'manual' | 'cron' | 'catchup' | 'adhoc' | 'followup'

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
    onSession(cb: (id: number, s: TermSession) => void): () => void
  }
  run: {
    start(req: RunRequest): Promise<string>
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
  smoke: {
    enabled: boolean
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
