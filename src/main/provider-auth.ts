import { execFile } from 'node:child_process'
import { childEnv } from './env'

// Auth do Claude Code e do proprio CLI (OAuth no navegador). O Turno nao guarda a senha:
// so dispara o fluxo e le o status. Endpoints usam token no cofre (ver secrets.ts).
export function claudeStatus(): Promise<boolean> {
  return new Promise((res) =>
    execFile('claude', ['auth', 'status'], { env: childEnv(), timeout: 30_000, windowsHide: true }, (err, out) => {
      try {
        res(!err && JSON.parse(out).loggedIn === true)
      } catch {
        res(false)
      }
    }),
  )
}

// Abre o fluxo de login (navegador). Resolve quando o CLI termina; devolve o status real depois.
export function claudeLogin(): Promise<boolean> {
  return new Promise((res) =>
    execFile('claude', ['auth', 'login'], { env: childEnv(), windowsHide: true }, () => void claudeStatus().then(res)),
  )
}

export function claudeLogout(): Promise<void> {
  return new Promise((res) => execFile('claude', ['auth', 'logout'], { env: childEnv(), windowsHide: true }, () => res()))
}
