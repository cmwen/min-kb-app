# Web UI guide

`min-kb-app` still ships as a single-screen PWA, but the layout is now closer to a modern chat client: the left rail manages agents, the chat list can be resized or collapsed, and the chat workspace keeps runtime controls inline instead of pinning a permanent settings drawer.

## Layout

Wide screens keep three persistent regions:

- `AgentRail` for switching between normal chat agents and the built-in `copilot-orchestrator`, plus new chats, connection status, unread-completion dots, and the bottom-left settings gear.
- `SessionSidebar` for browsing recent chats for the selected agent. The panel can be resized with a draggable separator or collapsed to maximize the conversation.
- `ChatPane` for the active chat thread or orchestrator workspace, header actions, queue recovery, and composer or terminal input controls.

When the selected agent is the built-in `copilot-orchestrator`, the chat pane switches into an async delegation workspace instead of the normal chat timeline/composer pairing.

At `920px` and below the chat list is hidden so the conversation gets the full width. The command palette still lets people switch chats and agents quickly on smaller screens.

## Runtime controls

Normal chat sessions keep session-scoped runtime controls in dropdowns at the top of the conversation pane:

- `Model` opens a dropdown with the provider picker, model picker, and provider-gated reasoning effort.
- `Skills` opens grouped skill toggles by scope.
- `MCP` opens the raw MCP JSON editor with validation feedback.

Switching providers is session-scoped. GitHub Copilot keeps skills, MCP servers, and reasoning effort available; LM Studio exposes a simpler local-model flow and disables controls the provider does not support.

Those choices are still saved with the chat session runtime config and persist to `RUNTIME.json` when a chat is written to disk. New chats now seed those controls from the selected agent's `RUNTIME.json` defaults when available.

## Chat attachments

Normal chat composers include a single-file picker beneath the prompt box.

- one file can be attached per send
- files larger than 5 MB are rejected in the browser before upload
- image attachments render inline in the timeline and open from the runtime attachment endpoint
- text and binary attachments render as downloadable file chips with name and size metadata

The runtime also injects attachment path and file metadata into the chat request so the model can inspect the uploaded file from disk when needed.

## Orchestrator workspace

Selecting the built-in `copilot-orchestrator` agent changes the main pane into a tmux-backed orchestration view.

That view includes:

- an inline form for creating a new orchestrator session with project path, project purpose, and an optional initial prompt
- an inline session summary card whose settings expand directly beneath the top action row instead of below the terminal
- session settings for renaming the project, changing the saved Copilot model, and selecting a discovered project-local custom agent
- a queue-oriented task pipeline card that keeps the current run, queued follow-up prompts, and recent completions visible in one place
- a live terminal output panel backed by SSE from the runtime
- metadata cards showing the tmux session/window target and current status
- icon-forward action buttons for settings, cancel, delegate, save, and raw terminal input submission
- a prompt box for queuing another async `copilot --yolo -p` job, even while the current task is still running
- a single-file attachment picker for delegated jobs so the Copilot CLI can inspect uploaded files from disk
- a raw terminal input box with buttons to send text only or send text plus `Enter` into the tmux pane

Completed or failed orchestrator sessions now leave a small red dot on their session card until you open that session. The same unread state also bubbles up to the agent rail and the collapsed `Show chats` button so long-running work still surfaces even when the session list is hidden.

When delegated work finishes, the tmux pane now emits an explicit completion line, keeps a tmux status message visible longer, and rings the terminal bell so the terminal side also feels like a real notification instead of just another log line.

The session list still appears in the existing `SessionSidebar`, but the cards represent orchestrator sessions rather than saved chats. The capability banner reflects whether both `tmux` and the GitHub `copilot` CLI are available, and the live output view resumes by tailing the persisted pane log.

Destructive actions go through a confirmation modal. From the orchestrator workspace you can delete the whole session, start a brand-new tmux pane for the same saved session, or remove queued jobs that have not started yet.

## Memory analysis action

Normal chat agents with detected memory-related skills show an `Analyze memory` button in the conversation header once the thread has content.

That action:

- uses `gpt-5-mini` by default regardless of the currently selected chat model
- enables any detected memory-related skills for the analysis request so the run can update memory directly
- reviews the current chat history without appending new turns to the thread
- displays the result in a modal instead of cluttering the chat timeline
- opens the modal immediately so the loading state stays visible during analysis
- summarizes the chat into `Working memory`, `Short-term memory`, and `Long-term memory`
- highlights any detected working, short-term, or long-term memory files that were added or updated during the run
- separates requested memory skills from runtime-reported loaded/enabled/invoked skills so missing skill telemetry is easier to debug

## App settings modal

Browser-level preferences moved into a modal opened by the gear icon or `Cmd/Ctrl+,`.

The modal currently includes:

- theme preference (`System`, `Dark`, `Light`)
- model visibility for the quick model picker
- keyboard shortcut reference

These settings stay local to the browser through `localStorage`.

The web client also restores the last selected agent or session after a full restart. If the user had started a fresh chat without sending yet, the browser keeps that new-chat selection plus the unsent runtime controls so the workspace comes back in the same state.

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
