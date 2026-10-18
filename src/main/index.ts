import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, powerMonitor, shell, Tray } from 'electron'
import { join } from 'node:path'
import { mkdirSync, writeFileSync } from 'node:fs'
import type { RoutineDraft, RunRecord, RunRequest, Settings, SidebarState } from '../shared/types'
import { claudeSessionExists, getSidebar, listClaudeSessions, saveSidebar } from './sidebar'
import { registerPty, killAllPtys } from './pty'
import { activeCount, answerPermission, initRunner, readRunEvents, startRun, stopAllRuns, stopRun, type PermissionDecision } from './runner'
import { openDb, getRun, listRuns, threadOf } from './db'
import { getSettings, setSettings } from './settings'
import { saveRoutine, setRoutineEnabled, defaultConfig } from './routines'
import { catchUp, findRoutine, followUp, getRoutines, reload, routineOf, runRoutine, setRoot, startEngine } from './engine'
import { notify } from './notify'
import { awakeStatus, initAwake, setAwakeMode } from './awake'
import { themeById } from '../shared/themes'
import { detectShells, listFonts } from './shells'

const smoke = process.argv.includes('--smoke')
const startHidden = process.argv.includes('--hidden')
let win: BrowserWindow | undefined
let tray: Tray | undefined
let quitting = false

// Testes isolados: outra pasta de dados (banco, settings, runs) sem tocar na instalacao real.
if (process.env.TURNO_USER_DATA) app.setPath('userData', process.env.TURNO_USER_DATA)
app.setAppUserModelId('io.github.eurafaeldecarvalho.turno') // sem isso os toasts do Windows somem calados

if (!smoke && !app.requestSingleInstanceLock()) {
  app.quit()
  process.exit(0)
}
app.on('second-instance', () => showWindow())

const resource = (f: string): string =>
  app.isPackaged ? join(process.resourcesPath, 'resources', f) : join(app.getAppPath(), 'resources', f)

const userData = app.getPath('userData')
const runsDir = join(userData, 'runs')
mkdirSync(runsDir, { recursive: true })
openDb(join(userData, 'turno.db'))

// Depois de fechar a janela, ptys e runs ainda podem emitir saida: nunca enviar para um webContents destruido.
const liveWc = () => (win && !win.isDestroyed() && !win.webContents.isDestroyed() ? win.webContents : undefined)
const send = (ch: string, ...args: unknown[]): void => liveWc()?.send(ch, ...args)

function createWindow(): void {
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 900,
    minHeight: 560,
    show: false,
    backgroundColor: themeById(getSettings().theme).ui.bg,
    title: 'Turno',
    icon: resource('icon.png'),
    autoHideMenuBar: true,
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: themeById(getSettings().theme).ui.bg, symbolColor: themeById(getSettings().theme).ui.muted, height: 36 },
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      additionalArguments: smoke ? ['--turno-smoke', ...process.argv.filter((a) => a.startsWith('--smoke-'))] : [],
    },
  })
  win.once('ready-to-show', () => {
    if (!startHidden || smoke) win?.show()
  })
  // Fechar a janela so esconde: as rotinas continuam rodando na bandeja.
  win.on('close', (e) => {
    if (!quitting && !smoke) {
      e.preventDefault()
      win?.hide()
    }
  })
  win.on('closed', () => {
    win = undefined
    killAllPtys()
  })
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })
  if (process.env.ELECTRON_RENDERER_URL) void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else void win.loadFile(join(__dirname, '../renderer/index.html'))
}

function showWindow(): void {
  if (!win) createWindow()
  win!.show()
  if (win!.isMinimized()) win!.restore()
  win!.focus()
}

function quit(): void {
  quitting = true
  app.quit()
}

function buildTray(): void {
  tray = new Tray(nativeImage.createFromPath(resource('tray.png')))
  tray.on('click', showWindow)
  refreshTray()
}

