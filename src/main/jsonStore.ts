import { copyFileSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'

// Avisos para o usuario (lidos pelo renderer uma vez, ao abrir). file = qual arquivo (o renderer limpa o aviso quando resolve).
export interface Notice {
  file: string
  message: string
}
const notices: Notice[] = []
const said = new Set<string>()
const notice = (file: string, m: string): void => void (!said.has(m) && (said.add(m), notices.push({ file, message: m })))
export const takeNotices = (): Notice[] => notices.splice(0)

export type ReadResult<T> = { ok: true; data: T | undefined } | { ok: false }

// Le um JSON do app.
// - nao existe: ok, sem dados (primeira vez);
// - JSON quebrado: guarda uma copia (uma por conteudo, nao a cada abertura), avisa e segue com os padroes;
// - nao deu para abrir (em uso por outro programa, sem permissao) ou nao deu para copiar: ok false,
//   quem chamou NAO deve gravar por cima (perderia o arquivo de verdade).
export function readJson<T>(path: string): ReadResult<T> {
  const label = basename(path)
  let text: string
  try {
    text = readFileSync(path, 'utf8')
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return { ok: true, data: undefined }
    notice(label, `${label} couldn't be opened (in use by another program, or no permission). Turno is using defaults for now and won't save over it.`)
    return { ok: false }
  }
  try {
    return { ok: true, data: JSON.parse(text) as T }
  } catch {
    const copy = keepCopy(path, text)
    if (!copy) {
      notice(label, `${label} is damaged and Turno couldn't back it up. Turno is using defaults for now and won't save over it.`)
      return { ok: false }
    }
    notice(label, `${label} was damaged, so Turno started with defaults for it. The old file was kept as ${copy}.`)
    return { ok: true, data: undefined }
  }
}

function keepCopy(path: string, text: string): string | undefined {
  const dir = dirname(path)
  const prefix = `${basename(path)}.unreadable-`
  try {
    for (const f of readdirSync(dir)) if (f.startsWith(prefix) && readFileSync(join(dir, f), 'utf8') === text) return join(dir, f)
    const copy = join(dir, prefix + new Date().toISOString().replace(/[:.]/g, '-'))
    copyFileSync(path, copy)
    return copy
  } catch {
    return undefined
  }
}

// JSON valido mas com campos do tipo errado (ex. "folders": {}): quem le descartou esses campos.
// Guarda uma copia do arquivo como estava e avisa (false = nao deu para copiar: nao gravar por cima).
export function reportBadShape(path: string, fields: string[]): boolean {
  const label = basename(path)
  let text: string
  try {
    text = readFileSync(path, 'utf8')
  } catch {
    return false
  }
  const copy = keepCopy(path, text)
  if (!copy) {
    notice(label, `Some values in ${label} are invalid (${fields.join(', ')}) and Turno couldn't back it up. Turno is using defaults for them and won't save over it.`)
    return false
  }
  notice(label, `Some values in ${label} were invalid (${fields.join(', ')}) and were reset to defaults. The old file was kept as ${copy}.`)
  return true
}

// Grava num temporario e troca: um crash no meio nunca deixa o arquivo pela metade.
// Falhou (arquivo em uso, sem permissao): apaga o temporario e da um motivo curto.
export function writeJsonAtomic(path: string, data: unknown): void {
  const tmp = `${path}.tmp`
  try {
    writeFileSync(tmp, JSON.stringify(data, null, 2))
    renameSync(tmp, path)
  } catch (e) {
    try {
      rmSync(tmp, { force: true })
    } catch {
      /* fica para a proxima */
    }
    const code = (e as NodeJS.ErrnoException).code
    throw new Error(`${basename(path)} couldn't be saved (${code === 'ENOSPC' ? 'the disk is full' : 'in use by another program, or no permission'}); the change was not saved`)
  }
}
