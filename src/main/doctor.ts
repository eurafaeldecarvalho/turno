import { execFile } from 'node:child_process'
import type { Connection, PreflightResult } from '../shared/types'
import { childEnv } from './env'
import { claudeStatus } from './provider-auth'

// Observacoes cruas da checagem; a classificacao e pura (testavel). "Existe na maquina?" so vale p/ provedor local.
export interface PreflightRaw {
  kind: 'claude' | 'endpoint'
  hasBinary?: boolean
  loggedIn?: boolean
  reachable?: boolean
  local?: boolean // endpoint com servidor local (bootCommand)
  authOk?: boolean
}

export function classifyPreflight(raw: PreflightRaw): PreflightResult {
  if (raw.kind === 'claude') {
    if (!raw.hasBinary) return { state: 'missing_binary', message: 'Claude Code is not installed.' }
    if (!raw.loggedIn) return { state: 'not_logged_in', message: 'Claude Code is installed but not signed in.' }
    return { state: 'ok', message: 'Connected.' }
  }
  if (raw.reachable) {
    if (raw.authOk === false) return { state: 'bad_token', message: 'Endpoint reached but the token was rejected.' }
    return { state: 'ok', message: 'Reachable.' }
  }
  if (raw.local) return { state: 'unhealthy', message: 'Local server is not running (it can be started on demand).' }
  return { state: 'endpoint_unreachable', message: 'Endpoint did not respond. Check the base URL and network.' }
}

function hasClaudeBinary(): Promise<boolean> {
  return new Promise((res) => execFile('claude', ['--version'], { env: childEnv(), timeout: 15_000, windowsHide: true }, (err) => res(!err)))
}
async function endpointReachable(url: string): Promise<boolean> {
  try {
    // Qualquer resposta HTTP (inclusive 401/404 na raiz) prova que o servidor esta de pe.
    // So erro de rede/timeout conta como inalcancavel.
    await fetch(url, { signal: AbortSignal.timeout(4000) })
    return true
  } catch {
    return false
  }
}

export async function checkConnection(conn: Connection): Promise<PreflightResult> {
  if (conn.kind === 'claude') {
    const hasBinary = await hasClaudeBinary()
    const loggedIn = hasBinary ? await claudeStatus() : false
    return classifyPreflight({ kind: 'claude', hasBinary, loggedIn })
  }
  const url = conn.healthUrl ?? conn.baseUrl
  const reachable = url ? await endpointReachable(url) : false
  return classifyPreflight({ kind: 'endpoint', reachable, local: !!conn.bootCommand })
}
