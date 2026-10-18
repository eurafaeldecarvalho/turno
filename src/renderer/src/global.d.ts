import type { TurnoApi } from '../../shared/types'

declare global {
  interface Window {
    turno: TurnoApi
  }
}
export {}
