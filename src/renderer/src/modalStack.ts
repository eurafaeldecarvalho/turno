import { useEffect, useRef, useState, type RefObject } from 'react'
import type React from 'react'

// Pilha unica de modais: so o do topo responde ao Esc, e cada modal novo fica por cima do anterior.
// (Cada host com seu proprio listener fechava todos de uma vez, e o z-index igual deixava o mais novo por baixo.)
// Tambem cuida do foco: ao abrir vai para o modal, o Tab nao sai dele e, ao fechar, volta para quem abriu.
interface Layer {
  close: () => void
  el: () => HTMLElement | null
}
const stack: Layer[] = []
const BASE_Z = 100
let seq = 0 // so cresce: cada modal aberto fica acima de todos os que ja estao na tela
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

function onKey(e: KeyboardEvent): void {
  const top = stack[stack.length - 1]
  if (!top) return
  if (e.key === 'Tab') {
    const root = top.el()
    if (!root) return
    const items = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((x) => x.offsetParent !== null)
    if (!items.length) return void e.preventDefault()
    const first = items[0]
    const last = items[items.length - 1]
    const active = document.activeElement
    const inside = !!active && root.contains(active)
    if (!inside || active === root || (e.shiftKey && active === first) || (!e.shiftKey && active === last)) {
      e.preventDefault()
      ;(e.shiftKey ? last : first).focus()
    }
    return
  }
  if (e.key !== 'Escape') return
  // Menu ou formulario aberto dentro do modal (ex. seletor de tema): o Esc e dele.
  if ((e.target as HTMLElement | null)?.closest?.('[data-esc-local]')) return
  e.preventDefault()
  e.stopImmediatePropagation()
  top.close()
}
window.addEventListener('keydown', onKey, true)
document.addEventListener(
  'focusin',
  (e) => {
    const root = stack[stack.length - 1]?.el()
    const t = e.target as Node | null
    // so dentro do modal do topo (ou de algo flutuando por cima, ex. menu em portal)
    if (!root || !t || root.contains(t) || (t as HTMLElement).closest?.('[role="menu"], [role="listbox"], .modal-backdrop')) return
    root.focus({ preventScroll: true })
  },
  true,
)

// Registra o modal enquanto `open`; devolve o z-index do backdrop. `ref` aponta para a caixa do modal
// (tabIndex={-1} para receber o foco inicial). `key` muda quando o modal troca de conteudo (ex. Runs -> run):
// ele volta para o topo da pilha, por cima de quem tiver aberto no meio tempo.
// Primeiro modal abriu / ultimo fechou: a barra de titulo para de arrastar a janela e a opacidade da janela
// (Settings > Window opacity, so para a tela principal) fica em 100% enquanto houver modal.
function modalsChanged(open: boolean): void {
  document.body.classList.toggle('modal-open', open)
  void window.turno.ui.setModalOpen?.(open)
}

