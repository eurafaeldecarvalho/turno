import { useCallback, useEffect, useState, type PointerEvent as RPointerEvent, type ReactElement } from 'react'
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
import { addTerminalItem, openItem, setDragging } from './sidebarStore'
import type { TerminalParams } from './layout'
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
  IconSidebar,
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

function Tab({ api, params }: IDockviewPanelHeaderProps<{ kind?: string; itemId?: string }>) {
  const [title, setTitle] = useState(api.title ?? '')
  const [renaming, setRenaming] = useState(false)
  const [draft, setDraft] = useState(api.title ?? '')
  useEffect(() => api.onDidTitleChange((e) => setTitle(e.title)).dispose, [api])
  const Icon = KIND_ICON[params.kind ?? 'terminal'] ?? IconTerminal

  const commitRename = (d: string): void => {
    const v = d.trim()
    if (v && v !== title) { api.setTitle(v); saveLayout() }
    setRenaming(false)
  }

  return (
    <div className="tab" onAuxClick={(e) => e.button === 1 && api.close()} title={renaming ? undefined : title}>
      <Icon size={13} />
      {renaming ? (
        <input
          className="inline-rename tab-rename"
          autoFocus
          value={draft}
          onFocus={(e) => e.target.select()}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => commitRename(draft)}
          onKeyDown={(e) => {
            e.stopPropagation()
            if (e.key === 'Enter') commitRename(draft)
            else if (e.key === 'Escape') setRenaming(false)
          }}
        />
      ) : (
        <span
          className="tab-title"
          title="Double-click to rename"
          onDoubleClick={(e) => { e.stopPropagation(); setDraft(title); setRenaming(true) }}
        >
          {title}
        </span>
      )}
      <button
        className="tab-close"
        aria-label="Close"
        title={params.itemId ? 'Hide (keeps running; reopen from its folder)' : 'Close'}
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
  const [menu, setMenu] = useState(false)
  useEffect(() => containerApi.onDidMaximizedGroupChange(() => setMax(containerApi.hasMaximizedGroup())).dispose, [containerApi])
  const ref = group.activePanel?.id

  const openNew = (params: import('./layout').TerminalParams) => {
    setMenu(false)
    openTerminal(undefined, params, undefined, ref)
  }

  return (
    <div className="group-actions">
      <div className="new-term-wrap">
        <button title="New terminal" onClick={() => setMenu((v) => !v)}>
          <IconPlus size={14} />
        </button>
        {menu && (
          <>
            <div className="new-term-overlay" onClick={() => setMenu(false)} />
            <div className="new-term-dropdown">
              <button onClick={() => openNew({})}>
                <IconTerminal size={13} /> Terminal
              </button>
              <button onClick={() => openNew({ profile: 'claude-max', initialCommand: 'claude --chrome' })}>
                <IconChat size={13} /> Claude
              </button>
              <button onClick={() => openNew({ profile: 'qwen-local', initialCommand: 'claude --chrome' })}>
                <IconChat size={13} /> Qwen
              </button>
            </div>
          </>
        )}
      </div>
      <button title="Split right (Alt+Shift+=)" onClick={() => openTerminal('right', {}, undefined, ref)}>
        <IconSplitRight size={14} />
      </button>
      <button title="Split down (Alt+Shift+-)" onClick={() => openTerminal('below', {}, undefined, ref)}>
        <IconSplitDown size={14} />
      </button>
      <button
        title={max ? 'Restore (Ctrl+Shift+M)' : 'Maximize (Ctrl+Shift+M)'}
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
      <p className="muted">Agent routines on your PC, with Claude or local Qwen.</p>
      <div className="welcome-actions">
        <button className="btn primary" onClick={() => openRoutine(null, 'New routine')}>
          <IconRoutine /> New routine
        </button>
        <button className="btn" onClick={() => openTerminal()}>
          <IconTerminal /> Terminal
        </button>
        <button className="btn" onClick={() => openHistory()}>
          <IconHistory /> Runs
        </button>
      </div>
      <dl className="shortcuts">
        <dt>Alt+Shift+=</dt><dd>split right</dd>
        <dt>Alt+Shift+-</dt><dd>split down</dd>
        <dt>Ctrl+Shift+T</dt><dd>new terminal</dd>
        <dt>Ctrl+Shift+M</dt><dd>maximize</dd>
        <dt>Ctrl+Shift+W</dt><dd>close panel</dd>
        <dt>Ctrl+,</dt><dd>settings</dd>
        <dt>Ctrl+Shift+H</dt><dd>runs</dd>
        <dt>Shift+Enter</dt><dd>new line in terminal claude</dd>
        <dt>drag tab</dt><dd>drop on another panel to split</dd>
      </dl>
      {routines.length > 0 && <p className="muted small">{routines.length} routine(s) loaded in the sidebar.</p>}
    </div>
  )
}

