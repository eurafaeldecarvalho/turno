import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { contentKey, parseRoutine, saveRoutine } from '../routines'

let root: string
const write = (id: string, body: string): string => {
  const dir = join(root, id)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'ROUTINE.md'), body)
  return dir
}

beforeEach(() => void (root = mkdtempSync(join(tmpdir(), 'turno-routines-'))))
afterEach(() => rmSync(root, { recursive: true, force: true }))

describe('parseRoutine com campo invalido (nao perde o resto do arquivo)', () => {
  it('descarta so o campo com erro e mantem nome, dias e horarios', () => {
    const dir = write('r1', '---\nname: Minha rotina\neffort: ultra\nschedule:\n  days: [mon, wed]\n  times: ["09:15", "18:00"]\n---\n\nfaz algo\n')
    const r = parseRoutine(dir, 'r1')
    expect(r.error).toMatch(/effort/)
    expect(r.config.name).toBe('Minha rotina')
    expect(r.config.schedule.days).toEqual(['mon', 'wed'])
    expect(r.config.schedule.times).toEqual(['09:15', '18:00'])
    expect(r.config.effort).toBe('medium') // so o campo quebrado volta ao padrao
  })

  it('erro num subcampo do schedule preserva os outros subcampos', () => {
    const dir = write('r2', '---\nname: Outra\nschedule:\n  days: [fri]\n  times: ["25:99"]\n---\n\nx\n')
    const r = parseRoutine(dir, 'r2')
    expect(r.error).toMatch(/schedule\.times/)
    expect(r.config.name).toBe('Outra')
    expect(r.config.schedule.days).toEqual(['fri'])
  })

  it('um horario invalido na lista nao derruba os validos', () => {
    const dir = write('r4', '---\nname: T\nschedule:\n  days: [mon]\n  times: ["25:99", "07:15"]\n---\n\nx\n')
    const r = parseRoutine(dir, 'r4')
    expect(r.error).toMatch(/schedule\.times/)
    expect(r.config.schedule.times).toEqual(['07:15'])
  })

  it('enabled invalido (ex. "no") deixa a rotina desligada, nunca no padrao true', () => {
    const dir = write('r5', '---\nname: E\nenabled: no\n---\n\nx\n')
    const r = parseRoutine(dir, 'r5')
    expect(r.error).toMatch(/enabled/)
    expect(r.config.enabled).toBe(false)
  })

  it('timeout acima de 7 dias e recusado', () => {
    const dir = write('r6', '---\nname: T\ntimeout_min: 999999\n---\n\nx\n')
    const r = parseRoutine(dir, 'r6')
    expect(r.error).toMatch(/timeout_min/)
    expect(r.config.timeout_min).toBe(60)
  })

  it('cron e fuso invalidos viram erro com a mensagem real', () => {
    const dir = write('r3', '---\nname: C\ntimezone: Mars/Olympus\nschedule:\n  cron: "99 99 * * *"\n---\n\nx\n')
    const r = parseRoutine(dir, 'r3')
    expect(r.error).toMatch(/invalid cron: /)
    expect(r.error).toMatch(/time zone/)
    expect(r.config.name).toBe('C')
  })
})

describe('saveRoutine nao sobrescreve edicao externa (compare-and-swap pelo conteudo)', () => {
  it('recusa salvar se o arquivo mudou no disco depois que o editor leu', () => {
    const dir = write('cas', '---\nname: C\n---\n\nx\n')
    const loaded = parseRoutine(dir, 'cas')
    // outro editor grava por cima (mtime diferente)
    writeFileSync(join(dir, 'ROUTINE.md'), '---\nname: EXT\n---\n\nx\n')
    expect(() => saveRoutine(root, { id: 'cas', originalId: 'cas', config: loaded.config, prompt: 'y', expectContent: contentKey(loaded) })).toThrow(/changed on disk/)
    expect(readFileSync(join(dir, 'ROUTINE.md'), 'utf8')).toContain('EXT')
  })

  it('salva quando o conteudo e o mesmo que o editor leu (mesmo com mtime novo)', () => {
    const dir = write('cas2', '---\nname: C\n---\n\nx\n')
    const loaded = parseRoutine(dir, 'cas2')
    // so o mtime muda (sync/backup/git tocando o arquivo): o conteudo e o mesmo, entao grava
    utimesSync(join(dir, 'ROUTINE.md'), new Date(), new Date(Date.now() + 5000))
    saveRoutine(root, { id: 'cas2', originalId: 'cas2', config: { ...loaded.config, name: 'NOVO' }, prompt: 'y', expectContent: contentKey(loaded) })
    expect(readFileSync(join(dir, 'ROUTINE.md'), 'utf8')).toContain('NOVO')
  })

  it('sem expectContent (rename/toggle) nunca regrava um arquivo com erro', () => {
    const dir = write('bad', '---\nname: B\neffort: [medium\n---\n\nx\n')
    const before = readFileSync(join(dir, 'ROUTINE.md'), 'utf8')
    const loaded = parseRoutine(dir, 'bad')
    expect(() => saveRoutine(root, { id: 'bad', originalId: 'bad', config: { ...loaded.config, name: 'N' }, prompt: 'x' })).toThrow(/has an error/)
    expect(readFileSync(join(dir, 'ROUTINE.md'), 'utf8')).toBe(before)
  })
})

describe('saveRoutine recusa nomes de pasta reservados do Windows', () => {
  it('con / nul / com1 nao viram pasta (nao dariam para apagar depois)', () => {
    for (const id of ['con', 'nul', 'com1', 'lpt9']) {
      const loaded = parseRoutine(write('tmp-' + id, '---\nname: R\n---\n\nx\n'), 'tmp-' + id)
      expect(() => saveRoutine(root, { id, config: loaded.config, prompt: 'x' })).toThrow(/reserved by Windows/)
    }
  })
})
