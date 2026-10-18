import { useCallback, useEffect, useState, type ReactElement } from 'react'
import {
  DockviewReact,
  DockviewReadyEvent,
  IDockviewHeaderActionsProps,
  IDockviewPanelHeaderProps,
  IWatermarkPanelProps,
  themeAbyss,
} from 'dockview-react'
import { TerminalPanel } from './panels/TerminalPanel'
import { RoutineEditor } from './panels/RoutineEditor'
import { RunViewer, RoutineSession } from './panels/RunViewer'
import { HistoryPanel } from './panels/HistoryPanel'
import { AdhocPanel } from './panels/AdhocPanel'
import { SettingsPanel } from './panels/SettingsPanel'
import { Sidebar } from './Sidebar'
import { StatusBar } from './StatusBar'
import { dockApi, openAdhoc, openHistory, openRoutine, openRun, openSettings, openTerminal, restoreLayout, saveLayout, setDockApi } from './layout'
import { initStore, useStore } from './store'
import { updateSettings } from './appearance'
import {
  IconClock,
  IconChat,
  IconClose,
  IconHistory,
  IconMaximize,
  IconMinimize,
  IconPlus,
  IconRoutine,
  IconSettings,
  IconSpark,
  IconSplitDown,
  IconSplitRight,
  IconTerminal,
} from './icons'

const components = {
  terminal: TerminalPanel,
  routine: RoutineEditor,
  run: RunViewer,
  session: RoutineSession,
  history: HistoryPanel,
  adhoc: AdhocPanel,
  settings: SettingsPanel,
}

const KIND_ICON: Record<string, (p: { size?: number }) => ReactElement> = {
  terminal: IconTerminal,
  routine: IconRoutine,
  run: IconClock,
  session: IconChat,
  history: IconHistory,
  adhoc: IconSpark,
  settings: IconSettings,
}

function Tab({ api, params }: IDockviewPanelHeaderProps<{ kind?: string }>) {
  const [title, setTitle] = useState(api.title)
  useEffect(() => api.onDidTitleChange((e) => setTitle(e.title)).dispose, [api])
  const Icon = KIND_ICON[params.kind ?? 'terminal'] ?? IconTerminal
  return (
    <div className="tab" onAuxClick={(e) => e.button === 1 && api.close()} title={title}>
      <Icon size={13} />
      <span className="tab-title">{title}</span>
      <button
        className="tab-close"
        aria-label="Fechar"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation()
          api.close()
        }}
      >
        <IconClose size={12} />
      </button>
    </div>
  )
}

// Botoes no cabecalho de cada grupo, como no Orca: dividir a direita, abaixo e maximizar.
function GroupActions({ group, containerApi }: IDockviewHeaderActionsProps) {
  const [max, setMax] = useState(containerApi.hasMaximizedGroup())
  useEffect(() => containerApi.onDidMaximizedGroupChange(() => setMax(containerApi.hasMaximizedGroup())).dispose, [containerApi])
  const ref = group.activePanel?.id
  return (
    <div className="group-actions">
      <button title="Novo terminal nesta aba" onClick={() => group.activePanel && openTerminal(undefined, {}, undefined, ref) }>
        <IconPlus size={14} />
      </button>
      <button title="Dividir à direita (Alt+Shift+=)" onClick={() => openTerminal('right', {}, undefined, ref)}>
        <IconSplitRight size={14} />
      </button>
      <button title="Dividir abaixo (Alt+Shift+-)" onClick={() => openTerminal('below', {}, undefined, ref)}>
        <IconSplitDown size={14} />
      </button>
      <button
        title={max ? 'Restaurar (Ctrl+Shift+M)' : 'Maximizar (Ctrl+Shift+M)'}
        onClick={() => (max ? containerApi.exitMaximizedGroup() : group.activePanel && containerApi.maximizeGroup(group.activePanel))}
      >
        {max ? <IconMinimize size={14} /> : <IconMaximize size={14} />}
      </button>
    </div>
  )
}

function Welcome(_: IWatermarkPanelProps) {
  const routines = useStore((s) => s.routines)
  return (
    <div className="welcome">
      <img src="./icon.png" alt="" width={56} height={56} />
      <h1>Turno</h1>
      <p className="muted">Rotinas de agentes no seu PC, com Claude ou Qwen local.</p>
      <div className="welcome-actions">
        <button className="btn primary" onClick={() => openRoutine(null, 'Nova rotina')}>
          <IconRoutine /> Nova rotina
        </button>
        <button className="btn" onClick={() => openTerminal()}>
          <IconTerminal /> Terminal
        </button>
        <button className="btn" onClick={() => openHistory()}>
          <IconHistory /> Execuções
        </button>
      </div>
      <dl className="shortcuts">
        <dt>Alt+Shift+=</dt><dd>dividir à direita</dd>
        <dt>Alt+Shift+-</dt><dd>dividir abaixo</dd>
        <dt>Ctrl+Shift+T</dt><dd>novo terminal</dd>
        <dt>Ctrl+Shift+M</dt><dd>maximizar</dd>
        <dt>Ctrl+Shift+W</dt><dd>fechar painel</dd>
        <dt>Ctrl+,</dt><dd>configurações</dd>
        <dt>Ctrl+Shift+H</dt><dd>execuções</dd>
        <dt>Shift+Enter</dt><dd>nova linha no claude do terminal</dd>
        <dt>arrastar aba</dt><dd>soltar sobre outro painel para dividir</dd>
      </dl>
      {routines.length > 0 && <p className="muted small">{routines.length} rotina(s) carregada(s) na barra lateral.</p>}
    </div>
  )
}

