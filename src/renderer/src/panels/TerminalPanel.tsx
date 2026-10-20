import { useEffect, useRef, useState } from 'react'
import type { IDockviewPanelProps } from 'dockview-react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebglAddon } from '@xterm/addon-webgl'
import { SearchAddon } from '@xterm/addon-search'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { Unicode11Addon } from '@xterm/addon-unicode11'
import { discarded, paramsOf, type TerminalParams } from '../layout'
import { onSettings } from '../appearance'
import { itemExists, patchItem } from '../sidebarStore'
import { killParked, park, setLive, unpark } from '../liveTerms'
import type { TermSession } from '../../../shared/types'
import { themeById } from '../../../shared/themes'

type Cur = { lastCwd?: string; lastSession?: TermSession }
interface Binding {
  itemId(): string | undefined
  onParams(cur: Cur): void
  onFind(): void
}

// Terminal + pty desacoplados do painel: o mesmo terminal pode sair de uma aba e voltar em outra.
interface TermHandle {
  el: HTMLDivElement
  term: Terminal
  search: SearchAddon
  itemId?: string
  alive(): boolean
  bind(b?: Binding): void
  refit(): void
  dispose(): void
}

function createTerm(params: TerminalParams): TermHandle {
  const el = document.createElement('div')
  el.className = 'term-inner'
  const term = new Terminal({ allowProposedApi: true, cursorInactiveStyle: 'outline', drawBoldTextInBrightColors: true })
  let binding: Binding | undefined
  let copyOnSelect = false
  let rightClickPaste = true
  let ptyId: number | undefined
  let disposed = false
  let dead = false
  const fit = new FitAddon()
  term.loadAddon(fit)
  const search = new SearchAddon()
  term.loadAddon(search)
  term.loadAddon(new WebLinksAddon((_e, uri) => window.open(uri, '_blank')))
  term.open(el)

  const h: TermHandle = {
    el,
    term,
    search,
    itemId: params.itemId,
    alive: () => !dead && !disposed,
    bind(b) {
      if (!b && binding) h.itemId = binding.itemId() ?? h.itemId
      binding = b
    },
    refit() {
      if (!el.offsetWidth || !el.offsetHeight) return
      fit.fit()
      if (ptyId) window.turno.pty.resize(ptyId, term.cols, term.rows)
    },
    dispose() {
      if (disposed) return
      disposed = true
      offSettings()
      sel.dispose()
      el.removeEventListener('contextmenu', onContext)
      input.dispose()
      offData()
      offSession()
      offExit()
      if (ptyId) window.turno.pty.kill(ptyId)
      term.dispose()
      el.remove()
    },
  }

  // Pasta atual: o prompt emite OSC 9;9;"<pasta>" (integracao injetada no shell pelo main).
  // Sessao so vale enquanto o Claude roda neste pty: um terminal novo comeca sem nenhuma.
  let cur: Cur = { lastCwd: params.lastCwd }
  const remember = (patch: Cur): void => {
    cur = { ...cur, ...patch }
    binding?.onParams(cur)
    const itemId = binding?.itemId() ?? h.itemId
    if (!itemId) return
    if (patch.lastSession) patchItem(itemId, { agent: 'claude', sessionId: patch.lastSession.sessionId, cwd: patch.lastSession.cwd })
    else if ('lastSession' in patch) patchItem(itemId, { agent: undefined, sessionId: undefined }) // saiu do Claude
    else if (patch.lastCwd) patchItem(itemId, { cwd: patch.lastCwd })
  }
  term.parser.registerOscHandler(9, (data) => {
    if (!data.startsWith('9;')) return false
    const path = data.slice(2).replace(/^"|"$/g, '')
    if (path && path !== cur.lastCwd) remember({ lastCwd: path })
    return true
  })
  const uni = new Unicode11Addon()
  term.loadAddon(uni)
  term.unicode.activeVersion = '11'
  try {
    const webgl = new WebglAddon()
    webgl.onContextLoss(() => webgl.dispose()) // cai para o renderer DOM
    term.loadAddon(webgl)
  } catch {
    /* sem WebGL: renderer DOM */
  }

  const offSettings = onSettings((st) => {
    const t = st.terminal
    term.options.fontFamily = t.fontFamily
    term.options.fontSize = t.fontSize
    term.options.lineHeight = t.lineHeight
    term.options.letterSpacing = t.letterSpacing
    term.options.fontWeight = t.fontWeight
    term.options.cursorStyle = t.cursorStyle
    term.options.cursorBlink = t.cursorBlink
    term.options.scrollback = t.scrollback
    term.options.theme = themeById(st.theme).term
    copyOnSelect = t.copyOnSelect
    rightClickPaste = t.rightClickPaste
    requestAnimationFrame(() => h.refit())
  })
  const sel = term.onSelectionChange(() => {
    if (copyOnSelect && term.hasSelection()) void navigator.clipboard.writeText(term.getSelection())
  })
  // Botao direito: copia se ha selecao, senao cola (como no Windows Terminal).
  const onContext = (e: MouseEvent): void => {
    if (!rightClickPaste) return
    e.preventDefault()
    if (term.hasSelection()) {
      void navigator.clipboard.writeText(term.getSelection())
      term.clearSelection()
    } else void navigator.clipboard.readText().then((t) => t && term.paste(t))
  }
  el.addEventListener('contextmenu', onContext)

  let pending = params.initialCommand
  const offData = window.turno.pty.onData((id, d) => {
    if (id !== ptyId) return
    term.write(d)
    // So manda o comando inicial depois que o shell imprimiu algo (o prompt): antes disso ele se perde.
    if (pending) {
      const cmd = pending
      pending = undefined
      setTimeout(async () => {
        if (/^\s*claude\b/.test(cmd)) await window.turno.routines.prepareClaude(cur.lastCwd ?? params.cwd, /--chrome\b/.test(cmd)).catch(() => {})
        window.turno.pty.write(id, cmd + '\r')
      }, 150)
    }
  })
  const offSession = window.turno.pty.onSession((id, s) => {
    if (id !== ptyId) return
    if (!s) cur.lastSession && remember({ lastSession: undefined })
    else if (s.sessionId !== cur.lastSession?.sessionId) remember({ lastSession: s })
  })
  const offExit = window.turno.pty.onExit((id, code) => {
    if (id !== ptyId) return
    dead = true
    term.write(`\r\n\x1b[90m[process exited: ${code}]\x1b[0m\r\n`)
    if (!binding && h.itemId) killParked(h.itemId) // morreu escondido: some o indicador
  })
  window.turno.pty
    .create({ shell: params.shell, cwd: params.cwd, profile: params.profile, cols: term.cols, rows: term.rows })
    .then((id) => {
      if (disposed) return window.turno.pty.kill(id)
      ptyId = id
    })
  const input = term.onData((d) => ptyId && window.turno.pty.write(ptyId, d))
  term.attachCustomKeyEventHandler((e) => {
    // Shift+Enter: nova linha no prompt do Claude Code interativo (mesmo valor que o Wave envia).
    if (e.type === 'keydown' && e.key === 'Enter' && e.shiftKey && !e.ctrlKey && !e.altKey) {
      if (ptyId) window.turno.pty.write(ptyId, '\x1b\n')
      return false
    }
    if (e.type === 'keydown' && e.ctrlKey && !e.shiftKey && e.code === 'KeyF') {
      binding?.onFind()
      return false
    }
    if (e.type !== 'keydown' || !e.ctrlKey || !e.shiftKey) return true
    if (e.code === 'KeyC' && term.hasSelection()) {
      void navigator.clipboard.writeText(term.getSelection())
      return false
    }
    if (e.code === 'KeyV') {
      void navigator.clipboard.readText().then((t) => t && term.paste(t))
      return false
    }
    return true
  })
  return h
}

