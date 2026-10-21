import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readJson, reportBadShape, takeNotices, writeJsonAtomic } from '../jsonStore'

let dir: string
beforeEach(() => void (dir = mkdtempSync(join(tmpdir(), 'turno-json-'))))
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('readJson / writeJsonAtomic (arquivos de dados nunca perdidos calados)', () => {
  it('arquivo que nao existe: ok, sem dados, sem aviso', () => {
    expect(readJson(join(dir, 'a.json'))).toEqual({ ok: true, data: undefined })
    expect(takeNotices()).toEqual([])
  })

  it('JSON quebrado: guarda uma copia so (mesmo lendo de novo) e avisa', () => {
    const p = join(dir, 'settings.json')
    writeFileSync(p, '{"theme": "x"')
    expect(readJson(p)).toEqual({ ok: true, data: undefined })
    expect(readJson(p).ok).toBe(true)
    const copies = readdirSync(dir).filter((f) => f.startsWith('settings.json.unreadable-'))
    expect(copies).toHaveLength(1)
    expect(readFileSync(join(dir, copies[0]), 'utf8')).toBe('{"theme": "x"')
    expect(takeNotices().map((n) => n.message).join(' ')).toMatch(/kept as/)
  })

  it('gravacao atomica deixa o JSON inteiro e sem .tmp sobrando', () => {
    const p = join(dir, 'sidebar.json')
    writeJsonAtomic(p, { folders: [1, 2] })
    expect(JSON.parse(readFileSync(p, 'utf8'))).toEqual({ folders: [1, 2] })
    expect(readdirSync(dir)).toEqual(['sidebar.json'])
  })

  it('gravacao que falha nao deixa .tmp e da motivo curto', () => {
    const p = join(dir, 'x', 'nope.json') // pasta nao existe: falha ao gravar
    expect(() => writeJsonAtomic(p, {})).toThrow(/nope.json couldn't be saved/)
    expect(readdirSync(dir)).toEqual([])
  })

  it('forma errada: copia o arquivo e avisa com o campo', () => {
    const p = join(dir, 'sidebar.json')
    writeFileSync(p, '{"folders": {"a": 1}}')
    expect(reportBadShape(p, ['folders'])).toBe(true)
    expect(readdirSync(dir).some((f) => f.startsWith('sidebar.json.unreadable-'))).toBe(true)
    expect(takeNotices()[0]).toMatchObject({ file: 'sidebar.json', message: expect.stringMatching(/folders/) })
  })
})