export function App() {
  const onReady = useCallback((e: DockviewReadyEvent) => {
    setDockApi(e.api)
    // Guarda qual aba esta sendo arrastada: a sidebar aceita terminais soltos numa pasta.
    e.api.onWillDragPanel((ev) => {
      const params = (ev.panel.params ?? {}) as TerminalParams & { kind?: string }
      setDragging(params.kind === 'terminal' ? { id: ev.panel.id, params, title: ev.panel.title ?? 'terminal' } : undefined)
    })
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
    const off = window.turno.ui.onOpenRun((id) => openRun(id, 'Run'))
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

  const side = useSidebarLayout()
  useEffect(() => {
    const onKey = (ev: KeyboardEvent): void => {
      if (ev.ctrlKey && !ev.shiftKey && !ev.altKey && ev.key.toLowerCase() === 'b') {
        ev.preventDefault()
        ev.stopPropagation()
        side.toggle()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [side.toggle])

  return (
    <div className="app" style={{ gridTemplateColumns: side.hidden ? '0 1fr' : `${side.width}px 1fr` }}>
      {side.hidden ? <div /> : <Sidebar />}
      {!side.hidden && (
        <div
          className="sidebar-resizer"
          style={{ left: side.width - 3 }}
          title="Drag to resize · double-click to reset"
          onPointerDown={side.startResize}
          onDoubleClick={side.reset}
        />
      )}
      <main className="main">
        <div className="titlebar drag">
          <button className="sidebar-toggle" title={side.hidden ? 'Show sidebar (Ctrl+B)' : 'Hide sidebar (Ctrl+B)'} aria-label="Toggle sidebar" onClick={side.toggle}>
            <IconSidebar size={15} />
          </button>
        </div>
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

// Largura e visibilidade da barra lateral, lembradas entre sessoes (so conveniencia: falha em silencio).
const SIDE_KEY = 'turno.sidebar.v1'
const SIDE_DEFAULT = 272
const clampW = (w: number): number => Math.min(560, Math.max(190, Math.round(w)))

function useSidebarLayout() {
  const [st, setSt] = useState<{ width: number; hidden: boolean }>(() => {
    try {
      const j = JSON.parse(localStorage.getItem(SIDE_KEY) ?? '{}')
      return { width: clampW(Number(j.width) || SIDE_DEFAULT), hidden: !!j.hidden }
    } catch {
      return { width: SIDE_DEFAULT, hidden: false }
    }
  })
  useEffect(() => {
    try {
      localStorage.setItem(SIDE_KEY, JSON.stringify(st))
    } catch {
      /* storage indisponivel */
    }
  }, [st])
  const toggle = useCallback(() => setSt((s) => ({ ...s, hidden: !s.hidden })), [])
  const reset = useCallback(() => setSt((s) => ({ ...s, width: SIDE_DEFAULT })), [])
  const startResize = useCallback((e: RPointerEvent<HTMLDivElement>) => {
    e.preventDefault()
    const el = e.currentTarget
    el.setPointerCapture(e.pointerId)
    document.body.classList.add('resizing-x')
    const move = (ev: PointerEvent): void => setSt((s) => ({ ...s, width: clampW(ev.clientX) }))
    const up = (): void => {
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
      el.removeEventListener('pointercancel', up)
      document.body.classList.remove('resizing-x')
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
    el.addEventListener('pointercancel', up)
  }, [])
  return { ...st, toggle, reset, startResize }
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
  if (window.turno.smoke.drag) {
    // Mesmo caminho do arrasto: terminal com claude interativo -> solta na 1a pasta.
    openTerminal('right', { initialCommand: 'claude --model haiku' }, 'claude here', undefined, 'smoke-claude')
    await new Promise((r) => setTimeout(r, 25000))
    const panel = api.getPanel('smoke-claude')!
    const sb = await window.turno.sidebar.get()
    const params = panel.params as TerminalParams
    console.log('[smoke] params', JSON.stringify({ lastCwd: params.lastCwd, lastSession: params.lastSession }))
    const itemId = addTerminalItem(sb.folders[0].id, params, panel.title ?? 'terminal')
    panel.api.updateParameters({ ...params, itemId })
    console.log('[smoke] item', itemId)
  }
  if (window.turno.smoke.openItem) {
    const sb = await window.turno.sidebar.get()
    const it = sb.folders.flatMap((f) => f.items).find((x) => x.id === window.turno.smoke.openItem)
    if (it) await openItem(it)
    await new Promise((r) => setTimeout(r, 12000))
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
