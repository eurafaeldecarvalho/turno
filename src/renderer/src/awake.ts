import type { AwakeMode } from '../../shared/types'

// Opcoes de "Keep the computer awake": uma lista so para Settings, barra de status, paleta e tour.
export const AWAKE_MODES: Array<{ v: AwakeMode; t: string; d: string }> = [
  { v: 'on', t: 'Always', d: 'Keeps the computer awake all the time' },
  { v: 'auto', t: 'While an agent works', d: 'Stays awake while an agent or a routine is working (recommended)' },
  { v: 'off', t: 'Off', d: 'Follows the normal Windows power mode; routines may be missed while the computer sleeps' },
]
