import { useMemo, useState } from 'react'
import catalog from '../../../shared/providerCatalog.json'
import { goToSettings } from '../SettingsModal'

export interface CatalogEntry {
  id: string
  name: string
  kind: 'api-key' | 'free' | 'local'
  style: 'openai' | 'anthropic'
  baseUrl: string
  models?: string[]
  modelsUrl?: string
  free?: boolean
  freeNote?: string
  monthlyFreeTokens?: number
  docsUrl?: string
  authNotes?: string
  needsKey?: boolean
}
interface AgentHint {
  id: string
  name: string
  agent: string
}

export const CATALOG = (catalog as { providers: CatalogEntry[] }).providers
const HINTS = (catalog as { agentHints: AgentHint[] }).agentHints

type Filter = 'all' | 'local' | 'free' | 'anthropic'
const FILTERS: Array<{ v: Filter; t: string }> = [
  { v: 'all', t: 'All' },
  { v: 'local', t: 'On this PC' },
  { v: 'free', t: 'Free tier' },
  { v: 'anthropic', t: 'Anthropic API' },
]

const fmtTokens = (n: number): string => (n >= 1e6 ? `${Math.round(n / 1e6)}M` : `${Math.round(n / 1e3)}k`)

// Catalogo de provedores (derivado do OmniRoute, MIT): escolher um preenche o formulario de conexao.
export function CatalogPicker({ onPick, onClose }: { onPick: (e: CatalogEntry) => void; onClose: () => void }) {
  const [q, setQ] = useState('')
  const [f, setF] = useState<Filter>('all')
  const list = useMemo(() => {
    const t = q.trim().toLowerCase()
    // nome que bate vem primeiro (exato, comeco, meio), depois id, endereco e modelos: Enter pega o que a pessoa quis
    // espacos nao contam ("open router" acha OpenRouter)
    const sq = t.replace(/\s+/g, '')
    const rank = (e: CatalogEntry): number => {
      const n = e.name.toLowerCase()
      // nome e busca sem espaco, ponto e traco, nos dois sentidos ("lmstudio" acha LM Studio, "open router" acha OpenRouter)
      const ns = n.replace(/[\s.-]+/g, '')
      const qs = sq.replace(/[.-]+/g, '')
      if (t && qs && ns.includes(qs) && !n.includes(t)) return ns.startsWith(qs) ? 2 : 3
      if (!t) return 0
      if (n === t || e.id === t) return 1
      if (n.startsWith(t) || e.id.startsWith(t)) return 2
      if (n.includes(t)) return 3
      if (e.id.includes(t)) return 4
      if (e.baseUrl.toLowerCase().includes(t)) return 5
      if ((e.models ?? []).some((m) => m.toLowerCase().includes(t))) return 6
      return 0
    }
    return CATALOG.filter((e) => (f === 'all' ? true : f === 'local' ? e.kind === 'local' : f === 'free' ? e.free : e.style === 'anthropic'))
      .map((e) => ({ e, r: rank(e) }))
      .filter((x) => !t || x.r > 0)
      .sort((a, b) => a.r - b.r)
      .map((x) => x.e)
  }, [q, f])
  const hints = q.trim() ? HINTS.filter((h) => h.name.toLowerCase().includes(q.trim().toLowerCase())) : []
  return (
    <div
      className="catalog"
      data-esc-local
      onKeyDown={(e) => e.key === 'Escape' && (e.stopPropagation(), onClose())}
    >
      <div className="catalog-head">
        <input
          autoFocus
          type="search"
          className="grow"
          placeholder="Search providers or models"
          aria-label="Search providers"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            // Enter escolhe o primeiro resultado; seta para baixo entra na lista
            if (e.key === 'Enter' && list[0]) (e.preventDefault(), onPick(list[0]))
            if (e.key === 'ArrowDown') (e.preventDefault(), document.querySelector<HTMLElement>('.catalog-row')?.focus())
          }}
        />
        <div className="seg small" role="group" aria-label="Filter providers">
          {FILTERS.map((x) => (
            <button key={x.v} className={f === x.v ? 'on' : ''} aria-pressed={f === x.v} onClick={() => setF(x.v)}>{x.t}</button>
          ))}
        </div>
        <button className="btn ghost small" onClick={onClose}>Close</button>
      </div>
      {hints.length > 0 && (
        <p className="muted small catalog-hint">
          {hints.map((h) => h.name).join(', ')}: {hints.length > 1 ? 'these are subscriptions' : 'this is a subscription'} used through the agent's own CLI. Add {hints.length > 1 ? 'them' : 'it'} in{' '}<button className="link" onClick={() => goToSettings('agents')}>Agents & accounts</button>{' '}instead.
        </p>
      )}
      <ul
        className="catalog-list"
        role="list"
        onKeyDown={(e) => {
          // setas andam pela lista; para cima no primeiro volta para a busca
          if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
          const rows = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('.catalog-row'))
          const i = rows.indexOf(document.activeElement as HTMLElement)
          e.preventDefault()
          if (e.key === 'ArrowUp' && i <= 0) return void e.currentTarget.parentElement?.querySelector<HTMLElement>('.catalog-head input')?.focus()
          rows[Math.min(rows.length - 1, Math.max(0, i + (e.key === 'ArrowDown' ? 1 : -1)))]?.focus()
        }}
      >
        {list.map((e) => (
          <li key={e.id}>
            <button className="catalog-row" onClick={() => onPick(e)}>
              <span className="catalog-name">{e.name}</span>
              <span className="catalog-badges">
                {e.kind === 'local' && <span className="pill">On this PC</span>}
                {/* local ja e gratis; "via translator" e o normal: so o que diferencia aparece na lista */}
                {e.free && e.kind !== 'local' && <span className="pill pill-ok" title={e.freeNote}>{e.monthlyFreeTokens ? `~${fmtTokens(e.monthlyFreeTokens)}/mo free` : 'free tier'}</span>}
                {e.style === 'anthropic' && <span className="pill" title="Anthropic API: Claude Code talks to it directly">Anthropic API</span>}
              </span>
              <small className="muted mono catalog-url">{e.baseUrl}</small>
            </button>
          </li>
        ))}
        {!list.length && <li className="muted small catalog-empty">No provider matches.</li>}
      </ul>
      <p className="muted small">Catalog derived from OmniRoute (MIT). Turno only adds providers you sign up for with an API key, free official endpoints and local servers.</p>
    </div>
  )
}
