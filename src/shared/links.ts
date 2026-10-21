// Esquemas que o Turno abre pelo sistema (http/https, e-mail e protocolos de apps), nunca arquivo local.
// Usado no main (ui:openExternal) e no dialogo de link da sidebar, para validar igual nos dois lados.
export const LINK_RE = /^(https?|mailto|claude|vscode|cursor|chatgpt|slack|notion|obsidian):/i
export const LINK_HINT = 'Use http(s)://, mailto: or an app link (claude:, vscode:, cursor:, chatgpt:, slack:, notion:, obsidian:).'
