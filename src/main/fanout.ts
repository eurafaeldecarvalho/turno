// Fan-out: roda N tarefas em paralelo e coleta os resultados tolerando falha parcial.
// Espera TODAS (Promise.allSettled) e reporta cada uma; 1 falhar NAO derruba as outras. Ordem preservada.
export interface FanOutResult<T> {
  index: number
  value?: T
  error?: string
}

export async function fanOut<T>(tasks: Array<() => Promise<T>>): Promise<Array<FanOutResult<T>>> {
  const settled = await Promise.allSettled(tasks.map((t) => t()))
  return settled.map((s, index) =>
    s.status === 'fulfilled' ? { index, value: s.value } : { index, error: s.reason instanceof Error ? s.reason.message : String(s.reason) },
  )
}