export function TerminalPanel({ params, api }: IDockviewPanelProps<TerminalParams>) {
  const host = useRef<HTMLDivElement>(null)
  const handle = useRef<TermHandle | undefined>(undefined)
  const [find, setFind] = useState<string | null>(null)

  useEffect(() => {
    const el = host.current!
    const itemIdNow = (): string | undefined => (api.getParameters?.() as TerminalParams | undefined)?.itemId ?? params.itemId
    // Item escondido: reaproveita o terminal vivo em vez de abrir outro.
    let h = params.itemId ? (unpark(params.itemId) as TermHandle | undefined) : undefined
    if (h && !h.alive()) {
      h.dispose()
      h = undefined
    }
    if (!h) {
      h = createTerm(params)
      if (params.lastSession) api.updateParameters({ ...params, lastSession: undefined })
    }
    handle.current = h
    el.appendChild(h.el)
    h.bind({
      itemId: itemIdNow,
      onParams: (cur) => api.updateParameters({ ...paramsOf({ params, api }), lastCwd: cur.lastCwd, lastSession: cur.lastSession }),
      onFind: () => setFind((f) => f ?? ''),
    })
    if (params.itemId) setLive(params.itemId, 'open')
    requestAnimationFrame(() => {
      h.refit()
      h.term.refresh(0, h.term.rows - 1)
    })

    // Resize com debounce: o ConPTY reimprime a tela a cada resize.
    let t: ReturnType<typeof setTimeout> | undefined
    const ro = new ResizeObserver(() => {
      clearTimeout(t)
      t = setTimeout(() => h.refit(), 80)
    })
    ro.observe(el)
    const focus = api.onDidActiveChange((e) => e.isActive && h.term.focus())
    if (api.isActive) setTimeout(() => h.term.focus(), 50)

    return () => {
      clearTimeout(t)
      ro.disconnect()
      focus.dispose()
      const itemId = itemIdNow()
      h.bind(undefined)
      handle.current = undefined
      const discard = discarded.delete(api.id) // ids chat:<item> se repetem: consome a marca
      if (itemId && itemExists(itemId) && h.alive() && !discard) park(itemId, h)
      else {
        h.dispose()
        if (itemId) setLive(itemId)
      }
    }
  }, [])

  const close = (): void => {
    handle.current?.search.clearDecorations()
    setFind(null)
    handle.current?.term.focus()
  }
  const search = (): SearchAddon | undefined => handle.current?.search
  return (
    <div className="term-wrap">
      <div ref={host} className="term-host" onMouseDown={() => api.setActive()} />
      {find !== null && (
        <div className="term-find">
          <input
            autoFocus
            value={find}
            placeholder="Search terminal"
            onChange={(e) => {
              setFind(e.target.value)
              search()?.findNext(e.target.value, { incremental: true })
            }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') close()
              else if (e.key === 'Enter') e.shiftKey ? search()?.findPrevious(find) : search()?.findNext(find)
            }}
          />
          <button className="icon-btn" title="Previous (Shift+Enter)" onClick={() => search()?.findPrevious(find)}>↑</button>
          <button className="icon-btn" title="Next (Enter)" onClick={() => search()?.findNext(find)}>↓</button>
          <button className="icon-btn" title="Close (Esc)" onClick={close}>✕</button>
        </div>
      )}
    </div>
  )
}
