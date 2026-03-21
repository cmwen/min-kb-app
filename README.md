# min-kb-app

`min-kb-app` is a new TypeScript monorepo for chatting with and managing a local `min-kb-store` checkout.

It combines a local runtime host, a basic CLI, and a PWA web UI around the Markdown-first store layout so you can:

- browse agents and sessions from `min-kb-store`
- resume chats using GitHub Copilot SDK sessions
- switch chat sessions between the GitHub Copilot runtime and a local LM Studio provider
- delegate async tmux-backed jobs through the built-in `copilot-orchestrator` agent
- load agent-local, store-global, and `~/.copilot/skills` skill directories
- attach one file up to 5 MB to a chat message or delegated orchestrator job
- configure model, disabled skills, and MCP servers per chat
- run a `gpt-5-mini` memory-analysis pass over the current chat without adding extra turns
- use keyboard shortcuts for settings, sending, and quick navigation
- persist chat history in the canonical sync-friendly Markdown format

## Stack

- `pnpm` workspaces
- TypeScript
- Biome
- GitHub Copilot SDK
- Hono runtime host
- React + Vite PWA
- Vitest

## Workspace layout

```text
apps/
  cli/        Basic terminal client for the runtime API
  runtime/    Local HTTP host for Copilot SDK + min-kb-store access
  web/        Agent-first PWA chat UI
packages/
  shared/     Shared contracts and schemas
  min-kb-store/ Filesystem adapter for the Markdown store
  copilot-runtime/ Copilot SDK session wrapper
```

## Key design choices

- `min-kb-store` Markdown remains the source of truth.
- Chat transcripts stay in `agents/<agent>/history/<YYYY-MM>/<session-id>/SESSION.md` plus immutable `turns/*.md` files.
- Copilot SDK session persistence is used as operational runtime state, not the shared sync surface.
- Extra per-session runtime options are stored in `RUNTIME.json` inside the session folder so the Markdown manifest remains interoperable with existing Python helpers.
- The built-in orchestrator agent stores each session as `SESSION.md` plus an `ORCHESTRATOR.json` sidecar and `delegations/<job-id>/` runtime artifacts under `agents/copilot-orchestrator/history/...`.

## Quick start

1. Export or set the store root if you do not keep `min-kb-store` next to this repo.

   ```bash
   export MIN_KB_STORE_ROOT=/absolute/path/to/min-kb-store
   ```

2. Install dependencies.

   ```bash
   pnpm install
   ```

3. Build the workspace.

   ```bash
   pnpm build
   ```

4. Start the runtime host.

   ```bash
   pnpm dev:runtime
   ```

5. Start the web UI in another terminal.

   ```bash
   pnpm dev:web
   ```

6. Or use the CLI.

   ```bash
   pnpm --filter @min-kb-app/cli dev agents
   pnpm --filter @min-kb-app/cli dev chat coding-agent
   pnpm --filter @min-kb-app/cli dev chat coding-agent -m "Fix the failing tests"
   pnpm --filter @min-kb-app/cli dev orchestrate --project-path "$PWD" --project-purpose "Keep the repo healthy" --wait "Fix the failing tests"
   ```

   `chat -m` is non-interactive, so it is safe to call from cron. `orchestrate` gives the same one-shot flow for the tmux-backed Copilot orchestrator, either by creating a new session from `--project-path`/`--project-purpose` or by reusing an existing one with `--session`.

For the orchestrator workflow, make sure both `tmux` and the GitHub `copilot` CLI are installed locally.

## Using the Web UI

The web app is a single-screen PWA with three main working areas plus modal overlays:

- agent rail with a bottom-left settings gear
- resizable or collapsible session sidebar
- chat pane with inline runtime dropdowns for model, skills, and MCP

The agent rail also includes a built-in `copilot-orchestrator` agent. Selecting it replaces the normal composer flow with a tmux-backed delegation workspace that can:

- create orchestrator sessions tied to a project path and project purpose
- discover `.agent.md` Copilot custom agents from the target project and save one as the default for future delegated jobs
- queue async `copilot --yolo -p` jobs into clearly named tmux windows
- attach one file to a delegated job so the Copilot CLI can inspect it from disk
- stream tmux output live over SSE
- show red-dot unread completion badges in the agent/session UI when delegated work finishes in the background
- cancel a stuck delegated job, restart the tmux pane for fresh work, delete queued jobs, and delete whole orchestrator sessions
- send raw terminal input back into the tmux pane with or without submitting `Enter`

Normal chat agents keep the standard chat workflow, but now also expose provider-aware runtime controls plus a single-file attachment picker in the composer. Image attachments render inline in the timeline, while non-images download from the runtime attachment endpoint.

