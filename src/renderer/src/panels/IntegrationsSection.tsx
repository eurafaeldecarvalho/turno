import { useSettings } from '../appearance'
import { JiraForm } from './TasksPanel'
import { openTasks } from '../layout'
import { closeSettingsModal } from '../SettingsModal'

// Settings › Integrations: de onde vem a lista de Tasks (GitHub pelo gh, Jira Cloud com token)
export function IntegrationsSection() {
  const s = useSettings()
  const jira = s?.integrations?.jira
  const repoMap = Object.entries(s?.integrations?.repoMap ?? {})
  return (
    <>
      <section className="card" id="settings-github">
        <h3>GitHub</h3>
        <p className="muted small">
          Issues assigned to you come from the GitHub CLI (<code>gh</code>) already signed in on this PC. If Tasks shows no GitHub issues, run <code>gh auth login</code> in a terminal.
        </p>
      </section>
      <section className="card" id="settings-jira">
        <h3>Jira Cloud</h3>
        <p className="muted small">{jira ? `Connected to ${jira.baseUrl} as ${jira.email}.` : 'Not connected.'}</p>
        <JiraForm embedded connected={!!jira} initial={jira} onDone={() => {}} />
      </section>
      <section className="card" id="settings-repomap">
        <h3>Project folders</h3>
        <p className="muted small">Turno remembers which folder each project's tasks start in. It fills this list when you start a task.</p>
        {repoMap.length ? (
          <ul className="plain-list">
            {repoMap.map(([project, folder]) => (
              <li key={project}>
                <strong>{project}</strong> <span className="muted mono small">{folder}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted small">None yet.</p>
        )}
        <div>
          <button className="btn ghost" onClick={() => (closeSettingsModal(), openTasks())}>Open Tasks</button>
        </div>
      </section>
    </>
  )
}
