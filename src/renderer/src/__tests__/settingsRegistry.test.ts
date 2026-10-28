import { describe, it, expect } from 'vitest'
import { PAGES, ITEMS, isPage } from '../settingsRegistry'

// Connections e Agents viraram UMA tela so ("Accounts"): a connection continua existindo como registro escondido,
// mas nao ha mais uma pagina de Settings separada. Estes invariantes travam a fusao.
describe('Settings: Connections fundida em Accounts', () => {
  it('nao existe mais a pagina Connections', () => {
    expect((PAGES as Array<{ id: string }>).some((p) => p.id === 'connections')).toBe(false)
    expect(isPage('connections')).toBe(false)
  })

  it('a pagina de contas se chama "Accounts"', () => {
    expect(PAGES.find((p) => p.id === 'agents')?.label).toBe('Accounts')
  })

  it('todo item de busca aponta para uma pagina que existe (nada orfao em connections)', () => {
    const ids = new Set(PAGES.map((p) => p.id))
    for (const it of ITEMS) expect(ids.has(it.page)).toBe(true)
  })

  it('os itens que eram de Connections agora moram em Accounts', () => {
    const provider = ITEMS.find((i) => /from the catalog/i.test(i.label))
    expect(provider?.page).toBe('agents')
  })
})
