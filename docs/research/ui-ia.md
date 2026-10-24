# Turno: information architecture (navigation, menus, settings)

Status: proposal · 2026-10-22 · scope: positions and grouping of buttons, menus and settings (not visual style)

User request: *"improve where buttons, menus and settings sit; Turno now does more than routines, so menus with submenus and different tabs in Settings probably make sense. Research the best way to lay these options out."*

TL;DR

1. **Sidebar** keeps its single-column shape, but its top becomes a short list of **destinations** (Agents, Chats, Tasks, Routines, Runs) plus one **"New" split button** that holds every "create" action (terminal, agent, chat, ad hoc run, fan-out, routine, folder). The current "Workspace" and "Automation" nav blocks, the second "+" menu in each dock group, and the Welcome buttons are all the same commands; they get one home each.
2. **Settings** becomes a two-pane window (left category list + search box + right page), still a modal on the existing `useModalLayer` stack. 9 categories: **General, Appearance, Terminal, Agents & accounts, Connections, MCP servers, Integrations, Notifications, Shortcuts** (plus **About**). Settings that currently live elsewhere (Keep awake in the status bar, Jira inside Tasks, "Start with Windows" in the tray) also get a canonical place in Settings.
3. **Command palette** (`Ctrl+Shift+P`, plus `Ctrl+K` when focus is outside a terminal) lists every action and every Settings page; it is the escape hatch that lets the sidebar stay short.
4. No activity bar for now. With 5 destinations and most work happening in dock tabs, a VS Code-style icon rail would add a second navigation column for little gain. Section 6.6 gives the trigger for adding one later.

---

## 1. Current information architecture (as of v0.8.0)

### 1.1 Shell

```
┌ titlebar (drag, sidebar toggle Ctrl+B, native window controls overlay) ───────────┐
│ Sidebar (resizable 190–560 px)   │ Dockview (tabs, splits, group header actions)   │
│                                  │                                                  │
├──────────────────────────────────┴──────────────────────────────────────────────────┤
│ Status bar                                                                          │
└─────────────────────────────────────────────────────────────────────────────────────┘
Overlays (modalStack): Settings, Runs/Run/Ad hoc/Fan-out (PanelModal), Routine editor,
Onboarding/What's new, Confirm, Folder/Item/Agent-setup dialogs. Tray menu in main.
```

Two kinds of surfaces coexist and the user can't tell them apart from the sidebar: **dock tabs** (Terminal, Agent terminal, Chat, Tasks, Routine session) and **modals** (Runs, Run, Ad hoc, Fan-out, Routine editor, Settings). `restoreLayout()` already closes `run/history/adhoc/fanout/routine` panels from old layouts because they became modals.

### 1.2 Inventory: navigation entry points

| # | Where | Control | Action | Surface | Notes / duplicates |
|---|---|---|---|---|---|
| N1 | Sidebar › Workspace | New terminal | `openTerminal()` | tab | dup: N16, N20, Ctrl+Shift+T |
| N2 | Sidebar › Workspace | **Agent** (split button) main | `openAgent()` best account | tab (terminal) | dup: N17, N21 |
| N3 | Sidebar › Workspace | Agent ▸ chevron menu | Best available · New chat · one item per account grouped by agent · Manage accounts and ranking… (`openSettingsModal('agents')`) | flyout (opens to the right) | the only real "submenu" today; mixes launch + settings |
| N4 | Sidebar › Workspace | Tasks | `openTasks()` | tab (singleton) | also hosts the Jira connect form |
| N5 | Sidebar › Automation | Runs (+ running / failures-24h badges) | `openHistory()` | modal | dup: N22, N24, Ctrl+Shift+H |
| N6 | Sidebar › Automation | Ad hoc run | `openAdhoc()` | modal | a "create" action shown as a destination |
| N7 | Sidebar › Automation | Fan-out | `openFanout()` | modal | same |
| N8 | Sidebar › Routines (collapsible) | header **+** | New routine (`openRoutine(null)` → editor modal) | modal | dup: N20 |
| N9 | Routine row | click / F2 / dbl-click | open session tab / rename | tab | |
| N10 | Routine row hover | ⚙ Configure, ▶ Run now / ■ Stop | editor modal / start / stop | | |
| N11 | Routine row context menu | Open, Configure, Run now/Stop, Enable/Disable, Rename, Open folder, Delete routine | | | |
| N12 | Sidebar › Needs you (auto, only when non-empty) | row | focus agent tab waiting for input/permission/error | | |
| N13 | Sidebar › Open tabs (collapsible) | row / ✕ / drag onto folder / F2 | focus, close, keep as folder item, rename | | duplicates the dock tab strip |
| N14 | Sidebar › Folder (collapsible, user-created, N of them) | header **+**, **⋯** menu, context menu | New chat or link · Rename · Agent setup (MCP, context)… · Move up/down · Delete folder | dialogs | |
| N15 | Folder item | click, ⚙ Edit, ✕ Remove, context menu (Open/Show, Rename, Edit…, Close terminal, Remove from folder) | | | |
| N16 | Sidebar bottom of scroll area | New folder | FolderDialog | dialog | at the end of a long list, easy to miss |
| N17 | Sidebar footer | Settings `Ctrl+,` | `openSettingsModal()` | modal | |
| N18 | Dock group header | **+** menu: Terminal · Agent (best account) · Qwen | | tab | hard-coded Qwen profile; differs from sidebar list |
| N19 | Dock group header | Split right / Split down / Maximize | | | Alt+Shift+= / Alt+Shift+- / Ctrl+Shift+M |
| N20 | Welcome (empty dock) | New routine · Terminal · Agent · Runs + shortcut list | | | text says "Agent routines on your PC" (outdated framing) |
| N21 | Dock tab | dbl-click/F2 rename, middle-click close, ✕ (Hide for folder items) | | | |
| N22 | Status bar | "N running / idle" | `openHistory()` | modal | |
| N23 | Status bar | `x/y routines on`, terminals + memory, cost today/week | read-only | | |
| N24 | Status bar | account usage | `openSettingsModal('agents')` | modal | |
| N25 | Status bar | ☕ Keep awake On/Agent/Off popover | writes `keepAwake` | popover | **a setting that exists only here** (and in tray) |
| N26 | Routine editor header | History · Folder · Run now · Delete / Create routine | | | |
| N27 | Terminal | Ctrl+F find, Ctrl+Shift+A NL→command, Ctrl+Shift+C/V | | inline bars | |
| N28 | Tray (main) | Open Turno · Start with Windows · Keep computer awake ▸ · Open routines folder · Quit | | native menu | |
| N29 | Onboarding | 5 steps: agents · look · routines · background · notifications | | modal | reopened from Settings › General |

