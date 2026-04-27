# min-kb-app

`min-kb-app` is a new TypeScript monorepo for chatting with and managing a local `min-kb-store` checkout.

It combines a local runtime host, a basic CLI, and a PWA web UI around the Markdown-first store layout so you can:

- browse agents and sessions from `min-kb-store`
- resume chats using GitHub Copilot SDK sessions
- switch chat sessions between the GitHub Copilot runtime, the Gemini SDK runtime, and a local LM Studio provider
- stream in-progress chat replies in the web UI, including slow local LM Studio runs
- delegate async tmux-backed jobs through the built-in `copilot-orchestrator` agent with either the `copilot` or `gemini` CLI
- ship a repo-local Copilot implementation team under `.github/agents/` with an orchestrator plus UX, architecture, engineering, QA, and documentation specialists
- manage recurring scheduled chats through the built-in `copilot-schedule` agent
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
   pnpm --filter @min-kb-app/cli dev chat coding-agent --provider gemini --model gemini-3.1-pro-preview -m "Summarize the latest failures"
   pnpm --filter @min-kb-app/cli dev orchestrate --project-path "$PWD" --project-purpose "Keep the repo healthy" --provider gemini --wait "Fix the failing tests"
   ```

   `chat -m` is non-interactive, so it is safe to call from cron. `orchestrate` gives the same one-shot flow for the tmux-backed orchestrator, either by creating a new session from `--project-path`/`--project-purpose` or by reusing an existing one with `--session`. Both commands now accept `--provider` so you can explicitly target Copilot, Gemini, or LM Studio where supported.

For the orchestrator workflow, make sure `tmux` is installed locally plus at least one supported CLI backend: GitHub `copilot` or Google `gemini`.

## Using the Web UI

The web app is a single-screen PWA with three main working areas plus modal overlays:

- agent rail with a bottom-left settings gear
- resizable or collapsible session sidebar
- chat pane with inline runtime dropdowns for model, skills, and MCP

The agent rail also includes a built-in `copilot-orchestrator` agent plus a built-in `copilot-schedule` agent. Selecting the orchestrator replaces the normal composer flow with a tmux-backed delegation workspace that can:

- create orchestrator sessions tied to a project path and project purpose
- choose whether a session runs through GitHub Copilot CLI or Gemini CLI
- discover `.agent.md` Copilot custom agents from the target project and auto-select `implementation-orchestrator` when that repo-local team is present
- queue async `copilot --yolo -p` or `gemini --yolo --prompt` jobs into clearly named tmux windows
- attach one file to a delegated job so the selected CLI can inspect it from disk
- stream tmux output live over SSE
- show red-dot unread completion badges in the agent/session UI when delegated work finishes in the background
- cancel a stuck delegated job, restart the tmux pane for fresh work, delete queued jobs, and delete whole orchestrator sessions
- create daily, weekly, or monthly recurring orchestrator schedules tied to a session prompt
- optionally email a schedule run to a recipient when the delegated job finishes
- send raw terminal input back into the tmux pane with or without submitting `Enter`

Selecting the schedule agent opens a dedicated scheduled-chat workspace that can:

- create daily, weekly, or monthly recurring scheduled tasks backed by normal chat agents
- keep a stable backing chat thread for each scheduled task so the conversation history persists between runs
- run the selected chat agent with the same configured skills and runtime behavior it already uses in chat
- open the backing chat directly when you want to inspect or continue the scheduled conversation manually

This repository now includes a default Copilot team in `.github/agents/`: `implementation-orchestrator`, `ux-designer`, `architecture`, `engineer`, `qa`, and `doc-writer`. When you point the built-in orchestrator at this repo, new sessions automatically pick `implementation-orchestrator` so delegated runs start from the specialist workflow by default.

Normal chat agents keep the standard chat workflow, but now also expose provider-aware runtime controls plus a single-file attachment picker in the composer. Image attachments render inline in the timeline, while non-images download from the runtime attachment endpoint.

Normal chat agents also expose an `Analyze memory` header action. That action runs a `gpt-5-mini` pass over the current thread and asks the selected agent to use any available memory-related skills to update memory without adding extra turns to the conversation.

The command palette (`Cmd/Ctrl+K`) lets you switch agents, chats, and primary actions quickly. Existing sessions still load their saved runtime config from `RUNTIME.json`; brand-new sessions start from the selected agent's `RUNTIME.json` defaults when present, then fall back to the built-in default config until you send the first message.

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
- `MIN_KB_APP_SMTP_HOST`, `MIN_KB_APP_SMTP_PORT`, `MIN_KB_APP_SMTP_SECURE`, `MIN_KB_APP_SMTP_USER`, `MIN_KB_APP_SMTP_PASS`, and `MIN_KB_APP_SMTP_FROM` enable legacy orchestrator schedule email delivery from the runtime; scheduled chats should prefer agent skills for email workflows
- `MIN_KB_APP_RUNTIME_URL` controls the CLI target
- `MIN_KB_APP_GEMINI_API_KEY`, `GEMINI_API_KEY`, or `GOOGLE_API_KEY` authenticate the Gemini SDK runtime provider
- `MIN_KB_APP_GEMINI_USE_VERTEXAI`, `GOOGLE_GENAI_USE_VERTEXAI`, `MIN_KB_APP_GEMINI_PROJECT`, `GOOGLE_CLOUD_PROJECT`, `MIN_KB_APP_GEMINI_LOCATION`, `GOOGLE_CLOUD_LOCATION`, and `MIN_KB_APP_GEMINI_API_VERSION` configure Gemini Vertex/API routing when needed
- `MIN_KB_APP_GEMINI_MODEL` provides a fallback Gemini model id when live Gemini model discovery is unavailable
- `MIN_KB_APP_LM_STUDIO_BASE_URL` or `LM_STUDIO_BASE_URL` point the optional LM Studio provider at a local OpenAI-compatible endpoint
- `MIN_KB_APP_LM_STUDIO_MODEL` or `LM_STUDIO_MODEL` provide a fallback LM Studio model id when live model discovery is unavailable
- `MIN_KB_APP_LM_STUDIO_MODELS_TIMEOUT_MS` and `MIN_KB_APP_LM_STUDIO_CHAT_TIMEOUT_MS` override the local-model discovery and chat request timeouts when slower LM Studio models need more time
- `MIN_KB_APP_LM_STUDIO_MAX_COMPLETION_TOKENS` or `LM_STUDIO_MAX_COMPLETION_TOKENS` raise or lower the LM Studio chat completion budget when local reasoning models like Gemma need more room to finish their visible answer
- saved LM Studio sessions can also override the provider's `enable_thinking` flag for quicker visible replies on supported models such as Gemma 4
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

Model options are loaded from the runtime as a provider-aware catalog. GitHub Copilot models come from the Copilot SDK and are merged with a bundled fallback catalog so the selector stays populated even when live discovery is unavailable. The bundled Copilot fallback list intentionally sticks to current broadly available models and drops retired IDs such as GPT-5, the GPT-5.1 family, and older Claude Opus entries. Gemini models come from the Gemini SDK `models.list()` API with bundled `gemini-3-flash-preview`, `gemini-3.1-pro-preview`, `gemini-2.5-flash`, and `gemini-2.5-pro` fallbacks, matching the newer Gemini CLI model families when discovery is unavailable. LM Studio models are discovered from the local OpenAI-compatible `/models` endpoint, with an optional environment-configured fallback model id.

When Gemini or LM Studio is selected, the runtime injects the chosen agent prompt plus any enabled `SKILL.md` documents into the request as prompt-backed system context. That gives non-Copilot providers a middle-tier workflow closer to agent behavior without claiming native Copilot skill execution. MCP server wiring still remains Copilot-only.

The runtime model dropdown lets you switch providers per session. Skills, MCP servers, and reasoning effort stay enabled only when the selected provider advertises support for them. LM Studio also exposes a thinking-mode override that maps to its custom `enable_thinking` request flag for models like Gemma 4. Gemini currently keeps prompt-backed skills available, but not MCP wiring or reasoning-effort controls. In orchestrator sessions, Copilot keeps custom-agent and fleet-mode controls while Gemini sessions stay on standard execution without custom agents.

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
- delegate async Copilot CLI or Gemini CLI work through tmux-backed orchestrator sessions
- inspect a chat thread with `gpt-5-mini` for memory-worthy context and memory updates without cluttering the chat history
- save chat turns back into the canonical Markdown history layout
- present an agent-first chat UI with per-session runtime config

Advanced follow-ups such as richer tool streaming, session branching UI, deeper MCP presets, and memory write flows can build on this scaffold.
