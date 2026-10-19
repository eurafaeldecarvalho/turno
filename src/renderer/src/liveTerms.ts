import { useSyncExternalStore } from 'react'

// Terminais ligados a itens das pastas: fechar a aba so esconde (o processo continua vivo aqui).
export type LiveState = 'open' | 'hidden'
export interface ParkedTerm {
  el: HTMLElement
  alive(): boolean
  dispose(): void
}

const states = new Map<string, LiveState>()
const parked = new Map<string, ParkedTerm>()
let snap: ReadonlyMap<string, LiveState> = new Map()
const subs = new Set<() => void>()

export function setLive(itemId: string, s?: LiveState): void {
  if (states.get(itemId) === s) return
  if (s) states.set(itemId, s)
  else states.delete(itemId)
  snap = new Map(states)
  subs.forEach((f) => f())
}

export const useLive = (): ReadonlyMap<string, LiveState> =>
  useSyncExternalStore(
    (cb) => (subs.add(cb), () => subs.delete(cb)),
    () => snap,
  )

let lot: HTMLDivElement | undefined
function parkingLot(): HTMLDivElement {
  if (!lot) {
    lot = document.createElement('div')
    lot.style.display = 'none'
    document.body.appendChild(lot)
  }
  return lot
}

export function park(itemId: string, t: ParkedTerm): void {
  parkingLot().appendChild(t.el)
  parked.set(itemId, t)
  setLive(itemId, 'hidden')
}

export function unpark(itemId: string): ParkedTerm | undefined {
  const t = parked.get(itemId)
  parked.delete(itemId)
  return t
}

export const isParked = (itemId: string): boolean => !!parked.get(itemId)?.alive()

// Encerra o terminal escondido (o item continua na pasta).
export function killParked(itemId: string): void {
  unpark(itemId)?.dispose()
  if (states.get(itemId) === 'hidden') setLive(itemId)
}