Global shortcuts (App.tsx): `Alt+Shift+=` split right, `Alt+Shift+-` split down, `Ctrl+Shift+T` new terminal, `Ctrl+,` settings, `Ctrl+Shift+H` runs, `Ctrl+Shift+W` close panel, `Ctrl+Shift+M` maximize, `Ctrl+B` sidebar (outside xterm, or when hidden). Terminal: `Ctrl+F`, `Ctrl+Shift+A/C/V`, `Shift+Enter`.

### 1.3 Inventory: every setting today

Settings is one scrolling page, two columns (`SettingsPanel.tsx`), no navigation, no search. Deep links scroll by DOM id: `settings-agents`, `settings-mcp`.

| Card (column) | Setting / control | Stored in |
|---|---|---|
| **Appearance** (L) | Color theme (picker with live preview) | `theme` |
| | Interface font | `uiFontFamily` |
| | Interface size 11–16 px | `uiFontSize` |
| **Connections** (L) | list of providers: Claude (Check, Connect/Disconnect, install-in-terminal/copy), endpoints (Name, Type, Base URL, Model, Token; Check/Edit/Remove), + Add provider | `connections`, token in safeStorage |
| **Agents and accounts** (L, `#settings-agents`) | Switch at 5-hour usage %, Switch at weekly usage % | agents store |
| | account list: name (inline edit), usage bars 5h/7d, enabled switch, ↑/↓ ranking, Sign in, Check sign-in, Remove; Add account (agent select) | |
| **MCP servers** (L, `#settings-mcp`) | server list (Edit/Remove), Add from preset (Sentry, Atlassian, Bitbucket, GitHub RO, Playwright, Custom); editor: Name, Transport, URL, Headers / Command, Arguments, Environment, Secret names + values, "Also give it to agent tabs outside a folder" | mcp store |
| **General** (L) | Show the setup tour, What's new | |
| | Start with Windows (tray) | `openAtLogin` |
| | Routines folder (+ Open) | `routinesDir` |
| **Phone notifications (ntfy)** (L) | Server, Topic, Send test notification | `ntfyServer`, `ntfyTopic` |
| **Terminal: font and cursor** (R) | Font, Size, Line height, Letter spacing, Weight, Cursor style, Blink, Padding, Cursor width, Min. contrast, Bold uses bright colors, live sample | `terminal.*` |
| **Terminal: behavior** (R) | Default shell, Scrollback, Copy on select, Right-click copy/paste, Ligatures, Window opacity (slider + %) | `terminal.*` |

Settings that live **outside** Settings:

| Setting | Current home | Problem |
|---|---|---|
| Keep computer awake (On/Agent/Off) | status bar popover, tray | not findable from Settings |
| Jira site/e-mail/token, repo↔folder map (`integrations`) | Tasks panel header ("Connect Jira") and per-task Start form | credentials inside a work view |
| Folder MCP + context card | folder ⋯ › Agent setup… | fine (object-level), but should be linked from MCP page |
| Per-routine settings (General, Connection, Execution, When it runs, Accounts/MCP/context, Permissions, Limits & safety, Prompt) | Routine editor modal | fine: object settings stay with the object |
| Hidden state: `onboardedAt`, `seenVersion`, sidebar width/hidden, collapsed sections, dock layout | localStorage / settings.json | not user-facing |

### 1.4 Problems found

1. **The same "create" actions are scattered over 4 places** (sidebar Workspace/Automation, Routines "+", dock "+" menu, Welcome) with different labels and subsets ("Agent" / "Agent (best account)", "Qwen" only in the dock menu, "New chat" only inside the Agent flyout).
2. **Destinations and actions are mixed.** "Runs" and "Tasks" are places; "New terminal", "Ad hoc run", "Fan-out" are verbs. "Automation" groups a place (Runs) with two one-shot launchers.
3. **Tabs vs modals are invisible.** Runs, Ad hoc and Fan-out open as modals; Tasks and Chat open as tabs; the sidebar shows them identically.
4. **Settings is a long two-column scroll** whose column order isn't a reading order (Appearance first, General fifth, Terminal on the right). Nine cards, ~60 controls, no search; deep links rely on `scrollIntoView`.
5. **Agent/account management is split**: launch in the sidebar flyout, ranking/sign-in in Settings, usage in the status bar, connections (Claude/Ollama endpoints) in a separate card that users confuse with accounts.
6. **Settings outside Settings** (Keep awake, Jira).
7. **"Open tabs" duplicates the tab strip** and pushes folders down; "New folder" sits at the very end of the scroll area.
8. **Welcome copy and buttons still describe a routines-only app.**

