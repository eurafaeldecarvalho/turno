import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, powerMonitor, shell, Tray } from 'electron'
import { existsSync, statSync } from 'node:fs'
import { stat } from 'node:fs/promises'
import { LINK_RE } from '../shared/links'
import { join } from 'node:path'
import { mkdirSync, writeFileSync } from 'node:fs'
import type { McpServerDef, RankStrategy, Task, RoutineDraft, RunRecord, RunRequest, Settings, SidebarState } from '../shared/types'
import { claudeSessionExists, getSidebar, listClaudeSessions, saveSidebar } from './sidebar'
import { registerPty, killAllPtys } from './pty'
import { activeCount, answerPermission, initRunner, repairRunCosts, readRunEvents, rotatedFrom, setRotateHandler, startRun, stopAllRuns, stopRun, type PermissionDecision } from './runner'
import { openDb, getRun, listRuns, threadOf, renameRoutineRuns, allRunIds } from './db'
import { getSettings, setSettings, settingsReadable } from './settings'
import { takeNotices } from './jsonStore'
import { accountEnv, addAccount, addConnectionAccount, addDefaultAccount, agentsState, setConnectionSource, syncConnectionAccounts, clearBlock, clearLimit, detectInstalled, getAccount, initAccounts, refreshLogin, removeAccount, reorderAccounts, setThresholds, updateAccount } from './accounts'
import { closeSession, initBroker, listSessions, prepareLaunch, prepareRaw, swap, type PrepareOpts } from './agentBroker'
import { listMcp, mcpStatus, removeMcp, saveMcp } from './mcphub'
import { connectJira, disconnectJira, listTasks, startTask } from './tasks'
import { agentDef } from '../shared/agents'
import { detectAgents, ollamaModels } from './onboarding'
import { saveRoutine, setRoutineEnabled, defaultConfig } from './routines'
import { catchUp, findRoutine, followUp, getRoutines, reload, routineOf, runRoutine, setRoot, startEngine } from './engine'
import { notify } from './notify'
import { awakeStatus, initAwake, setAwakeMode } from './awake'
import { themeById } from '../shared/themes'
import { detectShells, listFonts } from './shells'
import { prepareClaude } from './claudeprep'
import { claudeLogin, claudeLogout, claudeStatus } from './provider-auth'
import { setSecret, deleteSecret, connectionToken } from './secrets'
import { connectionAccountEnv, findConnection, getConnection } from './providers'
import { startTranslator } from './translator'
import { checkConnection } from './doctor'
import { suggestCommand } from './ai'

// Opacidade da janela: nunca abaixo de 0.3 (senao fica invisivel), nunca acima de 1.
const clampOpacity = (v: number): number => Math.min(1, Math.max(0.3, Number.isFinite(v) ? v : 1))

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

// Sem o menu padrao do Electron no Windows/Linux: os aceleradores dele (Ctrl+R recarrega, Ctrl+Shift+R forca,
// Ctrl+Shift+I, zoom) disparavam fora do terminal e com dialogos abertos, perdendo o que estava digitado.
// Copiar/colar em campos de texto nao depende do menu nesses sistemas.
if (process.platform !== 'darwin') Menu.setApplicationMenu(null)

