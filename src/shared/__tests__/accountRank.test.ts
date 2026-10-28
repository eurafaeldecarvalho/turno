import { describe, it, expect } from 'vitest'
import { sortAccountsBestToWorst } from '../accountRank'
import type { AgentAccount, AccountUsage } from '../types'

// helper: conta minima
const acc = (id: string, over: Partial<AgentAccount> = {}): AgentAccount =>
  ({ id, agent: 'claude', label: id, enabled: true, home: null, rank: 0, createdAt: '2026-01-01', ...over }) as AgentAccount

const ctx = (usage: Record<string, AccountUsage | undefined> = {}, installed = ['claude'], signedOut: string[] = []) => ({ usage, installed, signedOut })

describe('sortAccountsBestToWorst: ordena contas do melhor para o pior', () => {
  it('assinatura pronta vem antes de conexao de API pronta', () => {
    const a = [acc('api', { connection: 'cohere' }), acc('sub')]
    expect(sortAccountsBestToWorst(a, ctx())).toEqual(['sub', 'api'])
  })

  it('entre assinaturas prontas, a com mais cota sobrando (menos usada) vem primeiro', () => {
    const a = [acc('gasta'), acc('nova')]
    const u = { gasta: { state: 'ok', fiveHour: { pct: 80 } }, nova: { state: 'ok', fiveHour: { pct: 5 } } } as Record<string, AccountUsage>
    expect(sortAccountsBestToWorst(a, ctx(u))).toEqual(['nova', 'gasta'])
  })

  it('conta no limite (exhausted) ou bloqueada vai para o fim, mesmo sendo assinatura', () => {
    const a = [acc('limite'), acc('ok')]
    const u = { limite: { state: 'exhausted' } } as Record<string, AccountUsage>
    expect(sortAccountsBestToWorst(a, ctx(u))).toEqual(['ok', 'limite'])
  })

  it('nao logada e agente nao instalado caem para o fim', () => {
    const a = [acc('deslogada'), acc('semcli', { agent: 'codex' }), acc('boa')]
    expect(sortAccountsBestToWorst(a, ctx({}, ['claude'], ['deslogada']))).toEqual(['boa', 'deslogada', 'semcli'])
  })

  it('empate cai na ordem de rank atual (estavel)', () => {
    const a = [acc('b', { rank: 2 }), acc('a', { rank: 1 })]
    expect(sortAccountsBestToWorst(a, ctx())).toEqual(['a', 'b'])
  })

  it('estado de aviso (warning) fica entre as prontas e as no limite', () => {
    const a = [acc('avisando'), acc('limite'), acc('pronta')]
    const u = { avisando: { state: 'warning', fiveHour: { pct: 92 } }, limite: { state: 'exhausted' } } as Record<string, AccountUsage>
    expect(sortAccountsBestToWorst(a, ctx(u))).toEqual(['pronta', 'avisando', 'limite'])
  })
})
