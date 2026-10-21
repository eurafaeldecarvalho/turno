import type { Connection } from '../../shared/types'

// Logica pura da aba Conexoes (testavel fora do React).
export type ConnAction =
  | { type: 'add'; conn: Connection }
  | { type: 'update'; id: string; patch: Partial<Connection> }
  | { type: 'remove'; id: string }

export function connectionsReducer(list: Connection[], a: ConnAction): Connection[] {
  switch (a.type) {
    case 'add':
      return [...list, a.conn]
    case 'update':
      return list.map((c) => (c.id === a.id ? { ...c, ...a.patch, id: c.id } : c))
    case 'remove':
      return list.filter((c) => c.id !== a.id)
  }
}

// Retorna a mensagem de erro, ou null se valido.
export function validateConnectionForm(c: Partial<Connection>): string | null {
  if (!c.name?.trim()) return 'Give the connection a name'
  if (c.kind === 'endpoint') {
    if (!c.baseUrl?.trim()) return 'Endpoint needs a base URL'
    if (!/^https?:\/\/[^\s/]+/i.test(c.baseUrl.trim())) return 'Base URL must start with http:// or https:// (e.g. http://localhost:11434)'
    if (!c.model?.trim()) return 'Endpoint needs a model'
  }
  return null
}

export function newConnectionId(list: Connection[], base = 'provider'): string {
  const slug = base.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'provider'
  const used = new Set(list.map((c) => c.id))
  if (!used.has(slug)) return slug
  let i = 2
  while (used.has(`${slug}-${i}`)) i++
  return `${slug}-${i}`
}
