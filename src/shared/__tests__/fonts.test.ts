import { describe, it, expect } from 'vitest'
import { parseFcList, filterFonts } from '../fonts'

describe('fontes instaladas no Linux (fc-list : family)', () => {
  it('deveUsarOPrimeiroNomeDaFamiliaSemRepetirEOrdenado', () => {
    const out = 'Noto Sans\nInter Display,Inter Display Thin\nJetBrainsMono Nerd Font,JetBrainsMono NF,JetBrainsMono NF Medium\nNoto Sans\n\n'
    expect(parseFcList(out)).toEqual(['Inter Display', 'JetBrainsMono Nerd Font', 'Noto Sans'])
  })
  it('deveIgnorarFontesOcultasELinhasVazias', () => {
    expect(parseFcList('.LastResort\n  \nUbuntu Mono\n')).toEqual(['Ubuntu Mono'])
  })
})

describe('busca no seletor de fonte', () => {
  const opts = [{ v: '"JetBrains Mono", monospace', l: 'JetBrains Mono' }, { v: '"Ubuntu Mono", monospace', l: 'Ubuntu Mono' }, { v: '"Inter", sans-serif', l: 'Inter' }]
  it('deveFiltrarPeloQueODigitadoContemSemDiferenciarMaiuscula', () => {
    expect(filterFonts(opts, 'mono').map((o) => o.l)).toEqual(['JetBrains Mono', 'Ubuntu Mono'])
    expect(filterFonts(opts, 'JET').map((o) => o.l)).toEqual(['JetBrains Mono'])
  })
  it('deveMostrarTudoComBuscaVazia', () => {
    expect(filterFonts(opts, '  ')).toHaveLength(3)
  })
  it('deveVirComOQueComecaComODigitadoPrimeiro', () => {
    expect(filterFonts(opts, 'in').map((o) => o.l)).toEqual(['Inter', 'JetBrains Mono']) // na lista JetBrains vem antes
  })
})
