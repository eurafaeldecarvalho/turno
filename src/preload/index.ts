import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron'
import { release } from 'node:os'
import type { TurnoApi, RunEvent, RunRecord, Routine, Settings, AwakeStatus, TermSession, AgentsState, AgentSessionInfo, AgentLaunch } from '../shared/types'

function listen<T extends unknown[]>(channel: string, cb: (...args: T) => void): () => void {
  const h = (_e: IpcRendererEvent, ...args: unknown[]): void => cb(...(args as T))
  ipcRenderer.on(channel, h)
  return () => ipcRenderer.removeListener(channel, h)
}

// Build do Windows para o xterm ajustar o reflow ao ConPTY (windowsPty).
const winBuild = process.platform === 'win32' ? Number(release().split('.')[2]) || undefined : undefined

const api: TurnoApi = {
  winBuild,
  pty: {
    create: (opts) => ipcRenderer.invoke('pty:create', opts),
    write: (id, data) => ipcRenderer.send('pty:write', id, data),
    resize: (id, cols, rows) => ipcRenderer.send('pty:resize', id, cols, rows),
    kill: (id) => ipcRenderer.send('pty:kill', id),
    onData: (cb) => listen<[number, string]>('pty:data', cb),
    onExit: (cb) => listen<[number, number]>('pty:exit', cb),
    onSession: (cb) => listen<[number, TermSession | null]>('pty:session', cb),
  },
  run: {
    start: (req) => ipcRenderer.invoke('run:start', req),
    fanout: (prompt, connectionIds, cwd) => ipcRenderer.invoke('run:fanout', prompt, connectionIds, cwd),
    startRoutine: (id) => ipcRenderer.invoke('run:startRoutine', id),
    stop: (runId) => ipcRenderer.invoke('run:stop', runId),
    send: (runId, text) => ipcRenderer.invoke('run:send', runId, text),
    permission: (runId, requestId, decision) => ipcRenderer.invoke('run:permission', runId, requestId, decision),
    thread: (runId) => ipcRenderer.invoke('run:thread', runId),
    events: (runId) => ipcRenderer.invoke('run:events', runId),
    get: (runId) => ipcRenderer.invoke('run:get', runId),
    list: (routine, limit) => ipcRenderer.invoke('run:list', routine, limit),
    onEvent: (cb) => listen<[RunEvent]>('run:event', cb),
    onChanged: (cb) => listen<[RunRecord]>('run:changed', cb),
  },
  routines: {
    list: () => ipcRenderer.invoke('routines:list'),
    save: (d) => ipcRenderer.invoke('routines:save', d),
    setEnabled: (id, enabled) => ipcRenderer.invoke('routines:setEnabled', id, enabled),
    openFolder: (id) => ipcRenderer.invoke('routines:openFolder', id),
    delete: (id) => ipcRenderer.invoke('routines:delete', id),
    prepareClaude: (cwd, chrome) => ipcRenderer.invoke('claude:prepare', cwd, chrome),
    template: () => ipcRenderer.invoke('routines:template'),
    onChanged: (cb) => listen<[Routine[]]>('routines:changed', cb),
  },
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    set: (s) => ipcRenderer.invoke('settings:set', s),
    testNotify: () => ipcRenderer.invoke('settings:testNotify'),
    shells: () => ipcRenderer.invoke('settings:shells'),
    awake: () => ipcRenderer.invoke('settings:awake'),
    onAwake: (cb) => listen<[AwakeStatus]>('settings:awake', cb),
    fonts: () => ipcRenderer.invoke('settings:fonts'),
    onChanged: (cb) => listen<[Settings]>('settings:changed', cb),
  },
  ui: {
    onOpenRun: (cb) => listen<[string]>('ui:open-run', cb),
    openExternal: (url) => ipcRenderer.invoke('ui:openExternal', url),
    pickFolder: () => ipcRenderer.invoke('ui:pickFolder'),
    pathExists: (p: string) => ipcRenderer.invoke('ui:pathExists', p),
    fileExists: (p: string): Promise<boolean> => ipcRenderer.invoke('ui:fileExists', p),
    notices: (): Promise<Array<{ file: string; message: string }>> => ipcRenderer.invoke('ui:notices'),
    setModalOpen: (open: boolean): Promise<void> => ipcRenderer.invoke('ui:setModalOpen', open),
    detectAgents: () => ipcRenderer.invoke('ui:detectAgents'),
    installClaude: () => ipcRenderer.invoke('ui:installClaude'),
    ollamaModels: (baseUrl?: string) => ipcRenderer.invoke('ui:ollamaModels', baseUrl),
    version: () => ipcRenderer.invoke('ui:version'),
  },
  sidebar: {
    get: () => ipcRenderer.invoke('sidebar:get'),
    save: (s) => ipcRenderer.invoke('sidebar:save', s),
    claudeSessions: () => ipcRenderer.invoke('sidebar:claudeSessions'),
    claudeSessionExists: (id) => ipcRenderer.invoke('sidebar:claudeSessionExists', id),
  },
  provider: {
    claudeStatus: () => ipcRenderer.invoke('provider:claudeStatus'),
    claudeLogin: () => ipcRenderer.invoke('provider:claudeLogin'),
    claudeLogout: () => ipcRenderer.invoke('provider:claudeLogout'),
    setToken: (connId, token) => ipcRenderer.invoke('provider:setToken', connId, token),
    deleteToken: (connId) => ipcRenderer.invoke('provider:deleteToken', connId),
    preflight: (connId) => ipcRenderer.invoke('provider:preflight', connId),
  },
  agents: {
    state: () => ipcRenderer.invoke('agents:state'),
    onState: (cb) => listen<[AgentsState]>('agents:state', cb),
    detect: () => ipcRenderer.invoke('agents:detect'),
    sessions: () => ipcRenderer.invoke('agents:sessions'),
    onSessions: (cb) => listen<[AgentSessionInfo[]]>('agents:sessions', cb),
    prepare: (o) => ipcRenderer.invoke('agents:prepare', o),
    add: (agent, label) => ipcRenderer.invoke('agents:add', agent, label),
    login: (id) => ipcRenderer.invoke('agents:login', id),
    refreshLogin: (id) => ipcRenderer.invoke('agents:refreshLogin', id),
    clearLimit: (id) => ipcRenderer.invoke('agents:clearLimit', id),
    update: (id, patch) => ipcRenderer.invoke('agents:update', id, patch),
    reorder: (ids) => ipcRenderer.invoke('agents:reorder', ids),
    remove: (id) => ipcRenderer.invoke('agents:remove', id),
    addDefault: (agent) => ipcRenderer.invoke('agents:addDefault', agent),
    addConnection: (connId) => ipcRenderer.invoke('agents:addConnection', connId),
    setThresholds: (t) => ipcRenderer.invoke('agents:thresholds', t),
    swap: (key, accountId) => ipcRenderer.invoke('agents:swap', key, accountId),
    close: (key) => ipcRenderer.invoke('agents:close', key),
    onSwap: (cb) => listen<[AgentLaunch]>('agents:swap', cb),
    onType: (cb) => listen<[string, string]>('agents:type', cb),
  },
  tasks: {
    list: () => ipcRenderer.invoke('tasks:list'),
    connectJira: (o) => ipcRenderer.invoke('tasks:connectJira', o),
    disconnectJira: () => ipcRenderer.invoke('tasks:disconnectJira'),
    start: (t, folder, worktree) => ipcRenderer.invoke('tasks:start', t, folder, worktree),
  },
  mcp: {
    list: () => ipcRenderer.invoke('mcp:list'),
    save: (def, secrets) => ipcRenderer.invoke('mcp:save', def, secrets),
    remove: (id) => ipcRenderer.invoke('mcp:remove', id),
    status: (cwd) => ipcRenderer.invoke('mcp:status', cwd),
  },
  ai: {
    suggestCommand: (connId, ctx) => ipcRenderer.invoke('ai:suggestCommand', connId, ctx),
  },
  stats: {
    ptyMemory: () => ipcRenderer.invoke('pty:memory'),
  },
  smoke: {
    enabled: process.argv.includes('--turno-smoke'),
    view: process.argv.find((a) => a.startsWith('--smoke-view='))?.slice('--smoke-view='.length),
    waitSec: Number(process.argv.find((a) => a.startsWith('--smoke-wait='))?.slice(13) ?? 0),
    followup: process.argv.find((a) => a.startsWith('--smoke-followup='))?.slice('--smoke-followup='.length),
    theme: process.argv.find((a) => a.startsWith('--smoke-theme='))?.slice('--smoke-theme='.length),
    approve: process.argv.includes('--smoke-approve'),
    drag: process.argv.includes('--smoke-drag'),
    openItem: process.argv.find((a) => a.startsWith('--smoke-open='))?.slice('--smoke-open='.length),
    edit: process.argv.find((a) => a.startsWith('--smoke-edit='))?.slice('--smoke-edit='.length),
    runRoutine: process.argv.find((a) => a.startsWith('--smoke-run='))?.slice('--smoke-run='.length),
    done: () => ipcRenderer.send('smoke:done'),
  },
}

contextBridge.exposeInMainWorld('turno', api)
