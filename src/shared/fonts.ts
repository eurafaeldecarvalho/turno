// Fontes instaladas no Linux/macOS: saida de `fc-list : family` (uma familia por linha; nomes alternativos/localizados
// vem depois de virgulas, ex. "JetBrainsMono Nerd Font,JetBrainsMono NF"). Vale o primeiro nome; ".Nome" e oculta.
export function parseFcList(out: string): string[] {
  const names = out
    .split(/\r?\n/)
    .map((l) => l.split(',')[0].trim())
    .filter((n) => n && !n.startsWith('.'))
  return [...new Set(names)].sort((a, b) => a.localeCompare(b))
}

// Busca do seletor de fonte: contem o digitado (sem diferenciar maiuscula); quem comeca com ele vem primeiro.
export function filterFonts<T extends { l: string }>(opts: T[], q: string): T[] {
  const s = q.trim().toLowerCase()
  if (!s) return opts
  const hits = opts.filter((o) => o.l.toLowerCase().includes(s))
  return [...hits.filter((o) => o.l.toLowerCase().startsWith(s)), ...hits.filter((o) => !o.l.toLowerCase().startsWith(s))]
}