function createWindow(): void {
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 900,
    minHeight: 560,
    show: false,
    backgroundColor: themeById(getSettings().theme).ui.bg,
    title: 'Turno',
    icon: resource(process.platform === 'win32' ? 'icon.ico' : 'icon.png'),
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
    win?.setOpacity(clampOpacity(getSettings().terminal.windowOpacity))
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
  // A pagina recarregou (crash panel "Reload window", ou F5 em dev): os terminais da pagina velha morrem junto,
  // senao ficavam shells orfaos rodando e acumulando memoria a cada recarga.
  let loadedOnce = false
  win.webContents.on('did-start-navigation', (d) => {
    if (!d.isMainFrame || d.isSameDocument) return
    if (loadedOnce) killAllPtys()
    loadedOnce = true
  })
  // A janela nunca navega para outro endereco (arquivo ou link solto em cima dela, link clicado): a pagina nova
  // mataria os terminais e herdaria a API do preload. Recarregar a propria janela nao passa por aqui.
  win.webContents.on('will-navigate', (e) => e.preventDefault())
  win.webContents.on('will-redirect', (e) => e.preventDefault())
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
  const isFollowUp = run.trigger === 'followup' && !rotatedFrom(run.parent_id)
  if (mode === 'never' || (mode === 'failures' && !failed) || run.trigger === 'adhoc' || isFollowUp) return
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
// run do ranking de contas que bateu o limite continua pela via do follow-up (cwd efetivo, locks, custo cumulativo)
setRotateHandler(followUp)
// uma vez: refaz os custos das runs antigas pelo log (assinatura nao e gasto; o teto usa o custo do CLI).
// Marcador novo: a limpeza da 0.9.9 ("cost-cleanup-1") apagava custos reais; este reparo os recupera.
// Em segundo plano, depois que o app abriu (le o log de cada run); so as runs que ja existiam ao abrir.
{
  const mark = join(userData, 'cost-repair-2')
  if (!existsSync(mark)) {
    const ids = allRunIds()
    setTimeout(() => {
      repairRunCosts(ids)
        .then(() => writeFileSync(mark, new Date().toISOString()))
        .catch((e) => console.warn('[cost repair]', (e as Error).message))
    }, 10_000)
  }
}
registerPty(liveWc)

// ---- botao Agent: contas, broker de troca, hub de MCP ----
// conexoes de API (Settings › Connections) entram no ranking como contas do Claude Code apontadas para o provedor
setConnectionSource({ list: () => (settingsReadable() ? getSettings().connections : undefined), env: (c) => connectionAccountEnv(c, connectionToken(c)) })
initAccounts((s) => send('agents:state', s))
syncConnectionAccounts()
const brokerReady = initBroker(send, () => showWindow())
// tradutor Anthropic -> OpenAI das conexoes via='translate' (sobe cedo: o env dos agentes precisa da porta)
void startTranslator((id) => {
  const conn = findConnection(getSettings(), id)
  return conn?.via === 'translate' ? { conn, key: connectionToken(conn) } : undefined
})
ipcMain.handle('agents:state', () => agentsState())
ipcMain.handle('agents:detect', () => detectInstalled())
ipcMain.handle('agents:sessions', () => listSessions())
ipcMain.handle('agents:prepare', async (_e, o: PrepareOpts) => (await brokerReady, prepareLaunch(o)))
ipcMain.handle('agents:add', (_e, agent: string, label?: string) => {
  const { account, login, env } = addAccount(agent, label)
  return { account, ...prepareRaw(env, login) }
})
ipcMain.handle('agents:login', (_e, id: string) => {
  const a = getAccount(id)
  if (!a) throw new Error('account not found')
  const def = agentDef(a.agent)
  return prepareRaw(accountEnv(a), def?.login ?? def?.launch ?? def?.cmd ?? '')
})
ipcMain.handle('agents:clearLimit', (_e, id: string) => clearLimit(id))
ipcMain.handle('agents:refreshLogin', (_e, id: string) => {
  const ok = refreshLogin(id)
  if (ok) clearBlock(id) // entrou de novo: volta para o ranking
  return ok
})
ipcMain.handle('agents:update', (_e, id: string, patch: { label?: string; enabled?: boolean }) => updateAccount(id, patch))
ipcMain.handle('agents:reorder', (_e, ids: string[]) => reorderAccounts(ids))
ipcMain.handle('agents:remove', (_e, id: string) => removeAccount(id))
ipcMain.handle('agents:addDefault', (_e, agent: string) => addDefaultAccount(agent))
ipcMain.handle('agents:addConnection', (_e, connId: string) => addConnectionAccount(connId))
ipcMain.handle('agents:thresholds', (_e, t: { fiveHour?: number; weekly?: number; strategy?: RankStrategy }) => setThresholds(t))
ipcMain.handle('agents:swap', (_e, key: string, accountId?: string) => swap(key, 'manual', accountId))
ipcMain.handle('agents:close', (_e, key: string) => closeSession(key))
ipcMain.handle('tasks:list', () => listTasks())
// tasks gravam integrations nos settings pelo main: avisa o renderer (pasta lembrada, Jira conectado)
ipcMain.handle('tasks:connectJira', async (_e, o: { baseUrl: string; email: string; token?: string }) => {
  const r = await connectJira(o)
  send('settings:changed', getSettings())
  return r
})
ipcMain.handle('tasks:disconnectJira', () => {
  disconnectJira()
  send('settings:changed', getSettings())
})
ipcMain.handle('tasks:start', async (_e, t: Task, folder: string, worktree: boolean) => {
  const r = await startTask(t, folder, worktree)
  send('settings:changed', getSettings())
  return r
})
ipcMain.handle('mcp:list', () => listMcp())
ipcMain.handle('mcp:save', (_e, def: McpServerDef, secrets: Record<string, string>) => saveMcp(def, secrets))
ipcMain.handle('mcp:remove', (_e, id: string) => removeMcp(id))
ipcMain.handle('mcp:status', (_e, cwd?: string) => mcpStatus(cwd))

ipcMain.handle('run:start', (_e, req: RunRequest) => startRun({ req, trigger: 'adhoc' }))
ipcMain.handle('run:fanout', (_e, prompt: string, connectionIds: string[], cwd?: string) =>
  connectionIds.map((profile) => {
    try {
      return { connId: profile, runId: startRun({ req: { profile, prompt, cwd }, trigger: 'adhoc' }) }
    } catch (e) {
      return { connId: profile, error: String((e as Error).message) }
    }
  }),
)
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
  if (d.originalId && d.originalId !== d.id) renameRoutineRuns(d.originalId, d.id)
  reload()
  return findRoutine(d.id)
})
ipcMain.handle('routines:setEnabled', (_e, id: string, enabled: boolean) => {
  setRoutineEnabled(getSettings().routinesDir, id, enabled)
  reload()
})
ipcMain.handle('claude:prepare', (_e, cwd: string | undefined, chrome: boolean) => {
  try {
    prepareClaude(cwd, chrome)
  } catch (e) {
    console.error('[claude:prepare]', e)
  }
})
ipcMain.handle('routines:delete', async (_e, id: string) => {
  const r = findRoutine(id)
  if (!r) return
  try {
    await shell.trashItem(r.dir)
  } catch {
    throw new Error("Couldn't move the folder to the Recycle Bin: a file in it is open in another program, or access was denied")
  }
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

const tokenKey = (connId: string): string => `conn:${connId}`
ipcMain.handle('provider:claudeStatus', () => claudeStatus())
ipcMain.handle('provider:claudeLogin', () => claudeLogin())
ipcMain.handle('provider:claudeLogout', () => claudeLogout())
ipcMain.handle('provider:setToken', (_e, connId: string, token: string) => {
  const ref = tokenKey(connId)
  setSecret(ref, token)
  return ref
})
ipcMain.handle('provider:deleteToken', (_e, connId: string) => deleteSecret(tokenKey(connId)))
ipcMain.handle('provider:preflight', (_e, connId: string) => {
  const conn = getConnection(getSettings(), connId)
  return checkConnection(conn)
})
ipcMain.handle('ai:suggestCommand', (_e, connId: string, ctx: { ask: string; lastCommand?: string; output?: string }) => suggestCommand(connId, ctx))
ipcMain.handle('ui:openExternal', (_e, url: string) => {
  if (!LINK_RE.test(url)) throw new Error('unsupported link')
  return shell.openExternal(url)
})
ipcMain.handle('ui:notices', () => takeNotices())
ipcMain.handle('ui:detectAgents', () => detectAgents())
ipcMain.handle('ui:ollamaModels', (_e, baseUrl?: string) => ollamaModels(baseUrl))
ipcMain.handle('ui:version', () => app.getVersion())
// Window opacity vale so para a tela principal: com um modal aberto a janela fica opaca.
let modalOpen = false
const applyOpacity = (): void => win?.setOpacity(modalOpen ? 1 : clampOpacity(getSettings().terminal.windowOpacity))
ipcMain.handle('ui:setModalOpen', (_e, open: boolean) => {
  modalOpen = !!open
  applyOpacity()
})
ipcMain.handle('ui:fileExists', (_e, p: string) => {
  try {
    return !!p && statSync(p).isFile()
  } catch {
    return false
  }
})
// assincrono e com teto: pasta de rede inalcancavel (\\host\share) travava o main inteiro por segundos
// Pasta local: stat direto (rapido). Pasta de rede: assincrono, com teto de 4 s e um stat pendente por servidor —
// stats presos em servidor inalcancavel ocupavam o pool de threads e faziam pastas locais parecerem "inexistentes".
const uncPending = new Set<string>()
ipcMain.handle('ui:pathExists', async (_e, p: string) => {
  if (!p) return false
  const unc = /^[\\/]{2}([^\\/]+)/.exec(p)?.[1]?.toLowerCase()
  if (!unc) {
    try {
      return statSync(p).isDirectory() // so pastas: um arquivo no lugar da pasta tambem nao serve
    } catch {
      return false
    }
  }
  if (uncPending.has(unc)) return false // servidor ainda sem resposta: nao empilha outro stat
  uncPending.add(unc)
  const check = stat(p).then((s) => s.isDirectory(), () => false).finally(() => uncPending.delete(unc))
  return Promise.race([check, new Promise<boolean>((res) => setTimeout(() => res(false), 4000))])
})
ipcMain.handle('ui:pickFolder', async () => {
  const r = await dialog.showOpenDialog(win!, { properties: ['openDirectory'] })
  return r.canceled ? undefined : r.filePaths[0]
})

ipcMain.handle('settings:get', () => getSettings())
ipcMain.handle('settings:set', (_e, patch: Partial<Settings>) => {
  const before = getSettings()
  let s: Settings
  try {
    s = setSettings(patch)
  } catch (e) {
    // settings.json lido de novo (estava travado na abertura): os efeitos dos valores reais valem agora
    const now = getSettings()
    if (now !== before) {
      if (now.openAtLogin !== before.openAtLogin) applyOpenAtLogin(now.openAtLogin)
      if (now.routinesDir !== before.routinesDir) setRoot(now.routinesDir)
      if (now.theme !== before.theme) applyTitleBar()
      if (now.keepAwake !== before.keepAwake) setAwakeMode(now.keepAwake)
      if (now.terminal.windowOpacity !== before.terminal.windowOpacity) applyOpacity()
      syncConnectionAccounts() // agora com as conexoes reais
      send('settings:changed', now)
    }
    throw e
  }
  if (patch.openAtLogin !== undefined && patch.openAtLogin !== before.openAtLogin) applyOpenAtLogin(patch.openAtLogin)
  if (patch.routinesDir && patch.routinesDir !== before.routinesDir) setRoot(s.routinesDir)
  if (patch.theme) applyTitleBar()
  if (patch.keepAwake) setAwakeMode(patch.keepAwake)
  if (patch.terminal?.windowOpacity !== undefined) applyOpacity()
  if (patch.connections) syncConnectionAccounts({ edited: true }) // conexao nova/renomeada/removida (ou chave trocada) reflete no ranking
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
  // Captura a pagina inteira: redimensiona o conteudo (alto) via env TURNO_SMOKE_H antes do shot.
  const smokeH = Number(process.env.TURNO_SMOKE_H)
  if (smokeH > 0) {
    win.setContentSize(1440, smokeH)
    await new Promise((r) => setTimeout(r, 400))
  }
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
  if (!smoke) catchUp() // smoke le a pasta real de rotinas: nunca dispara slot atrasado
  if (!smoke) powerMonitor.on('resume', () => setTimeout(catchUp, 15_000)) // espera a rede voltar
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
