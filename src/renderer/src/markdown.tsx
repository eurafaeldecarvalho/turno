import { Fragment, type ReactNode } from 'react'

// Markdown minimo para a saida do agente: paragrafos, listas, titulos, **negrito**, *italico*,
// `codigo` e blocos ```. Gera elementos React (nunca innerHTML), entao texto do agente nao vira HTML.

// Link abre no navegador do sistema (nunca navega a janela do app).
function ExtLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} className="md-link" onClick={(e) => (e.preventDefault(), void window.turno.ui.openExternal(href).catch(() => {}))}>
      {children}
    </a>
  )
}

function inline(text: string, key = ''): ReactNode[] {
  const out: ReactNode[] = []
  // ordem importa: codigo primeiro (o que esta dentro de `...` nao e formatado)
  const re = /(`[^`\n]+`)|(\*\*[^*\n]+\*\*)|(__[^_\n]+__)|(\*[^*\s][^*\n]*\*)|(\[[^\]\n]+\]\(https?:\/\/[^)\s]+\))|(https?:\/\/[^\s<>()`*]+[^\s<>()`*.,;:!?'"])/g
  let last = 0
  let m: RegExpExecArray | null
  let i = 0
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index))
    const tok = m[0]
    const k = `${key}-${i++}`
    if (m[1]) out.push(<code key={k}>{tok.slice(1, -1)}</code>)
    else if (m[5]) {
      const [, label, href] = /^\[([^\]]+)\]\((.+)\)$/.exec(tok)!
      out.push(<ExtLink key={k} href={href}>{label}</ExtLink>)
    } else if (m[6]) out.push(<ExtLink key={k} href={tok}>{tok}</ExtLink>)
    else if (m[2] || m[3]) out.push(<strong key={k}>{inline(tok.slice(2, -2), k)}</strong>)
    else out.push(<em key={k}>{inline(tok.slice(1, -1), k)}</em>)
    last = m.index + tok.length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

type Item = { text: string; indent: number; ordered: boolean }
type Block =
  | { t: 'p'; lines: string[] }
  | { t: 'h'; level: number; text: string }
  | { t: 'list'; items: Item[] }
  | { t: 'code'; text: string }

function parse(src: string): Block[] {
  const blocks: Block[] = []
  const lines = src.replace(/\r\n?/g, '\n').split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (/^\s*```/.test(line)) {
      const body: string[] = []
      while (++i < lines.length && !/^\s*```/.test(lines[i])) body.push(lines[i])
      blocks.push({ t: 'code', text: body.join('\n') })
      continue
    }
    if (!line.trim()) continue
    const h = /^(#{1,4})\s+(.*)$/.exec(line)
    if (h) {
      blocks.push({ t: 'h', level: h[1].length, text: h[2] })
      continue
    }
    const li = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(line)
    if (li) {
      const item: Item = { indent: li[1].replace(/\t/g, '  ').length, ordered: /\d/.test(li[2]), text: li[3] }
      const prev = blocks[blocks.length - 1]
      if (prev?.t === 'list') prev.items.push(item)
      else blocks.push({ t: 'list', items: [item] })
      continue
    }
    const prev = blocks[blocks.length - 1]
    // linha de continuacao: junta no paragrafo (ou no ultimo item da lista) anterior
    if (prev?.t === 'p' && lines[i - 1]?.trim()) prev.lines.push(line)
    // continuacao colada (sem linha em branco) segue no item; depois de linha em branco vira paragrafo proprio
    else if (prev?.t === 'list' && lines[i - 1]?.trim() && /^\s{2,}\S/.test(line)) prev.items[prev.items.length - 1].text += '\n' + line.trim()
    else blocks.push({ t: 'p', lines: [line] })
  }
  return blocks
}

// Itens com recuo maior viram sublista do item anterior.
function List({ items, k }: { items: Item[]; k: string }) {
  const base = items[0].indent
  const L = items[0].ordered ? 'ol' : 'ul'
  const out: { item: Item; kids: Item[] }[] = []
  for (const it of items) {
    if (it.indent > base && out.length) out[out.length - 1].kids.push(it)
    else out.push({ item: it, kids: [] })
  }
  return (
    <L>
      {out.map(({ item, kids }, j) => (
        <li key={j}>
          {item.text.split('\n').map((l, n) => (
            <Fragment key={n}>
              {n > 0 && <br />}
              {inline(l, `${k}.${j}.${n}`)}
            </Fragment>
          ))}
          {kids.length > 0 && <List items={kids} k={`${k}.${j}`} />}
        </li>
      ))}
    </L>
  )
}

export function Markdown({ text, className }: { text: string; className?: string }) {
  return (
    <div className={`md ${className ?? ''}`}>
      {parse(text).map((b, i) => {
        const k = String(i)
        switch (b.t) {
          case 'code':
            return <pre key={k} className="pre">{b.text}</pre>
          case 'h':
            return <p key={k} className={`md-h md-h${b.level}`}>{inline(b.text, k)}</p>
          case 'list':
            return <List key={k} items={b.items} k={k} />
          default:
            return (
              <p key={k}>
                {b.lines.map((l, j) => (
                  <Fragment key={j}>
                    {j > 0 && <br />}
                    {inline(l, `${k}.${j}`)}
                  </Fragment>
                ))}
              </p>
            )
        }
      })}
    </div>
  )
}