// Arrastar o modal pela faixa de cima (titulo/cabecalho), sem pegar botoes e campos.
const DRAG_ZONE = 48
const INTERACTIVE = 'button, input, select, textarea, a, label, [role="combobox"], [role="button"], [contenteditable="true"], .inline-rename'
function makeDraggable(box: HTMLElement): () => void {
  let dx = 0
  let dy = 0
  const apply = (): void => void (box.style.translate = dx || dy ? `${dx}px ${dy}px` : '')
  const inZone = (e: PointerEvent): boolean => {
    const t = e.target as HTMLElement
    if (t.closest(INTERACTIVE) || t.closest('.modal') !== box) return false
    return e.clientY - box.getBoundingClientRect().top <= DRAG_ZONE
  }
  const onMove = (e: PointerEvent): void => void box.classList.toggle('modal-drag-zone', inZone(e))
  const onDown = (e: PointerEvent): void => {
    if (e.button !== 0 || !inZone(e)) return
    e.preventDefault()
    const bx = dx
    const by = dy
    const start = box.getBoundingClientRect()
    const area = (box.parentElement ?? document.body).getBoundingClientRect()
    box.classList.add('dragging')
    const move = (m: PointerEvent): void => {
      // o topo do modal (onde se segura) nunca sai da area: sempre da para trazer de volta
      const l = Math.min(Math.max(start.left + m.clientX - e.clientX, area.left - start.width + 80), area.right - 80)
      const t = Math.min(Math.max(start.top + m.clientY - e.clientY, area.top), area.bottom - DRAG_ZONE)
      dx = bx + l - start.left
      dy = by + t - start.top
      apply()
    }
    const up = (): void => {
      box.classList.remove('dragging')
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }
  // janela diminuiu (resize, restaurar de maximizada): traz o modal arrastado de volta para a area alcancavel
  const onResize = (): void => {
    if (!dx && !dy) return
    const r = box.getBoundingClientRect()
    const area = (box.parentElement ?? document.body).getBoundingClientRect()
    const l = Math.min(Math.max(r.left, area.left - r.width + 80), area.right - 80)
    const t = Math.min(Math.max(r.top, area.top), area.bottom - DRAG_ZONE)
    dx += l - r.left
    dy += t - r.top
    apply()
  }
  box.addEventListener('pointerdown', onDown)
  box.addEventListener('pointermove', onMove)
  window.addEventListener('resize', onResize)
  return () => {
    box.removeEventListener('pointerdown', onDown)
    box.removeEventListener('pointermove', onMove)
    window.removeEventListener('resize', onResize)
    box.style.translate = ''
  }
}

export function useModalLayer(open: boolean, close: () => void, ref?: RefObject<HTMLElement | null>, key?: string): number {
  const closeRef = useRef(close)
  closeRef.current = close
  // Quem abriu e capturado ja na renderizacao: autoFocus/efeitos dos filhos movem o foco antes deste efeito.
  const opener = useRef<HTMLElement | null>(null)
  const reopener = useRef<HTMLElement | null>(null) // quem trocou o conteudo deste modal ja aberto, de fora dele
  const openedFor = useRef<string | null>(null)
  const id = open ? `open:${key ?? ''}` : null
  if (id !== openedFor.current) {
    const a = document.activeElement
    const outside = a instanceof HTMLElement && a !== document.body && !ref?.current?.contains(a) ? a : null
    if (id && !openedFor.current) opener.current = outside
    else if (id && outside) reopener.current = outside
    openedFor.current = id
  }
  const [z, setZ] = useState(BASE_Z)
  useEffect(() => {
    if (!open) return
    const layer: Layer = { close: () => closeRef.current(), el: () => ref?.current ?? null }
    stack.push(layer)
    if (stack.length === 1) modalsChanged(true)
    window.getSelection()?.removeAllRanges() // selecao de outra tela nao aparece pintada dentro do modal novo
    setZ(BASE_Z + ++seq)
    // Foco no proprio modal (nao num campo: Enter num composer enviaria sem querer), salvo se algo dentro ja pegou.
    const raf = requestAnimationFrame(() => {
      const root = ref?.current
      if (root && !root.contains(document.activeElement)) root.focus({ preventScroll: true })
    })
    return () => {
      cancelAnimationFrame(raf)
      const i = stack.indexOf(layer)
      if (i >= 0) stack.splice(i, 1)
      if (!stack.length) modalsChanged(false)
    }
  }, [open, key])
  // modal aberto pode ser arrastado pelo topo; ao reabrir volta ao centro
  useEffect(() => {
    const box = ref?.current
    if (!open || !box) return
    return makeDraggable(box)
  }, [open])
  // Fechou de vez: devolve o foco a quem abriu.
  useEffect(() => {
    if (open) return
    const re = reopener.current
    const o = re?.isConnected ? re : opener.current
    opener.current = reopener.current = null
    focusOpener(o)
  }, [open])
  useEffect(
    () => () => {
      const o = opener.current
      requestAnimationFrame(() => focusOpener(o))
    },
    [],
  )
  return z
}

// Quem abriu pode ter sido recriado (ex. renomear a pasta da rotina recria o botao): procura pela mesma chave.
function focusOpener(o: HTMLElement | null, tries = 6, fallback?: Element | null): void {
  if (!o) return
  const top = stack[stack.length - 1]?.el()
  if (top && top.contains(document.activeElement)) return // um modal abriu por cima e ja tem o foco
  const key = o.dataset.focusKey
  const el = o.isConnected ? o : key ? document.querySelector<HTMLElement>(`[data-focus-key="${CSS.escape(key)}"]`) : null
  if (el) {
    el.focus({ preventScroll: true })
    // a linha pode ser recriada logo em seguida (pasta renomeada = chave nova): confere e recupera pela chave
    if (key) for (const ms of [200, 600, 1500]) setTimeout(() => {
      if (document.activeElement && document.activeElement !== document.body) return
      document.querySelector<HTMLElement>(`[data-focus-key="${CSS.escape(key)}"]`)?.focus({ preventScroll: true })
    }, ms)
    return
  }
  // a lista ainda vai ser refeita (ex. pasta renomeada salva ao fechar): tenta mais um pouco
  //  enquanto isso o foco ja vai para o painel ativo (nunca fica no <body>); a tentativa so o tira de la se ninguem mexeu
  const idle = !document.activeElement || document.activeElement === document.body || document.activeElement === fallback
  if (key && tries > 0 && idle) {
    if (fallback !== undefined) return void setTimeout(() => focusOpener(o, tries - 1, fallback), 150)
    focusFallback()
    return void requestAnimationFrame(() => {
      const f = document.activeElement
      setTimeout(() => focusOpener(o, tries - 1, f), 150)
    })
  }
  if (fallback === undefined) focusFallback()
}

// sem destino: o modal que sobrou por cima, ou o painel ativo do workspace
function focusFallback(): void {
  requestAnimationFrame(() => {
    if (document.activeElement && document.activeElement !== document.body) return
    const top = stack[stack.length - 1]?.el()
    if (top) top.focus({ preventScroll: true })
    else window.dispatchEvent(new Event('turno:focus-active-panel'))
  })
}

// Ha algum modal aberto? Atalhos globais do workspace ficam parados enquanto houver.
export const isModalOpen = (): boolean => stack.length > 0

// Teclado de menus (role=menu): setas, Home/End; foca o primeiro item ao abrir.
export function menuKeyNav(e: KeyboardEvent | React.KeyboardEvent, root: HTMLElement | null): void {
  const btns = Array.from(root?.querySelectorAll<HTMLButtonElement>('[role^="menuitem"]') ?? [])
  if (!btns.length) return
  const i = btns.indexOf(document.activeElement as HTMLButtonElement)
  const go = (n: number): void => (e.preventDefault(), btns[(n + btns.length) % btns.length].focus())
  if (e.key === 'ArrowDown') go(i + 1)
  else if (e.key === 'ArrowUp') go(i < 0 ? btns.length - 1 : i - 1)
  else if (e.key === 'Home') go(0)
  else if (e.key === 'End') go(btns.length - 1)
}