Normal chat agents also expose an `Analyze memory` header action. That action runs a `gpt-5-mini` pass over the current thread and asks the selected agent to use any available memory-related skills to update memory without adding extra turns to the conversation.

The command palette (`Cmd/Ctrl+K`) lets you switch agents, chats, and primary actions quickly. Existing sessions still load their saved runtime config from `RUNTIME.json`; brand-new sessions start from the default config until you send the first message.

For a detailed walkthrough, see [`docs/WEB_UI.md`](docs/WEB_UI.md).

## Repository automation

The repository includes GitHub automation for:

- CI validation on pushes and pull requests
- GitHub Pages deployment for the web app
- Dependabot updates for the pnpm workspace and GitHub Actions
- GitHub Packages publishing for the buildable library packages via a release transform

See [`docs/RELEASE_AUTOMATION.md`](docs/RELEASE_AUTOMATION.md) for the workflow details and required GitHub repository settings.

## Configuration & persistence

Configuration is split across environment variables, browser-local state, and per-session runtime files:

- `MIN_KB_STORE_ROOT` tells the runtime where to find `min-kb-store`
- `MIN_KB_APP_PORT` controls the runtime HTTP port
- `MIN_KB_APP_ORCHESTRATOR_TMUX_SESSION` overrides the shared tmux session name used by the built-in orchestrator agent
- `MIN_KB_APP_RUNTIME_URL` controls the CLI target
- `MIN_KB_APP_LM_STUDIO_BASE_URL` or `LM_STUDIO_BASE_URL` point the optional LM Studio provider at a local OpenAI-compatible endpoint
- `MIN_KB_APP_LM_STUDIO_MODEL` or `LM_STUDIO_MODEL` provide a fallback LM Studio model id when live model discovery is unavailable
- `VITE_API_BASE_URL` lets the web build target a non-default runtime API
- `VITE_BASE_PATH` optionally overrides the web app base path for static hosting builds
- `RUNTIME.json` stores the saved per-session chat runtime config
- `LLM_STATS.json` stores aggregated GitHub Copilot SDK usage totals for chat sessions
- `ORCHESTRATOR.json` stores per-session tmux/runtime state for the built-in orchestrator agent
- turn metadata sidecars (`turns/*.md.json`) and per-session `attachments/` folders persist uploaded chat files
- orchestrator jobs and sessions also persist estimated premium request usage derived from Copilot model billing metadata
- browser `localStorage` keeps drafts, cached snapshots, queued messages, and UI preferences

See [`docs/CONFIGURATION.md`](docs/CONFIGURATION.md) for the full precedence and persistence details.

For the runtime HTTP surface and request/response shapes, see [`docs/API.md`](docs/API.md).

## Keyboard shortcuts

The web UI now supports:

- `Cmd/Ctrl+K` to open the command palette
- `Cmd/Ctrl+,` to open settings
- `Cmd/Ctrl+Enter` to send
- `Esc` to close the active modal or palette
- `Alt+Shift+N` to start a new session
- `/` to focus the composer
- arrow keys plus `Home` / `End` inside the agent rail, session list, and sidebar resize handle

## Model selection

Model options are loaded from the runtime as a provider-aware catalog. GitHub Copilot models come from the Copilot SDK and are merged with a bundled fallback catalog so the selector stays populated even when live discovery is unavailable. LM Studio models are discovered from the local OpenAI-compatible `/models` endpoint, with an optional environment-configured fallback model id.

The runtime model dropdown lets you switch providers per session. Skills, MCP servers, and reasoning effort stay enabled only when the selected provider advertises support for them.

## Troubleshooting

Common issues and recovery steps live in [`docs/TROUBLESHOOTING.md`](docs/TROUBLESHOOTING.md).

## Available commands

- `pnpm build`
- `pnpm typecheck`
- `pnpm lint`
- `pnpm test`
- `pnpm dev`
- `pnpm dev:runtime`
- `pnpm dev:web`
- `pnpm dev:cli`

## Current scope

This first scaffold focuses on a working end-to-end flow:

- resolve a local `min-kb-store`
- inspect agents, skills, sessions, and memory
- send prompts through Copilot SDK using min-kb-store agents as custom agents
- delegate async Copilot CLI work through tmux-backed orchestrator sessions
- inspect a chat thread with `gpt-5-mini` for memory-worthy context and memory updates without cluttering the chat history
- save chat turns back into the canonical Markdown history layout
- present an agent-first chat UI with per-session runtime config

Advanced follow-ups such as richer tool streaming, session branching UI, deeper MCP presets, and memory write flows can build on this scaffold.
