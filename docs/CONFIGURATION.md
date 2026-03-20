# Configuration and persistence

This project stores configuration and session metadata in three places:

- environment variables
- browser-local cache and UI preferences
- session files inside `min-kb-store`

## Environment variables

| Variable | Used by | Default | Purpose |
| --- | --- | --- | --- |
| `MIN_KB_STORE_ROOT` | runtime and store resolution | auto-detected adjacent checkout when possible | Points the app at the `min-kb-store` checkout |
| `MIN_KB_APP_PORT` | runtime host | `8787` | HTTP port for the local Hono runtime |
| `MIN_KB_APP_ORCHESTRATOR_TMUX_SESSION` | runtime orchestrator service | `min-kb-app-orchestrator` | Shared tmux session name that holds one window per orchestrator session |
| `MIN_KB_APP_RUNTIME_URL` | CLI | `http://localhost:8787` | Base URL for the CLI client |
| `VITE_API_BASE_URL` | web build | empty string | Overrides the web app API root instead of using same-origin `/api` |
| `VITE_BASE_PATH` | web build | inferred from the GitHub Pages workflow or `/` locally | Overrides the Vite base path for static hosting |

See [`.env.example`](../.env.example) for a minimal local setup.

## Chat session runtime config

Each saved chat session stores its runtime config in:

```text
agents/<agent>/history/<YYYY-MM>/<session-id>/RUNTIME.json
```

That file currently holds:

- `model`
- `reasoningEffort` when explicitly chosen
- `disabledSkills`
- `mcpServers`

The runtime config is parsed with the shared schema before it is written.

## Orchestrator session persistence

The built-in `copilot-orchestrator` agent stores its session state alongside the normal `min-kb-store` agent history layout:

```text
agents/copilot-orchestrator/history/<YYYY-MM>/<session-id>/
  SESSION.md
  ORCHESTRATOR.json
  terminal/
    pane.log
  delegations/
    <job-id>/
      JOB.json
      DONE.json
      prompt.txt   # only when a prompt is materialized to disk
      run.sh
```

`SESSION.md` stays human-readable. `ORCHESTRATOR.json` mirrors mutable tmux/runtime metadata such as the project path, project purpose, tmux window and pane IDs, and the active job. Each delegation folder keeps the queued job record, completion record, optional materialized prompt, and generated shell script used to invoke `copilot --yolo -p`.

## Browser-local persistence

The web app uses `localStorage` for fast local UX state:

| Key | Purpose |
| --- | --- |
| `min-kb-app:snapshot` | cached workspace, agents, models, sessions, and loaded threads |
| `min-kb-app:queue` | queued messages when the runtime is offline |
| `min-kb-app:draft:<agent>:<session>` | per-thread drafts |
| `min-kb-app:ui-preferences` | local UI preferences such as theme, model visibility, sidebar width, and sidebar collapse state |

These keys are browser-local only. They do not affect the canonical `min-kb-store` sync surface.

The orchestrator terminal viewer also keeps its transient stream state in memory inside the running web app. The pane output itself comes from the runtime by tailing `terminal/pane.log`.

## Config loading order

For normal chat agents, the runtime config a user sees depends on what they are doing:

1. Opening an existing session loads the saved `RUNTIME.json`
2. Starting a new session uses the built-in default config
3. Editing runtime controls in the conversation header updates in-memory request state immediately
4. Sending a message persists that session config back into `RUNTIME.json`

For the built-in orchestrator agent, creating a new session writes `SESSION.md` and `ORCHESTRATOR.json` immediately because the session must exist before any tmux window or delegated job can be tracked.

## Model catalog behavior

The runtime uses the GitHub Copilot SDK `listModels()` API to discover available models and metadata, including supported reasoning effort options. The app also ships a bundled fallback model catalog so the selector can stay populated if live model discovery fails.

The web UI shows the reasoning effort selector only when the currently selected model exposes supported reasoning effort values.

## MCP JSON

The runtime MCP control accepts raw server JSON that matches the shared runtime schema:

- local or stdio servers with `command`, `args`, `cwd`, `env`, and `tools`
- remote `http` or `sse` servers with `url`, optional `headers`, and optional `tools`

Invalid JSON blocks sending until the text parses again.

## GitHub Pages

The GitHub Pages workflow builds the web app with a repository-relative base path automatically and can inject `VITE_API_BASE_URL` from a repository variable so the static site can talk to a separately hosted runtime API.

## Related files

- `apps/runtime/src/index.ts`
- `apps/runtime/src/orchestrator.ts`
- `packages/copilot-runtime/src/index.ts`
- `packages/min-kb-store/src/orchestrator.ts`
- `packages/min-kb-store/src/sessions.ts`
- `packages/min-kb-store/src/workspace.ts`
- `packages/shared/src/index.ts`
- `apps/web/src/cache.ts`
- `apps/web/src/api.ts`
