import { app, safeStorage } from 'electron'
import { join } from 'node:path'
import { readFileSync, writeFileSync } from 'node:fs'

// Cofre de segredos de provedor (tokens/API keys). Cifrado pelo SO via Electron safeStorage
// (keychain/DPAPI/libsecret). NUNCA guarda valor em texto puro no settings.json.
// Mapa key -> base64 do buffer cifrado, em userData/secrets.json.
const file = (): string => join(app.getPath('userData'), 'secrets.json')

type Store = Record<string, string>

function load(): Store {
  try {
    return JSON.parse(readFileSync(file(), 'utf8'))
  } catch {
    return {}
  }
}

function save(s: Store): void {
  writeFileSync(file(), JSON.stringify(s), { mode: 0o600 }) // so o dono le
}

export function setSecret(key: string, value: string): void {
  if (!safeStorage.isEncryptionAvailable())
    throw new Error('OS secret storage unavailable: refusing to store the secret unencrypted')
  const s = load()
  s[key] = safeStorage.encryptString(value).toString('base64')
  save(s)
}

export function getSecret(key: string): string | null {
  const b64 = load()[key]
  if (!b64) return null
  try {
    return safeStorage.decryptString(Buffer.from(b64, 'base64'))
  } catch {
    return null
  }
}

export function hasSecret(key: string): boolean {
  return !!load()[key]
}

export function deleteSecret(key: string): void {
  const s = load()
  if (key in s) {
    delete s[key]
    save(s)
  }
}

// Token efetivo de uma connection: do cofre (tokenRef) quando houver, senao o inline (ex. 'ollama').
export function connectionToken(conn: { tokenRef?: string; token?: string }): string | undefined {
  if (conn.tokenRef) return getSecret(conn.tokenRef) ?? undefined
  return conn.token
}
