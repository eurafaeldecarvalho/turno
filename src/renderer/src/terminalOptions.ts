import type { TerminalSettings } from '../../shared/types'

// Mapeia TerminalSettings -> opcoes visuais do xterm. Puro e testavel; o TerminalPanel so aplica o resultado.
export interface XtermVisualOptions {
  fontFamily: string
  fontSize: number
  lineHeight: number
  letterSpacing: number
  fontWeight: TerminalSettings['fontWeight']
  cursorStyle: TerminalSettings['cursorStyle']
  cursorBlink: boolean
  scrollback: number
  drawBoldTextInBrightColors: boolean
  cursorWidth: number
  minimumContrastRatio: number
}

export function terminalOptions(t: TerminalSettings): XtermVisualOptions {
  return {
    fontFamily: t.fontFamily,
    fontSize: t.fontSize,
    lineHeight: t.lineHeight,
    letterSpacing: t.letterSpacing,
    fontWeight: t.fontWeight,
    cursorStyle: t.cursorStyle,
    cursorBlink: t.cursorBlink,
    scrollback: t.scrollback,
    drawBoldTextInBrightColors: t.drawBoldInBright,
    cursorWidth: t.cursorWidth,
    minimumContrastRatio: t.minimumContrastRatio,
  }
}
