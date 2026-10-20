import { describe, it, expect } from 'vitest'
import { terminalOptions } from '../terminalOptions'
import type { TerminalSettings } from '../../../shared/types'

const base: TerminalSettings = {
  fontFamily: 'Consolas', fontSize: 13, lineHeight: 1.2, letterSpacing: 0, fontWeight: 'normal',
  cursorStyle: 'block', cursorBlink: true, scrollback: 10000, copyOnSelect: true, rightClickPaste: true,
  defaultShell: 'pwsh.exe', drawBoldInBright: true, cursorWidth: 1, minimumContrastRatio: 1, padding: 8,
  ligatures: false, windowOpacity: 1,
}

describe('terminalOptions', () => {
  it('mapeia os campos visuais do TerminalSettings', () => {
    const o = terminalOptions(base)
    expect(o.fontSize).toBe(13)
    expect(o.scrollback).toBe(10000)
    expect(o.drawBoldTextInBrightColors).toBe(true)
    expect(o.cursorWidth).toBe(1)
    expect(o.minimumContrastRatio).toBe(1)
  })
  it('reflete drawBoldInBright desligado', () => {
    expect(terminalOptions({ ...base, drawBoldInBright: false }).drawBoldTextInBrightColors).toBe(false)
  })
  it('contraste minimo configuravel (acessibilidade)', () => {
    expect(terminalOptions({ ...base, minimumContrastRatio: 4.5 }).minimumContrastRatio).toBe(4.5)
  })
})