function refreshTray(): void {
  if (!tray) return
  const n = activeCount()
  tray.setToolTip(n ? `Turno — ${n} routine(s) running` : 'Turno — idle')
  const s = getSettings()
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Open Turno', click: showWindow },
      { type: 'separator' },
      {
        label: 'Start with Windows',
        type: 'checkbox',
        checked: s.openAtLogin,
        click: (item) => applyOpenAtLogin(item.checked),
      },
      {
        label: 'Keep computer awake',
        submenu: (['on', 'auto', 'off'] as const).map((m) => ({
          label: { on: 'On (always)', auto: 'Agent (while working)', off: 'Off' }[m],
          type: 'radio' as const,
          checked: s.keepAwake === m,
          click: () => {
            setSettings({ keepAwake: m })
            setAwakeMode(m)
            send('settings:changed', getSettings())
            refreshTray()
          },
        })),
      },
      { label: 'Open routines folder', click: () => void shell.openPath(s.routinesDir) },
      { type: 'separator' },
      { label: 'Quit (stops routines)', click: quit },
    ]),
  )
}

function applyOpenAtLogin(on: boolean): void {
  setSettings({ openAtLogin: on })
  // Em dev o executavel e o electron.exe e precisa do caminho do app como argumento.
  const args = app.isPackaged ? ['--hidden'] : [app.getAppPath(), '--hidden']
  app.setLoginItemSettings({ openAtLogin: on, path: process.execPath, args })
  refreshTray()
}

function onRunFinished(run: RunRecord): void {
  refreshTray()
  const r = routineOf(run)
  const mode = r?.config.notify ?? 'failures'
  const failed = run.status !== 'ok'
  if (mode === 'never' || (mode === 'failures' && !failed) || run.trigger === 'adhoc' || run.trigger === 'followup') return
  const name = r?.config.name ?? run.routine ?? 'Run'
  const title = failed ? `⚠ ${name}: ${run.status}` : `✓ ${name} finished`
  const body = failed ? (run.skip_reason ?? run.result ?? 'see the log in Turno') : (run.result ?? '')
  void notify(title, body, () => {
    showWindow()
    send('ui:open-run', run.id)
  })
}

initRunner({
  runsDir,
  onEvent: (ev) => send('run:event', ev),
  onChanged: (run) => {
    send('run:changed', run)
    refreshTray()
    // Rotinas pulam antes de chegar ao runner: tambem avisam se configurado.
    if (run.status === 'skipped') onRunFinished(run)
  },
  onFinished: onRunFinished,
  onPermission: (runId, tool, what) => {
    const run = getRun(runId)
    const name = (run && routineOf(run)?.config.name) ?? 'Run'
    void notify(`🔐 ${name} needs permission`, `${tool}: ${what}`.slice(0, 240), () => {
      showWindow()
      send('ui:open-run', runId)
    })
  },
})
registerPty(liveWc)

ipcMain.handle('run:start', (_e, req: RunRequest) => startRun({ req, trigger: 'adhoc' }))
ipcMain.handle('run:startRoutine', async (_e, id: string) => {
  const runId = await runRoutine(id, 'manual')
  return runId ?? ''
})
ipcMain.handle('run:stop', (_e, runId: string) => stopRun(runId))
ipcMain.handle('run:send', (_e, runId: string, text: string) => followUp(runId, text))
ipcMain.handle('run:permission', (_e, runId: string, requestId: string, decision: PermissionDecision) =>
  answerPermission(runId, requestId, decision),
)
ipcMain.handle('run:thread', (_e, runId: string) => threadOf(runId))
ipcMain.handle('run:events', (_e, runId: string) => readRunEvents(runId))
ipcMain.handle('run:get', (_e, runId: string) => getRun(runId))
ipcMain.handle('run:list', (_e, routine?: string, limit?: number) => listRuns(routine, limit))

