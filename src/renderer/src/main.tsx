import { createRoot } from 'react-dom/client'
import 'dockview-react/dist/styles/dockview.css'
import '@xterm/xterm/css/xterm.css'
import './styles.css'
import { App } from './App'
import { ErrorBoundary } from './ErrorBoundary'
import { initSettings } from './appearance'
import { initSidebar } from './sidebarStore'
import { initAgents } from './agentStore'
import { watchAccountResets } from './accountSwitch'

// Aplica tema/fonte antes do primeiro render para nao piscar.
void Promise.all([initSettings(), initSidebar(), initAgents().then(watchAccountResets).catch(() => {})]).finally(() => createRoot(document.getElementById('root')!).render(
    <ErrorBoundary>
      <App />
    </ErrorBoundary>,
  ),
)