export function App() {
  const onReady = useCallback((e: DockviewReadyEvent) => {
    setDockApi(e.api)
    let t: ReturnType<typeof setTimeout> | undefined
    e.api.onDidLayoutChange(() => {
      clearTimeout(t)
      t = setTimeout(saveLayout, 500)
    })
    if (window.turno.smoke.enabled) return void runSmoke()
    if (!restoreLayout()) {
      openTerminal()
      openHistory()
    }
  }, [])

  useEffect(() => {
    void initStore()
    const off = window.turno.ui.onOpenRun((id) => openRun(id, 'Execução'))
    const onKey = (ev: KeyboardEvent): void => {
      const api = dockApi()
      if (!api) return
      const k = ev.key.toLowerCase()
      const hit = (fn: () => void): void => {
        ev.preventDefault()
        ev.stopPropagation()
        fn()
      }
      if (ev.altKey && ev.shiftKey && (k === '+' || k === '=')) hit(() => openTerminal('right'))
      else if (ev.altKey && ev.shiftKey && (k === '_' || k === '-')) hit(() => openTerminal('below'))
      else if (ev.ctrlKey && ev.shiftKey && k === 't') hit(() => openTerminal())
      else if (ev.ctrlKey && !ev.shiftKey && k === ',') hit(() => openSettings())
      else if (ev.ctrlKey && ev.shiftKey && k === 'h') hit(() => openHistory())
      else if (ev.ctrlKey && ev.shiftKey && k === 'w') hit(() => api.activePanel?.api.close())
      else if (ev.ctrlKey && ev.shiftKey && k === 'm')
        hit(() => {
          const p = api.activePanel
          if (p) api.hasMaximizedGroup() ? api.exitMaximizedGroup() : api.maximizeGroup(p)
        })
    }
    window.addEventListener('keydown', onKey, true)
    return () => {
      off()
      window.removeEventListener('keydown', onKey, true)
    }
  }, [])

  return (
    <div className="app">
      <Sidebar />
      <main className="main">
        <div className="titlebar drag" />
        <DockviewReact
          className="dock"
          components={components}
          tabComponents={{ tab: Tab }}
          defaultTabComponent={Tab}
          rightHeaderActionsComponent={GroupActions}
          watermarkComponent={Welcome}
          onReady={onReady}
          theme={themeAbyss}
          dndCompass
        />
      </main>
      <StatusBar />
    </div>
  )
}

// Smoke: monta um layout de exemplo (splits + rotina + historico) e pede o screenshot.
async function runSmoke(): Promise<void> {
  openTerminal(undefined, { initialCommand: "Write-Host 'terminal 1' -ForegroundColor Yellow; $PSVersionTable.PSVersion.ToString()" })
  openTerminal('right', { initialCommand: 'claude --version' })
  openTerminal('below', { initialCommand: 'Get-Date' })
  await initStore()
  await new Promise((r) => setTimeout(r, 800))
  const routines = await window.turno.routines.list()
  const api = dockApi()!
  const first = api.panels[0]
  first.api.setActive()
  if (routines[0]) openRoutine(routines[0].id, routines[0].config.name)
  else openAdhoc()
  api.getPanel(first.id)?.api.setActive()
  openHistory()
  if (window.turno.smoke.theme) {
    await updateSettings({ theme: window.turno.smoke.theme })
    openSettings()
  }
  if (window.turno.smoke.edit) openRoutine(window.turno.smoke.edit, window.turno.smoke.edit, true)
  const target = window.turno.smoke.runRoutine
  if (target) {
    // Roda uma rotina de verdade pelo agendador e espera terminar antes do screenshot.
    const waitDone = (id: string) =>
      new Promise<void>((res) => {
        const off = window.turno.run.onChanged((r) => {
          if (r.id === id && !['running', 'queued'].includes(r.status)) (off(), res())
        })
      })
    if (window.turno.smoke.approve)
      window.turno.run.onEvent((ev) => {
        if (ev.kind === 'permission' && ev.ref) setTimeout(() => void window.turno.run.permission(ev.runId, ev.ref!, 'allow'), 2000)
      })
    const runId = await window.turno.run.startRoutine(target)
    if (runId) {
      openRoutine(target, target)
      await waitDone(runId)
      const followup = window.turno.smoke.followup
      if (followup) {
        await new Promise((r) => setTimeout(r, 1500))
        const next = await window.turno.run.send(runId, followup)
        await waitDone(next.runId)
      }
    }
  }
  await new Promise((r) => setTimeout(r, 3500 + window.turno.smoke.waitSec * 1000))
  window.turno.smoke.done()
}
