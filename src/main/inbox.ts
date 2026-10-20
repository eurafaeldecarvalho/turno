// Inbox de aprovacao: acumula pedidos de ferramenta (can_use_tool) de todas as runs num so lugar,
// com allowlist (auto-aprova padroes seguros) e resolucao em lote por run. Combate a "dialog fatigue".

export interface PendingItem {
  id: string
  runId: string
  tool: string
  command?: string
  what: string
}

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// Regra "Nome" casa a tool pelo nome; "Nome(padrao)" casa tambem o comando (glob com *).
export function matchAllowlist(tool: string, command: string | undefined, rules: string[]): boolean {
  return rules.some((rule) => {
    const m = rule.match(/^([^(]+)(?:\((.*)\))?$/)
    if (!m) return false
    if (m[1].trim() !== tool) return false
    const pat = m[2]
    if (pat == null) return true
    if (command == null) return false
    const re = new RegExp('^' + pat.trim().split('*').map(escapeRe).join('.*') + '$')
    return re.test(command)
  })
}

export class PendingInbox {
  private items = new Map<string, PendingItem>()

  add(item: PendingItem): void {
    this.items.set(item.id, item)
  }
  get(id: string): PendingItem | undefined {
    return this.items.get(id)
  }
  all(): PendingItem[] {
    return [...this.items.values()]
  }
  byRun(runId: string): PendingItem[] {
    return this.all().filter((i) => i.runId === runId)
  }
  resolve(id: string): PendingItem | undefined {
    const i = this.items.get(id)
    if (i) this.items.delete(id)
    return i
  }
  resolveRun(runId: string): PendingItem[] {
    const got = this.byRun(runId)
    for (const i of got) this.items.delete(i.id)
    return got
  }
}