---

## 2. Research: how comparable apps organize this

Research done on 2026-10-22 from vendor docs, NN/g and Microsoft guidance. Items I couldn't confirm in a primary source are marked *(unverified)*.

### 2.1 Developer tools

| App | Primary navigation | Settings | Source |
|---|---|---|---|
| **VS Code** | Activity Bar of View Containers opens the Primary Sidebar; Secondary Sidebar; Panel (Terminal, Output…); Status Bar (left = workspace, right = active item). Command Palette at a fixed spot; context menus only for actions tied to a place | Ctrl+, opens a Settings editor: **search box** + category tree ("Commonly Used" first, Extensions last), **User / Workspace** scope tabs, filters `@modified`, `@tag:advanced`…, a bar marking modified values, a per-setting gear (Reset), and an "Edit in settings.json" escape hatch. Extension guideline: don't build your own settings webview. Palette guideline: commands grouped by a category prefix ("Git: …"), shortcuts shown, never override existing ones | [UX overview](https://code.visualstudio.com/api/ux-guidelines/overview), [Activity Bar](https://code.visualstudio.com/api/ux-guidelines/activity-bar), [Command Palette](https://code.visualstudio.com/api/ux-guidelines/command-palette), [Settings](https://code.visualstudio.com/docs/configure/settings), [Settings UX](https://code.visualstudio.com/api/ux-guidelines/settings) |
| **Cursor** | VS Code shell | a separate **Cursor Settings** page (Ctrl+Shift+J, gear, command) with left tabs. Tab names change between releases: 0.45 had General / Models / Features / Beta; 2.x has "Agents" and "Tools & MCP" *(full list unverified)*. MCP is also editable as `.cursor/mcp.json` | [shortcuts](https://cursor.com/docs/reference/keyboard-shortcuts), [MCP](https://cursor.com/docs/context/mcp), [forum](https://forum.cursor.com/t/how-come-my-cursor-ide-doesnt-have-a-mcp-option-under-settings/103944) |
| **Windsurf** | VS Code shell + Cascade panel | Windsurf Settings › Cascade › MCP: list + add + "open raw mcp_config.json"; also an MCP icon inside the Cascade panel | [docs](https://docs.windsurf.com/windsurf/mcp) |
| **Zed** | panels + palette | Ctrl+, opens a **separate Settings window**: categories on the left, controls on the right, keyboard-navigable, **search as the main way in**; layered on settings.json; user and project settings shown in the same editor | [blog](https://zed.dev/blog/settings-ui), [docs](https://zed.dev/docs/visual-customization) |
| **Warp** | tabs + palette | Ctrl+, opens left-nav settings (Appearance, AI, Keybindings, Features, Privacy… *(full list unverified)*) + "Open settings file" | [docs](https://docs.warp.dev/terminal/settings) |
| **Orca** (onorca.dev, `stablyai/orca`) | closest analogue: worktrees, splits, fan-out to several agents, GitHub/Linear tasks, quick open for "worktrees, files, agents and commands", account switcher with usage | panes list from our own code reading (docs/referencias-apps.md): General, Appearance, Git, Terminal, Quick Commands, Agents, Browser, Integrations, Notifications, Shortcuts, … **with global search** | [repo](https://github.com/stablyai/orca), `docs/referencias-apps.md` §1.1 |
| **Claude Desktop** | Chat / Cowork / Code tabs; sidebar with **+ New**, a session list with group/sort, Archived, Customize (connectors, skills, plugins) | Settings › Claude Code, › Connectors, › Extensions, › This computer, Developer (MCP status/logs) | [desktop docs](https://code.claude.com/docs/en/desktop), [MCP article](https://support.claude.com/en/articles/10949351-getting-started-with-local-mcp-servers-on-claude-desktop) |
| **ChatGPT** | sidebar with New chat + history | Settings dialog with left tabs; confirmed Data controls, Personalization, Apps *(others unverified)* | [help](https://help.openai.com/en/articles/7730893-data-controls-in-chatgpt) |
| **Docker Desktop** | left nav: Containers, Images, Volumes, Builds, Kubernetes, Hub, Scout, Extensions; right-click › Customize to reorder/hide | Settings (gear): General, Resources (sub-tabs), Docker Engine, Builders, AI, Kubernetes, Software updates, Extensions, Beta features, Notifications, Advanced | [settings](https://docs.docker.com/desktop/settings-and-maintenance/settings/), [dashboard](https://docs.docker.com/desktop/use-desktop/) |
| **GitHub Desktop** | repo/branch toolbar | Options: Accounts, Integrations, Git, Appearance, Prompts, Advanced, Accessibility | [docs](https://docs.github.com/en/desktop/configuring-and-customizing-github-desktop/configuring-basic-settings-in-github-desktop) |
| **JetBrains IDEs** | tool-window stripes (activity-bar-like) | Settings dialog: **search at top-left** + category tree; an icon marks project-scoped settings; explicit OK/Apply (the outlier) | [docs](https://www.jetbrains.com/help/idea/settings-preferences-dialog.html) |
| **Raycast** | launcher | Settings window: Account, General, Launcher, Shortcuts, Keyboard, Advanced, Organizations, About, AI (sub-panes: models, agents, chat, tools…), Applications, Extensions | [manual](https://manual.raycast.com/settings) |

### 2.2 Collaboration apps and operating systems

| App | Pattern | Source |
|---|---|---|
| **Linear** | Settings left nav in **groups**: Account, Features, Administration, Your teams. Customizable sidebar (reorder, hide into "More", count or dot badges) | [changelog](https://linear.app/changelog/2024-12-18-personalized-sidebar) |
| **Discord** | grouped headers User / Billing / App / Activity settings; users complain the App settings sit too low *(unofficial sources)* | [community post](https://support.discord.com/hc/ru/community/posts/21197140733719-My-UI-issues-Desktop-and-wishlist-to-fix-them) |
| **Slack** | Preferences dialog with left categories (Notifications confirmed) | [help](https://slack.com/help/articles/201355156-Configure-your-notifications) |
| **macOS System Settings** | sidebar grouped by function; search results stay in the sidebar while you open each one | [9to5mac](https://9to5mac.com/2022/06/06/macos-13-ventura-system-settings-first-look/) |
| **Windows 11 Settings** | left list with icon + label: System, Bluetooth & devices, Network & internet, Personalization, Apps, Accounts, … with search on top | [Microsoft](https://support.microsoft.com/en-us/accessibility/windows/understand-and-explore-windows-settings) |

### 2.3 UX guidance

- **Progressive disclosure** (NN/g): show the core options first and advanced ones on request; at most 2 levels; label the path to the secondary options clearly. [nngroup.com/articles/progressive-disclosure](https://www.nngroup.com/articles/progressive-disclosure/)
- **Cascading submenus vs mega menus** (NN/g): cascading dropdowns are error-prone, need precise mouse movement and show one slice of the IA at a time. If a flyout exists, add a hover delay of about 0.5 s, tolerate diagonal movement, and support click and keyboard. [mega menus](https://www.nngroup.com/articles/mega-menus-work-well/), [timing](https://www.nngroup.com/articles/timing-exposing-content/), [menu design](https://www.nngroup.com/articles/menu-design/)
- **Left vertical nav** (NN/g): scales to many items and is easy to scan; don't use icons without labels; put less important items at the bottom; don't duplicate it with a second nav. [vertical-nav](https://www.nngroup.com/articles/vertical-nav/)
- **Tabs** (NN/g): few tabs with 1-2 word labels; not for content users must compare. [tabs-used-right](https://www.nngroup.com/articles/tabs-used-right/)
- **Accelerators** (NN/g): shortcuts are extras for experts; show them next to the command so people learn them. [ui-accelerators](https://www.nngroup.com/articles/ui-accelerators/)
- **Command palettes**: one shortcut on every screen, covers nearly every action, fuzzy search with synonyms, shows shortcuts, restores focus on close ([Superhuman](https://blog.superhuman.com/how-to-build-a-remarkable-command-palette/)). A palette can find things and run actions in the same box ([Retool](https://retool.com/blog/designing-the-command-palette)).
- **Microsoft app settings guidelines**: Settings is the last nav item, pinned at the bottom. Group settings under section headers on a single scrolling page and nest expanders at most one level. Apply changes immediately, keep few settings with smart defaults, disable (and explain) rather than hide, use one-word headers, put About at the bottom, keep workflow commands out of settings. [guidelines](https://learn.microsoft.com/en-us/windows/apps/design/app-settings/guidelines-for-app-settings)
- **NavigationView** (Fluent): left nav for 5-10 categories, group headers and separators, optional search box, footer items above Settings, compact icon-only mode under ~1008 px. [NavigationView](https://learn.microsoft.com/en-us/windows/apps/develop/ui/controls/navigationview)
- **Material 3 navigation rail**: 3-7 top-level destinations. [SAP Fiori M3 rail](https://www.sap.com/design-system/fiori-design-android/v26-4/components/m3-standard-components/navigation-rail/usage). Apple HIG pages didn't load *(unverified)*; the common Mac pattern is Settings… on Cmd+, with panes that apply immediately.

### 2.4 Takeaways applied to Turno

1. Settings are a **separate surface opened with Ctrl+,** and have a gear pinned at the bottom of the nav (every app above). Turno already does this.
2. Settings use **two levels**: a left category list, then one scrolling column of grouped cards. Expanders go at most one level deep (Microsoft, NN/g, Zed, Docker, Raycast).
3. **Group the category list with headers** (Linear, Discord, macOS). Turno's groups: App / AI / Work.
4. **Search at the top of the settings nav** (VS Code, Zed, JetBrains, macOS, Windows, Orca). A "modified" filter and per-setting reset are a cheap bonus.
5. **Config-file escape hatch**: "Open settings.json" in About, and "Open config" next to MCP (VS Code, Zed, Warp, Windsurf, Cursor).
6. **Apply instantly**, as Turno already does (Microsoft, VS Code).
7. **Make scope explicit**: app-wide settings live in Settings; per-routine and per-folder settings stay with their object and get cross-links (VS Code User/Workspace, JetBrains project icon).
8. **Primary nav has only top-level destinations** (5-10, with badges); Settings and Help sit in the footer (NavigationView, Material rail, Docker).
9. **No cascading hover flyouts.** Turno's flyouts open on click, go one level deep, and work with the keyboard (NN/g).
10. **One command palette** with one shortcut, covering actions and content, with category prefixes and shortcut hints (VS Code, Superhuman, Retool, Orca quick open).
11. **"+ New" as the single create entry** at the top of the sidebar (Claude Desktop, ChatGPT, Linear).
12. **Per-run choices stay next to the run**: model, effort and folder belong in the ad hoc, chat and routine forms, not in Settings (Microsoft: workflow commands don't belong in settings; Claude Desktop puts them in the prompt bar).

---

## 3. Design principles adopted for Turno

1. **One home per command, many shortcuts to it.** Every action has one canonical place (sidebar or menu); the palette and keyboard shortcuts are accelerators, not extra homes.
2. **Destinations in the sidebar, verbs behind "New".** The sidebar lists *places that have state* (and badges). Creation verbs collapse into a single "New" split button, exactly like the Agent button already works.
3. **Object settings stay with the object** (routine editor, folder Agent setup); **app settings go in the Settings window**, in a category list. Cross-link the two ("Used by 3 routines", "Manage in Settings › MCP servers").
4. **Shallow hierarchy.** At most one level of flyout (the existing Agent ▸ menu pattern). No cascading submenus inside submenus; NN/g and others document hover-tunnel failures for them.
5. **Search is how power users navigate**: Settings gets a search box and the app gets a command palette indexing the same registry.
6. **Evolution, not rewrite**: reuse `Section`, `Menu`, `ContextMenu`, `menuKeyNav`, `useModalLayer`, `PanelModalHost`, existing CSS tokens.

---

## 4. Proposed sidebar

### 4.1 Structure

```
┌──────────────────────────────┐
│ ▣ Turno                  ⌕   │  brand row; ⌕ opens command palette (Ctrl+Shift+P)
│ ┌──────────────────┬───┐     │
│ │ ＋ New agent      │ ▾ │     │  split button: main = Agent (best account)
│ └──────────────────┴───┘     │  ▾ = "New" menu (see 4.2)
│                              │
│  ◉ Agents            2 ●     │  destinations (always visible, fixed order)
│  ✓ Tasks                     │
│  ⟳ Routines        5/7 on    │  → focuses/expands the Routines group below
│  ◷ Runs           1 ▶  2 ✕  │  → Runs modal (badges: running / failed 24h)
│                              │
├─ NEEDS YOU (2) ──────────────┤  auto, only when non-empty, pinned under nav
│  ● agent 3 · waiting answer  │
│  ● nightly-report · permiss. │
├─ ▾ ROUTINES ──────────── ＋ ─┤  collapsible; + = New routine
│  ● nightly-report  next 02:00│
│  ○ weekly-digest   off       │
├─ ▾ FOLDERS ───────────── ＋ ─┤  NEW: one parent group for user folders
│   ▾ turno           ＋  ⋯    │  + = New chat or link, ⋯ = folder menu
│      ◉ refactor sidebar      │
│      ↗ PR #42                │
│   ▸ guidewire-prep      3    │
├─ ▸ OPEN TABS (6) ────────────┤  collapsed by default; drag source kept
│                              │
├──────────────────────────────┤
│ ⚙ Settings   Ctrl+,    ? ⌨  │  footer: Settings · Help (tour/what's new/shortcuts)
└──────────────────────────────┘
```

Key moves:

| Change | From | To | Why |
|---|---|---|---|
| Primary create | "New terminal" + "Agent" + "Ad hoc run" + "Fan-out" + routine "+" + dock "+" | one **New** split button (main = Agent) | single home for verbs |
| "Agents" destination | (none; Agent button opened a tab) | **Agents** row: opens an *Agents hub* singleton tab (6.2) or, phase 1, the Agent flyout | sessions, accounts and usage in one place; badge = sessions needing you |
| Tasks | Workspace block | destination row | unchanged behavior |
| Runs | Automation block | destination row with the same badges | unchanged behavior |
| Routines | collapsible section | destination row (focus/expand) **and** the section | routines stay one click away |
| Ad hoc run, Fan-out | sidebar rows | **New ▾** menu + palette; also buttons inside the Runs modal header ("New ad hoc run", "New fan-out") | they are verbs whose results live in Runs |
| Folders | N top-level sections + "New folder" at the end | one **Folders** parent group with **+** in its header; folders nested one level | groups user content; New folder always visible |
| Open tabs | expanded section above folders | collapsed by default, at the end | duplicates the tab strip |
| Settings | footer button | footer button + **Help** button (`?`) that opens: Setup tour, What's new, Keyboard shortcuts, Open routines folder, Report a problem | moves help out of Settings › General |

Collapsed/expanded state keeps using `toggleSection(id)` in `sidebarStore`; add ids `folders` and keep `open-tabs` (default collapsed only when there is no saved value).

### 4.2 "New" menu (one flyout level, no nested submenus)

```
┌ New ─────────────────────────────────────┐
│ ◉ Agent (best account)        Ctrl+Shift+N│
│ ◉ Agent with…            ▸               │  ← one flyout: accounts grouped by agent (today's list)
│ ✦ Chat (structured)                       │
│ ▭ Terminal                    Ctrl+Shift+T│
│ ▭ Terminal with profile  ▸               │  ← one flyout: Qwen local, other connections/shells
├──────────────────────────────────────────┤
│ ⟳ Routine…                               │
│ ✦ Ad hoc run…                 Ctrl+Shift+R│
│ ⑂ Fan-out…                               │
├──────────────────────────────────────────┤
│ ▢ Folder…                                │
│ ⚙ Manage agents and accounts…            │  → Settings › Agents & accounts
└──────────────────────────────────────────┘
```

- The **same component** renders the dock-group **+** menu (with "split right/down" placement applied to the tab actions) so both lists are identical. Remove the hard-coded "Qwen" item; it becomes "Terminal with profile ▸ Qwen (local)" generated from `settings.connections`.
- Flyouts follow the existing `AgentButton` positioning (`left: r.right + 6`) and `menuKeyNav`; flyouts open on **click, Enter or ArrowRight** and close on ArrowLeft/Esc. If hover-open is added, give it a delay of about 400 ms and diagonal-move tolerance (NN/g, §2.3). Keep it to one flyout level, with no submenu inside a submenu.
- Welcome screen shows the same four primary verbs (Agent, Terminal, Routine, Ad hoc run) and the shortcut list from the shortcut registry (6.4). Copy changes from "Agent routines on your PC…" to "Agents, terminals and routines on your PC".

### 4.3 Context menus

Keep the existing context menus; normalize their order to **Open → Edit/Configure → state toggles → Rename → Reveal (Open folder) → separator → destructive**. Routines already follow this; folder items swap "Rename" and "Edit…" to match.

### 4.4 Status bar

Keep it as a **status** surface, each segment clickable to its home:

| Segment | Click goes to |
|---|---|
| ● N running / idle | Runs |
| x/y routines on | Sidebar › Routines (expand + focus) |
| N terminals · MB | Open tabs group (expand) |
| $ today · week | Runs (filter: this week) |
| account usage | Settings › Agents & accounts |
| ☕ Keep awake | popover stays (quick toggle) + "Power settings…" link → Settings › General › Background |

---

## 5. Proposed Settings window

### 5.1 Layout

Still `SettingsModalHost` + `useModalLayer`, but `modal-wide` becomes a fixed-size two-pane dialog (about 920×640, shrinks with the window).

```
┌ Settings ───────────────────────────────────────────────────────────────── ✕ ┐
│ ┌──────────────────────┐ ┌───────────────────────────────────────────────────┐│
│ │ ⌕ Search settings    │ │ Terminal                                         ││
│ ├──────────────────────┤ │ How new and open terminals look and behave.      ││
│ │ APP                  │ │                                                   ││
│ │  General             │ │ ┌ Font and cursor ─────────────────────────────┐ ││
│ │  Appearance          │ │ │ Font            [Cascadia Mono       ▾]      │ ││
│ │ ▸Terminal            │ │ │ Size [14]  Line height [1.2]  Spacing [0]    │ ││
│ │  Notifications       │ │ │ …                                            │ ││
│ │  Shortcuts           │ │ │ PS C:\routines> claude -p "…" ▌   (sample)    │ ││
│ │ AI                   │ │ └──────────────────────────────────────────────┘ ││
│ │  Agents & accounts ● │ │ ┌ Behavior ────────────────────────────────────┐ ││
│ │  Connections         │ │ │ Default shell   [PowerShell 7        ▾]      │ ││
│ │  MCP servers       ! │ │ │ Scrollback      [10000]                       │ ││
│ │ WORK                 │ │ │ Copy on select                        (●  )  │ ││
│ │  Integrations        │ │ │ …                                            │ ││
│ │  Routines            │ │ └──────────────────────────────────────────────┘ ││
│ │                      │ │                                                   ││
│ │ ──────────────────── │ │                                       Saved ✓     ││
│ │  About Turno  v0.8.0 │ │                                                   ││
│ └──────────────────────┘ └───────────────────────────────────────────────────┘│
└───────────────────────────────────────────────────────────────────────────────┘
 ● = needs attention (account signed out / over limit)   ! = MCP secret missing
```

Search mode (typing in the box): the left list is replaced by results; each result shows `Category › Card › Setting` and clicking scrolls to and highlights the control (same technique as today's `scrollIntoView`, but on a registry key).

```
│ ⌕ font               ✕│ │ 4 results                                        │
│                        │ │ Appearance › Interface font                      │
│                        │ │ Appearance › Interface size                      │
│                        │ │ Terminal › Font and cursor › Font                │
│                        │ │ Terminal › Behavior › Font ligatures             │
```

### 5.2 Categories and contents (final list)

Group headers in the left list: **App**, **AI**, **Work**. Names are nouns, Title case only on the first word, matching Windows 11/macOS conventions.

| Category (id) | Cards and settings | Source today |
|---|---|---|
| **General** (`general`) | *Startup*: Start with Windows (stays in the tray) · *Background*: Keep computer awake (On / While an agent works / Off) + note about lid/power plan · *Data*: Routines folder (+ Open) — duplicated as a link in Routines | General card; status bar/tray; General card |
| **Appearance** (`appearance`) | *Theme*: Color theme · *Interface*: Interface font, Interface size · *Window*: Window opacity | Appearance card; opacity moved from Terminal › behavior (it is a window setting) |
| **Terminal** (`terminal`) | *Font and cursor*: Font, Size, Line height, Letter spacing, Weight, Cursor style, Blink, Cursor width, Padding, Min. contrast, Bold uses bright colors, sample · *Behavior*: Default shell, Scrollback, Copy on select, Right-click copy/paste, Ligatures · *Keys*: note "Ctrl+Shift+C/V always copy and paste", Shift+Enter new line | both Terminal cards |
| **Notifications** (`notifications`) | *Windows notifications*: (info; future toggles: when a run finishes/fails/needs you, silence while focused) · *Phone (ntfy)*: Server, Topic, Send test | ntfy card |
| **Shortcuts** (`shortcuts`) | read-only table generated from the shortcut registry (6.4), grouped by Workspace / Panels / Terminal; phase 2: rebinding | Welcome list |
| **Agents & accounts** (`agents`) | *Ranking*: Switch at 5-hour %, Switch at weekly % · *Accounts*: list with usage bars, enable, ↑↓, Sign in, Check sign-in, Remove · Add account · *Installed agents*: detected CLIs (from `agents.detect`) | Agents card |
| **Connections** (`connections`) | Claude (sign in via CLI, Check, Connect/Disconnect) · Model endpoints (Ollama/Anthropic-compatible: Name, Base URL, Model, Token) · Add provider. Subtitle: "Where routines and ad hoc runs get their model. Interactive agent accounts are in Agents & accounts." | Connections card |
| **MCP servers** (`mcp`) | server list, Add from preset, editor (unchanged) · footer link "Choose servers per folder: folder ⋯ › Agent setup" | MCP card |
| **Integrations** (`integrations`) | *Jira*: Site, E-mail, API token, Connect/Disconnect · *GitHub*: status of `gh` auth (read-only) · *Project folders*: repo/Jira project → local folder map (`integrations.repoMap`), editable list | Tasks panel form; hidden map |
| **Routines** (`routines`) | Routines folder (same control as General), defaults hint, link "Open Runs" · later: retention, default connection for new routines | General card |
| **About** (`about`) | version, What's new, Setup tour, **Open settings.json** (config escape hatch, §2.4.5), open logs folder, licenses | General card buttons |

Why "Agents & accounts" and "Connections" stay separate but adjacent: they are different storage (`agents` store vs `settings.connections`) and serve different launchers (interactive agent tabs vs headless runs). Each page's subtitle points to the other; the palette also matches "account", "provider", "ollama" to both.

### 5.3 Implementation notes

- **Registry**: `src/renderer/src/settings/registry.ts` exports `SETTINGS_PAGES: { id, label, group, icon, component, keywords[] }[]` and `SETTINGS_ITEMS: { key, page, card, label, keywords[] }[]`. Pages are split out of `SettingsPanel.tsx` into `settings/pages/*.tsx`; `ConnectionsSection`, `AgentsSection`, `McpSection` are reused as-is (they already render one `<section className="card">`).
- **State**: `openSettingsModal(section?: string)` keeps its signature. `section` is now a page id or `page:itemKey`; current module-level `open` becomes `{ open, page, focus }`. Last page remembered in memory (not persisted).
- **Deep-link compatibility**: keep the ids `'agents'` and `'mcp'` as page ids, so `AgentButton.tsx`, `StatusBar.tsx`, `FolderAgentDialog.tsx` need no change. Keep `id="settings-agents"`/`id="settings-mcp"` on the cards for smoke scripts.
- **Close guard**: `setSettingsCloseGuard` (MCP editor) must also guard *page switches*, not only closing: switching page unmounts the editor. Route page changes through the same guard.
- **Pending blur saves**: SettingsPanel flushes ntfy topic/server and routines folder on unmount. With pages, these flushes must run when the page unmounts too (move the refs into each page; same pattern).
- **Accessibility**: left list = `role="tablist"` with `aria-orientation="vertical"`, pages = `role="tabpanel"`; Up/Down moves, Enter/Space selects (reuse `menuKeyNav`-style helper); `Ctrl+F` inside the modal focuses search; Esc in search clears first, then closes (the existing `data-esc-local` convention).
- **Text references** "Settings › Agents", "Settings › MCP", "Settings › Connections" in `shared/agents.ts`, `AgentChatPanel`, `RoutineEditor`, `FolderAgentDialog`, `whatsNew.ts`: rename to the new labels ("Settings › Agents & accounts", "Settings › MCP servers"). Grep `Settings ›`.

---

## 6. Command palette, header actions, shortcuts

### 6.1 Command palette

```
┌──────────────────────────────────────────────────────────────┐
│ > new                                                        │
├──────────────────────────────────────────────────────────────┤
│ NEW                                                          │
│ ▸ ◉ New agent (best account)                  Ctrl+Shift+N   │
│   ▭ New terminal                              Ctrl+Shift+T   │
│   ✦ New chat                                                 │
│   ⟳ New routine…                                             │
│   ✦ New ad hoc run…                           Ctrl+Shift+R   │
│ SETTINGS                                                     │
│   ⚙ Settings: Terminal › New terminal shell                  │
├──────────────────────────────────────────────────────────────┤
│ ↑↓ move · Enter run · Esc close · prefixes: > commands       │
│ @ routines/folders/tabs  # settings                          │
└──────────────────────────────────────────────────────────────┘
```

- Open with **Ctrl+Shift+P** (global, on the same window capture-phase keydown handler as the existing shortcuts, so it also works with focus inside xterm) and **Ctrl+K** only when focus is *not* in a terminal (Ctrl+K is readline kill-line). Also from the ⌕ button in the sidebar brand row.
- Empty query shows **Recent** (last 5 commands) then **Go to** (open tabs, routines, folder items).
- Implementation: `CommandPalette.tsx` modal on `useModalLayer`; commands registry `commands.ts`: `{ id, title, group, keywords, shortcut?, when?(): boolean, run() }`. Sidebar, New menu, Welcome and palette all read it, which also enforces "same label everywhere". Fuzzy match: simple subsequence score, no dependency needed.

Command list (initial):

| Group | Commands |
|---|---|
| New | New agent (best account) · New agent with… (per account) · New chat · New terminal · New terminal with profile… (per connection/shell) · New routine… · New ad hoc run… · New fan-out… · New folder… |
| Go to | Runs · Tasks · Agents · Routine: *name* (open session) · Folder item: *name* · Tab: *title* · Needs you: *session* |
| Routines | Run routine now: *name* · Stop run: *name* · Enable/Disable: *name* · Configure routine: *name* · Open routines folder |
| View | Toggle sidebar · Split right · Split down · Maximize/restore group · Close panel · Focus next/previous group · Reveal active tab in sidebar · Collapse all sidebar groups |
| Terminal (when active) | Find in terminal · Ask AI for a command · Rename tab · Keep tab in folder… · Clear terminal |
| Settings | Open settings · one entry per page (Settings: General … About) · one per indexed setting (from `SETTINGS_ITEMS`) · Change color theme… (opens picker with live preview) · Keep awake: On / While an agent works / Off |
| Help | Show setup tour · What's new · Keyboard shortcuts |

### 6.2 Optional "Agents" hub (phase 2)

A singleton tab (`openOnce('agents', …)`) listing running agent sessions (status, account, usage), Needs you, accounts with usage bars and a **New agent** button. It is the destination behind the sidebar "Agents" row. Phase 1 can point that row at the existing Agent flyout to avoid new UI.

### 6.3 Dock group header actions

Keep the right-aligned actions but make the **+** the shared New menu (4.2), and move rarely used actions into an overflow **⋯**:

```
[＋▾] [⫿ split right] [⋯]   ⋯ = Split down · Maximize/Restore · Close group · Move group to new window (future)
```

Maximize stays reachable through double-click on the tab strip background (dockview behavior) and Ctrl+Shift+M.

### 6.4 Keyboard shortcuts (consistent scheme)

Rule: app-level shortcuts use **Ctrl+Shift+letter** (never plain Ctrl+letter, which belongs to shells/TUIs), Alt+Shift for layout, and the existing set stays unchanged.

| Shortcut | Action | Status |
|---|---|---|
| Ctrl+Shift+P | Command palette | new |
| Ctrl+K (outside terminal) | Command palette | new |
| Ctrl+, | Settings | existing (allowed while a modal is open, as today) |
| Ctrl+Shift+N | New agent (best account) | new |
| Ctrl+Shift+T | New terminal | existing |
| Ctrl+Shift+R | New ad hoc run | new (check: not used by terminal) |
| Ctrl+Shift+H | Runs | existing |
| Ctrl+Shift+J | Tasks | new |
| Ctrl+Shift+W | Close panel | existing |
| Ctrl+Shift+M | Maximize/restore group | existing |
| Alt+Shift+= / Alt+Shift+- | Split right / down | existing |
| Ctrl+B | Toggle sidebar | existing (outside xterm) |
| Ctrl+Shift+E | Focus sidebar (then arrows) | new |
| Ctrl+1…9 | Focus tab N of active group | new (optional) |
| Ctrl+F / Ctrl+Shift+A / Ctrl+Shift+C/V / Shift+Enter | Terminal find / AI command / copy-paste / newline | existing |

Implementation: replace the `if/else` chain in `App.tsx` with a `SHORTCUTS` table `{ id, keys, when, run }` used by the keydown handler, the palette (shortcut hints), the Welcome list and Settings › Shortcuts. Keep the `isModalOpen()` rule and the Ctrl+, exception.

### 6.5 Help menu (sidebar footer `?`)

Setup tour · What's new · Keyboard shortcuts (opens Settings › Shortcuts) · Open routines folder · Open logs folder · About Turno.

### 6.6 When to add an activity bar

Add a VS Code-style icon rail only if the sidebar gains a second **independent** view (e.g. a file explorer or git view per folder) or destinations exceed ~7. Until then a single sidebar with fixed destination rows + collapsible groups is the lower-cost option; when the sidebar is hidden (Ctrl+B), the palette covers navigation.

---

## 7. Migration and risks

| Risk | Where | Mitigation |
|---|---|---|
| Deep links by section id | `openSettingsModal('agents' \| 'mcp')` in AgentButton, StatusBar, FolderAgentDialog | page ids keep the same strings; unknown ids fall back to General |
| Smoke views | `smoke.view` `settings*`, `settings-picker` clicks `.theme-trigger` | settings-picker must first select the Appearance page; keep `.theme-trigger` class; add `settings-<page>` smoke views |
| Onboarding | tour steps (agents, look, routines, background, notifications) reuse controls, not section ids; copy says "Everything here is also in Settings" | add per step a "Change later in Settings › X" link with the new page id |
| Text references "Settings › …" | shared/agents.ts, AgentChatPanel, RoutineEditor, FolderAgentDialog, whatsNew | rename in one commit; add a vitest that every `Settings › X` string matches a registered page label |
| Saved dock layouts | `turno.layout.v1`; legacy `settings` component registered for old layouts | no dock change in phase 1; if the Agents hub ships, register `agents` component, keep `settings` legacy registration |
| Sidebar collapsed state | `toggleSection` keys `routines`, `open-tabs`, folder ids | new parent key `folders`; existing folder keys keep working nested |
| Close guard / blur flush | MCP editor guard, ntfy/routinesDir unmount flush | guard page switches; move flushes per page (5.3) |
| Shortcut conflicts | new Ctrl+Shift+N/R/J/E/P vs TUIs (Claude Code, vim) | the window capture-phase handler in App.tsx already runs before xterm (that is how Ctrl+Shift+T works inside a terminal), so new Ctrl+Shift chords win over TUIs too; avoid C/V/A/F (terminal) and list every binding in Settings › Shortcuts |
| Muscle memory | sidebar "New terminal", "Ad hoc run", "Fan-out" rows disappear | show them in What's new; palette matches old labels as keywords |

## 8. Phased plan

1. **Phase 1 (settings)**: registry + two-pane Settings + search; move Keep awake, Jira, window opacity; rename text references; smoke views per page.
2. **Phase 2 (sidebar)**: shared New menu component (sidebar split button + dock "+"), destination rows, Folders parent group, Open tabs collapsed, Help footer, Welcome copy.
3. **Phase 3 (palette + shortcuts)**: commands registry, `CommandPalette`, `SHORTCUTS` table, Settings › Shortcuts page.
4. **Phase 4 (optional)**: Agents hub tab; shortcut rebinding.
