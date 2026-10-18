import { createRoot } from 'react-dom/client'
import 'dockview-react/dist/styles/dockview.css'
import '@xterm/xterm/css/xterm.css'
import './styles.css'
import { App } from './App'
import { initSettings } from './appearance'
import { initSidebar } from './sidebarStore'

// Aplica tema/fonte antes do primeiro render para nao piscar.
void Promise.all([initSettings(), initSidebar()]).finally(() => createRoot(document.getElementById('root')!).render(<App />))
