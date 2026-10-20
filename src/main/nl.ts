// NL -> comando no terminal: monta o prompt e parseia a resposta. O usuario sempre decide Executar.
export interface NlContext {
  ask: string
  lastCommand?: string
  output?: string
}

export function buildNlPrompt(ctx: NlContext): string {
  const parts = [
    'You are a shell assistant. The user asked:',
    ctx.ask,
    '',
    'Reply with a short explanation and, when a command is appropriate, a single fenced shell block with the command to run.',
    'If no safe command applies, explain why and include no command block.',
  ]
  if (ctx.lastCommand) parts.push('', `Last command: ${ctx.lastCommand}`)
  if (ctx.output) parts.push('', 'Recent terminal output:', ctx.output)
  return parts.join('\n')
}

export interface Suggestion {
  command: string | null
  explanation: string
}

// Extrai o primeiro bloco cercado como comando; o texto fora do bloco e a explicacao.
// Sem bloco -> command null (a UI nao oferece "Execute").
export function parseSuggestion(raw: string): Suggestion {
  const m = raw.match(/```[^\n]*\n([\s\S]*?)```/)
  const command = m ? m[1].trim() || null : null
  const explanation = raw.replace(/```[^\n]*\n[\s\S]*?```/g, '').trim()
  return { command, explanation: explanation || raw.trim() }
}
