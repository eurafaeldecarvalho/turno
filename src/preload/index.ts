import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron'
import type { TurnoApi, RunEvent, RunRecord, Routine, Settings, AwakeStatus } from '../shared/types'

function listen<T extends unknown[]>(channel: string, cb: (...args: T) => void): () => void {
  const h = (_e: IpcRendererEvent, ...args: unknown[]): void => cb(...(args as T))
  ipcRenderer.on(channel, h)
  return () => ipcRenderer.removeListener(channel, h)
}

const api: TurnoApi = {
  pty: {
    create: (opts) => ipcRenderer.invoke('pty:create', opts),
    write: (id, data) => ipcRenderer.send('pty:write', id, data),
    resize: (id, cols, rows) => ipcRenderer.send('pty:resize', id, cols, rows),
    kill: (id) => ipcRenderer.send('pty:kill', id),
    onData: (cb) => listen<[number, string]>('pty:data', cb),
    onExit: (cb) => listen<[number, number]>('pty:exit', cb),
  },
  run: {
    start: (req) => ipcRenderer.invoke('run:start', req),
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
  },
  sidebar: {
    get: () => ipcRenderer.invoke('sidebar:get'),
    save: (s) => ipcRenderer.invoke('sidebar:save', s),
    claudeSessions: () => ipcRenderer.invoke('sidebar:claudeSessions'),
    claudeSessionExists: (id) => ipcRenderer.invoke('sidebar:claudeSessionExists', id),
  },
  smoke: {
    enabled: process.argv.includes('--turno-smoke'),
    waitSec: Number(process.argv.find((a) => a.startsWith('--smoke-wait='))?.slice(13) ?? 0),
    followup: process.argv.find((a) => a.startsWith('--smoke-followup='))?.slice('--smoke-followup='.length),
    theme: process.argv.find((a) => a.startsWith('--smoke-theme='))?.slice('--smoke-theme='.length),
    approve: process.argv.includes('--smoke-approve'),
    edit: process.argv.find((a) => a.startsWith('--smoke-edit='))?.slice('--smoke-edit='.length),
    runRoutine: process.argv.find((a) => a.startsWith('--smoke-run='))?.slice('--smoke-run='.length),
    done: () => ipcRenderer.send('smoke:done'),
  },
}

contextBridge.exposeInMainWorld('turno', api)
