# Web UI guide

`min-kb-app` still ships as a single-screen PWA, but the layout is now closer to a modern chat client: the left rail manages agents, the chat list can be resized or collapsed, and the chat workspace keeps runtime controls inline instead of pinning a permanent settings drawer.

## Layout

Wide screens keep three persistent regions:

- `AgentRail` for switching between normal chat agents and the built-in `copilot-orchestrator`, plus new chats, connection status, and the bottom-left settings gear.
- `SessionSidebar` for browsing recent chats for the selected agent. The panel can be resized with a draggable separator or collapsed to maximize the conversation.
- `ChatPane` for the active chat thread or orchestrator workspace, header actions, queue recovery, and composer or terminal input controls.

When the selected agent is the built-in `copilot-orchestrator`, the chat pane switches into an async delegation workspace instead of the normal chat timeline/composer pairing.

At `920px` and below the chat list is hidden so the conversation gets the full width. The command palette still lets people switch chats and agents quickly on smaller screens.

## Runtime controls

Normal chat sessions keep session-scoped runtime controls in dropdowns at the top of the conversation pane:

- `Model` opens a dropdown with the model picker and reasoning effort.
- `Skills` opens grouped skill toggles by scope.
- `MCP` opens the raw MCP JSON editor with validation feedback.

Those choices are still saved with the chat session runtime config and persist to `RUNTIME.json` when a chat is written to disk.

## Orchestrator workspace

Selecting the built-in `copilot-orchestrator` agent changes the main pane into a tmux-backed orchestration view.

That view includes:

- an inline form for creating a new orchestrator session with project path, project purpose, and an optional initial prompt
- a live terminal output panel backed by SSE from the runtime
- metadata cards showing the tmux session/window target and current status
- a cancel action for recovering from a stuck delegated job
- a prompt box for queuing another async `copilot --yolo -p` job
- a raw terminal input box with buttons to send text only or send text plus `Enter` into the tmux pane

The session list still appears in the existing `SessionSidebar`, but the cards represent orchestrator sessions rather than saved chats. The capability banner reflects whether both `tmux` and the GitHub `copilot` CLI are available, and the live output view resumes by tailing the persisted pane log.

## Memory analysis action

Normal chat agents with detected memory-related skills show an `Analyze memory` button in the conversation header once the thread has content.

That action:

- uses `gpt-4.1` regardless of the currently selected chat model
- enables any detected memory-related skills for the analysis request
- reviews the current chat history without appending new turns to the thread
- displays the result in a modal instead of cluttering the chat timeline

## App settings modal

Browser-level preferences moved into a modal opened by the gear icon or `Cmd/Ctrl+,`.

The modal currently includes:

- theme preference (`System`, `Dark`, `Light`)
- model visibility for the quick model picker
- keyboard shortcut reference

These settings stay local to the browser through `localStorage`.

## Command palette

Press `Cmd/Ctrl+K` to open the command palette. It supports keyboard-first switching across:

- actions such as new chat, open settings, focus composer, and show or hide the chat list
- agents
- loaded chat sessions, sorted by recent activity

Use the arrow keys to move, `Enter` to select, and `Esc` to close.

## Keyboard shortcuts

| Shortcut | Action |
| --- | --- |
| `Cmd/Ctrl+K` | Open the command palette |
| `Cmd/Ctrl+,` | Open app settings |
| `Cmd/Ctrl+Enter` | Send the current message |
| `Alt+Shift+N` | Start a new chat |
| `/` | Focus the message composer |
| `Esc` | Close the active modal or palette |
| Arrow keys / `Home` / `End` | Navigate the agent rail, session list, or resize handle when focused |

## Related files

- `apps/web/src/App.tsx`
- `apps/web/src/components/AgentRail.tsx`
- `apps/web/src/components/SessionSidebar.tsx`
- `apps/web/src/components/RuntimeControls.tsx`
- `apps/web/src/components/SettingsModal.tsx`
- `apps/web/src/components/CommandPalette.tsx`
- `apps/web/src/components/OrchestratorPane.tsx`
- `apps/web/src/components/MemoryAnalysisModal.tsx`
- `apps/web/src/components/SidebarResizeHandle.tsx`
- `apps/web/src/cache.ts`
- `apps/web/src/command-palette.ts`
- `apps/web/src/ui-preferences.ts`
- `apps/web/src/styles.css`
