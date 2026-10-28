// Gateways locais de modelo (OmniRoute, Claude Code Router...): um proxy que o Claude Code usa via ANTHROPIC_BASE_URL
// e que roteia para varios provedores. O Turno ja os traz no catalogo; estes campos deixam o Turno INSTALAR e SUBIR o
// gateway em um clique, em vez de so pre-preencher o formulario e deixar os passos manuais no authNotes.

export interface CatalogGateway {
  id: string
  name: string
  install?: string // comando para instalar o gateway (idempotente; ex. npm -g)
  boot?: string // comando para subir o gateway local (ex. "omniroute", "ccr start")
  dashboardUrl?: string // painel web onde o usuario pluga seus provedores/assinaturas no gateway
}

export interface GatewaySetup {
  command: string // roda no terminal: instala (se preciso) e sobe o gateway
  dashboardUrl?: string
}

// Monta o passo "instalar e subir" de um gateway do catalogo. Sem `boot` nao da para auto-iniciar (o usuario sobe na
// mao) => null. Puro e testavel.
export function gatewaySetup(g: CatalogGateway): GatewaySetup | null {
  if (!g.boot) return null
  return { command: g.install ? `${g.install} && ${g.boot}` : g.boot, dashboardUrl: g.dashboardUrl }
}

// Painel web do gateway, para abrir DENTRO do Turno (aba com webview) em vez do navegador do sistema. Sem painel => null.
export function gatewayDashboard(g: CatalogGateway): { url: string; title: string } | null {
  return g.dashboardUrl ? { url: g.dashboardUrl, title: `${g.name} dashboard` } : null
}
