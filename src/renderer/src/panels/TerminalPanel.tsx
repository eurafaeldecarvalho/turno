import { useEffect, useRef, useState } from 'react'
import type { IDockviewPanelProps } from 'dockview-react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebglAddon } from '@xterm/addon-webgl'
import { SearchAddon } from '@xterm/addon-search'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { Unicode11Addon } from '@xterm/addon-unicode11'
import type { TerminalParams } from '../layout'
import { onSettings } from '../appearance'
import { patchItem } from '../sidebarStore'
import type { TermSession } from '../../../shared/types'
import { themeById } from '../../../shared/themes'

export function TerminalPanel({ params, api }: IDockviewPanelProps<TerminalParams>) {
  const host = useRef<HTMLDivElement>(null)
  const searchRef = useRef<SearchAddon | undefined>(undefined)
  const termRef = useRef<Terminal | undefined>(undefined)
  const [find, setFind] = useState<string | null>(null)

  useEffect(() => {
    const el = host.current!
    // Opcoes tiradas do Orca: cursor vazado sem foco, negrito em cores brilhantes.
    const term = new Terminal({ allowProposedApi: true, cursorInactiveStyle: 'outline', drawBoldTextInBrightColors: true })
    termRef.current = term
    let copyOnSelect = false
    let rightClickPaste = true
    const fit = new FitAddon()
    term.loadAddon(fit)
    const search = new SearchAddon()
    term.loadAddon(search)
    searchRef.current = search
    term.loadAddon(new WebLinksAddon((_e, uri) => window.open(uri, '_blank'))) // abre no navegador padrao
    term.open(el)
    // Pasta atual: o prompt emite OSC 9;9;"<pasta>" (integracao injetada no shell pelo main).
    let cur: { lastCwd?: string; lastSession?: TermSession } = { lastCwd: params.lastCwd, lastSession: params.lastSession }
    const remember = (patch: typeof cur): void => {
      cur = { ...cur, ...patch }
      api.updateParameters({ ...api.getParameters?.(), ...cur })
      const itemId = (api.getParameters?.() as TerminalParams | undefined)?.itemId ?? params.itemId
      if (!itemId) return
      if (patch.lastSession) patchItem(itemId, { agent: 'claude', sessionId: patch.lastSession.sessionId, cwd: patch.lastSession.cwd })
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
    fit.fit()

    // Fonte, cursor e cores vem das configuracoes e mudam ao vivo.
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
      requestAnimationFrame(() => {
        if (!el.offsetWidth) return
        fit.fit()
        if (ptyId) window.turno.pty.resize(ptyId, term.cols, term.rows)
      })
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

    let ptyId: number | undefined
    let disposed = false
    let pending = params.initialCommand
    const offData = window.turno.pty.onData((id, d) => {
      if (id !== ptyId) return
      term.write(d)
      // So manda o comando inicial depois que o shell imprimiu algo (o prompt): antes disso ele se perde.
      if (pending) {
        const cmd = pending
        pending = undefined
        setTimeout(() => window.turno.pty.write(id, cmd + '\r'), 150)
      }
    })
    const offSession = window.turno.pty.onSession((id, s) => {
      if (id === ptyId && s.sessionId !== cur.lastSession?.sessionId) remember({ lastSession: s })
    })
    const offExit = window.turno.pty.onExit((id, code) => {
      if (id === ptyId) term.write(`\r\n\x1b[90m[process exited: ${code}]\x1b[0m\r\n`)
    })
    window.turno.pty
      .create({ shell: params.shell, cwd: params.cwd, profile: params.profile, cols: term.cols, rows: term.rows })
      .then((id) => {
        if (disposed) return window.turno.pty.kill(id)
        ptyId = id
      })
    const input = term.onData((d) => ptyId && window.turno.pty.write(ptyId, d))
    // Ctrl+Shift+C/V: copiar/colar como no Windows Terminal (Ctrl+C continua indo para o processo).
    term.attachCustomKeyEventHandler((e) => {
      // Shift+Enter: nova linha no prompt do Claude Code interativo (mesmo valor que o Wave envia).
      if (e.type === 'keydown' && e.key === 'Enter' && e.shiftKey && !e.ctrlKey && !e.altKey) {
        if (ptyId) window.turno.pty.write(ptyId, '\x1b\n')
        return false
      }
      if (e.type === 'keydown' && e.ctrlKey && !e.shiftKey && e.code === 'KeyF') {
        setFind((f) => f ?? '')
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

    // Resize com debounce: o ConPTY reimprime a tela a cada resize.
    let t: ReturnType<typeof setTimeout> | undefined
    const ro = new ResizeObserver(() => {
      clearTimeout(t)
      t = setTimeout(() => {
        if (!el.offsetWidth || !el.offsetHeight) return
        fit.fit()
        if (ptyId) window.turno.pty.resize(ptyId, term.cols, term.rows)
      }, 80)
    })
    ro.observe(el)
    const focus = api.onDidActiveChange((e) => e.isActive && term.focus())
    if (api.isActive) setTimeout(() => term.focus(), 50)

    return () => {
      disposed = true
      offSettings()
      sel.dispose()
      el.removeEventListener('contextmenu', onContext)
      clearTimeout(t)
      ro.disconnect()
      focus.dispose()
      input.dispose()
      offData()
      offSession()
      offExit()
      if (ptyId) window.turno.pty.kill(ptyId)
      term.dispose()
    }
  }, [])

  const close = (): void => {
    searchRef.current?.clearDecorations()
    setFind(null)
    termRef.current?.focus()
  }
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
              searchRef.current?.findNext(e.target.value, { incremental: true })
            }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') close()
              else if (e.key === 'Enter') e.shiftKey ? searchRef.current?.findPrevious(find) : searchRef.current?.findNext(find)
            }}
          />
          <button className="icon-btn" title="Previous (Shift+Enter)" onClick={() => searchRef.current?.findPrevious(find)}>↑</button>
          <button className="icon-btn" title="Next (Enter)" onClick={() => searchRef.current?.findNext(find)}>↓</button>
          <button className="icon-btn" title="Close (Esc)" onClick={close}>✕</button>
        </div>
      )}
    </div>
  )
}
