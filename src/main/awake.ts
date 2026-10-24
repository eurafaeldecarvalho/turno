import { powerMonitor, powerSaveBlocker } from 'electron'
import type { AwakeMode, AwakeStatus } from '../shared/types'

// "Manter o computador acordado":
//   on    = sempre acordado
//   auto  = acordado so enquanto ha agente trabalhando (rotina, execucao avulsa)
//   off   = segue a energia normal do Windows
// Usa prevent-display-sleep (impede suspensao do sistema e da tela).
let mode: AwakeMode = 'auto'
let working = 0
let blockerId: number | undefined
let last: AwakeStatus | undefined
let publish: (s: AwakeStatus) => void = () => {}

function apply(): void {
  const active = mode === 'on' || (mode === 'auto' && working > 0)
  if (active && (blockerId === undefined || !powerSaveBlocker.isStarted(blockerId))) {
    blockerId = powerSaveBlocker.start('prevent-display-sleep')
  } else if (!active && blockerId !== undefined) {
    if (powerSaveBlocker.isStarted(blockerId)) powerSaveBlocker.stop(blockerId)
    blockerId = undefined
  }
  const status: AwakeStatus = { mode, active, working }
  if (last?.mode !== status.mode || last.active !== status.active || last.working !== status.working) {
    last = status
    publish(status)
  }
}

export function initAwake(initial: AwakeMode, onStatus: (s: AwakeStatus) => void): void {
  mode = initial
  publish = onStatus
  // Depois de acordar, o Windows pode ter descartado o pedido: reaplica.
  powerMonitor.on('resume', () => {
    blockerId = undefined
    apply()
  })
  apply()
}

export function setAwakeMode(m: AwakeMode): void {
  mode = m
  apply()
}

export function setWorkingCount(n: number): void {
  working = n
  apply()
}

export function awakeStatus(): AwakeStatus {
  return { mode, active: mode === 'on' || (mode === 'auto' && working > 0), working }
}