ipcMain.handle('routines:list', () => getRoutines())
ipcMain.handle('routines:save', (_e, d: RoutineDraft) => {
  saveRoutine(getSettings().routinesDir, d)
  reload()
  return findRoutine(d.id)
})
ipcMain.handle('routines:setEnabled', (_e, id: string, enabled: boolean) => {
  setRoutineEnabled(getSettings().routinesDir, id, enabled)
  reload()
})
ipcMain.handle('routines:openFolder', (_e, id?: string) =>
  shell.openPath(id ? (findRoutine(id)?.dir ?? getSettings().routinesDir) : getSettings().routinesDir),
)
ipcMain.handle('routines:template', (): RoutineDraft => ({ id: '', config: defaultConfig(), prompt: '' }))

ipcMain.handle('sidebar:get', () => getSidebar())
ipcMain.handle('sidebar:save', (_e, s: SidebarState) => saveSidebar(s))
ipcMain.handle('sidebar:claudeSessions', () => listClaudeSessions())
ipcMain.handle('sidebar:claudeSessionExists', (_e, id: string) => claudeSessionExists(id))
ipcMain.handle('ui:openExternal', (_e, url: string) => {
  // So abre esquemas conhecidos (http/https e protocolos de apps), nunca arquivo local.
  if (!/^(https?|claude|vscode|cursor|chatgpt|slack|notion|obsidian):/i.test(url)) throw new Error('unsupported link')
  return shell.openExternal(url)
})
ipcMain.handle('ui:pickFolder', async () => {
  const r = await dialog.showOpenDialog(win!, { properties: ['openDirectory'] })
  return r.canceled ? undefined : r.filePaths[0]
})

ipcMain.handle('settings:get', () => getSettings())
ipcMain.handle('settings:set', (_e, patch: Partial<Settings>) => {
  const before = getSettings()
  const s = setSettings(patch)
  if (patch.openAtLogin !== undefined && patch.openAtLogin !== before.openAtLogin) applyOpenAtLogin(patch.openAtLogin)
  if (patch.routinesDir && patch.routinesDir !== before.routinesDir) setRoot(s.routinesDir)
  if (patch.theme) applyTitleBar()
  if (patch.keepAwake) setAwakeMode(patch.keepAwake)
  send('settings:changed', s)
  return s
})
ipcMain.handle('settings:testNotify', () => notify('Turno', 'Test notification: it works.', undefined, { force: true }))
ipcMain.handle('settings:shells', () => detectShells())
ipcMain.handle('settings:awake', () => awakeStatus())
ipcMain.handle('settings:fonts', () => listFonts())

// Barra de titulo nativa (botoes do Windows) acompanha o tema.
function applyTitleBar(): void {
  const t = themeById(getSettings().theme)
  try {
    win?.setTitleBarOverlay({ color: t.ui.bg, symbolColor: t.ui.muted, height: 36 })
    win?.setBackgroundColor(t.ui.bg)
  } catch {
    /* sem overlay */
  }
}

// Modo smoke: o renderer monta a tela; salvamos um screenshot e saimos.
async function finishSmoke(): Promise<void> {
  if (!win) return
  const outDir = join(process.cwd(), 'smoke')
  mkdirSync(outDir, { recursive: true })
  const img = await win.webContents.capturePage()
  writeFileSync(join(outDir, 'screenshot.png'), img.toPNG())
  console.log(`[smoke] screenshot salvo em ${join(outDir, 'screenshot.png')}`)
  await stopAllRuns()
  killAllPtys()
  quit()
}
ipcMain.on('smoke:done', () => void finishSmoke())

app.whenReady().then(() => {
  initAwake(getSettings().keepAwake, (s) => {
    send('settings:awake', s)
    refreshTray()
  })
  startEngine(getSettings().routinesDir, (rs) => send('routines:changed', rs))
  createWindow()
  if (!smoke) buildTray()
  catchUp()
  powerMonitor.on('resume', () => setTimeout(catchUp, 15_000)) // espera a rede voltar
  if (smoke) setTimeout(() => void finishSmoke(), 5 * 60_000)
})

app.on('window-all-closed', () => {
  // Fica na bandeja: so sai pelo menu "Sair" (ou no modo smoke).
  if (smoke) quit()
})

app.on('before-quit', async (e) => {
  quitting = true
  if (activeCount()) {
    e.preventDefault()
    await stopAllRuns()
    app.quit()
  }
})
