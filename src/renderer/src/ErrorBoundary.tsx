import { Component, type ComponentType, type FunctionComponent, type ReactNode } from 'react'

// Erro de renderizacao fica preso onde aconteceu:
// - em volta do app inteiro (ultimo recurso): painel com Reload, avisando que recarregar fecha os terminais;
// - em volta de cada aba do dock e de cada janela (dialogo): so aquela parte mostra o erro, o resto
//   (inclusive os terminais e os agentes rodando neles) continua de pe.
export class ErrorBoundary extends Component<{ children: ReactNode; scope?: 'app' | 'panel' | 'dialog'; label?: string }, { error?: Error }> {
  state: { error?: Error } = {}
  static getDerivedStateFromError(error: Error): { error: Error } {
    return { error }
  }
  componentDidCatch(error: Error): void {
    console.error(`[turno] render error in ${this.props.label ?? this.props.scope ?? 'app'}`, error)
  }
  render(): ReactNode {
    const { error } = this.state
    if (!error) return this.props.children
    const msg = String(error.message).slice(0, 300)
    const retry = (): void => this.setState({ error: undefined })
    if (this.props.scope === 'panel')
      return (
        <div className="crash crash-panel" role="alert">
          <h3>This tab hit an error</h3>
          <p className="muted small">The other tabs and your terminals keep running.</p>
          <pre className="pre">{msg}</pre>
          <div className="row">
            <button className="btn" onClick={retry}>Try again</button>
          </div>
        </div>
      )
    if (this.props.scope === 'dialog')
      return (
        <div className="crash crash-dialog" role="alert">
          <strong>{this.props.label ?? 'This window'} hit an error and was closed.</strong>
          <span className="muted small">{msg}</span>
          <button className="btn small" autoFocus onClick={retry}>Dismiss</button>
        </div>
      )
    return (
      <div className="crash" role="alert">
        <h2>Something went wrong on this screen</h2>
        <p className="muted">Your routines and settings are safe. Reloading the window closes the open terminals and any agent running in them.</p>
        <pre className="pre">{msg}</pre>
        <div className="row">
          <button className="btn primary" autoFocus onClick={() => location.reload()}>Reload window</button>
          <button className="btn ghost" onClick={retry}>Try to continue</button>
        </div>
      </div>
    )
  }
}

// Componente de aba do dock com o proprio limite de erro (identidade estavel: criado uma vez por tipo)
export function guarded<P extends object>(C: ComponentType<P>, label: string): FunctionComponent<P> {
  const G: FunctionComponent<P> = (p) => (
    <ErrorBoundary scope="panel" label={label}>
      <C {...p} />
    </ErrorBoundary>
  )
  G.displayName = `Guarded(${label})`
  return G
}
