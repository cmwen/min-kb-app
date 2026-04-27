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
| `MIN_KB_APP_GEMINI_API_KEY` | runtime Gemini provider | none | Preferred Gemini API key for the Google GenAI SDK |
| `GEMINI_API_KEY` | runtime Gemini provider | none | Backward-compatible Gemini API key fallback |
| `GOOGLE_API_KEY` | runtime Gemini provider | none | Google API key fallback accepted by the Gemini SDK |
| `MIN_KB_APP_GEMINI_USE_VERTEXAI` | runtime Gemini provider | unset | Enables Vertex AI mode for Gemini when set to `true` |
| `GOOGLE_GENAI_USE_VERTEXAI` | runtime Gemini provider | unset | Backward-compatible Vertex AI toggle |
| `MIN_KB_APP_GEMINI_PROJECT` | runtime Gemini provider | none | Preferred Google Cloud project when using Vertex AI |
| `GOOGLE_CLOUD_PROJECT` | runtime Gemini provider | none | Backward-compatible Google Cloud project fallback |
| `MIN_KB_APP_GEMINI_LOCATION` | runtime Gemini provider | none | Preferred Google Cloud location when using Vertex AI |
| `GOOGLE_CLOUD_LOCATION` | runtime Gemini provider | none | Backward-compatible Google Cloud location fallback |
| `MIN_KB_APP_GEMINI_API_VERSION` | runtime Gemini provider | SDK default | Optional Gemini API version override |
| `MIN_KB_APP_GEMINI_MODEL` | runtime Gemini provider | none | Fallback Gemini model id to expose when live Gemini discovery fails |
| `MIN_KB_APP_LM_STUDIO_BASE_URL` | runtime LM Studio provider | `http://127.0.0.1:1234/v1` | Preferred override for the LM Studio OpenAI-compatible base URL |
| `LM_STUDIO_BASE_URL` | runtime LM Studio provider | `http://127.0.0.1:1234/v1` | Backward-compatible fallback for the LM Studio base URL |
| `MIN_KB_APP_LM_STUDIO_MODEL` | runtime LM Studio provider | none | Fallback LM Studio model id to expose when `/models` discovery fails |
| `LM_STUDIO_MODEL` | runtime LM Studio provider | none | Backward-compatible fallback for the LM Studio model id |
| `MIN_KB_APP_LM_STUDIO_MODELS_TIMEOUT_MS` | runtime LM Studio provider | `15000` | Timeout for local LM Studio `/models` discovery |
| `MIN_KB_APP_LM_STUDIO_CHAT_TIMEOUT_MS` | runtime LM Studio provider | `600000` | Timeout for LM Studio `/chat/completions` requests when slower local models need more time |
| `MIN_KB_APP_LM_STUDIO_MAX_COMPLETION_TOKENS` | runtime LM Studio provider | `8192` | Preferred LM Studio completion-token cap sent with `/chat/completions` so reasoning models have room to finish visible output |
| `LM_STUDIO_MAX_COMPLETION_TOKENS` | runtime LM Studio provider | `8192` | Backward-compatible fallback for the LM Studio completion-token cap |
| `VITE_API_BASE_URL` | web build | empty string | Overrides the web app API root instead of using same-origin `/api` |
| `VITE_BASE_PATH` | web build | inferred from the GitHub Pages workflow or `/` locally | Overrides the Vite base path for static hosting |

See [`.env.example`](../.env.example) for a minimal local setup.

## Chat session runtime config

Each saved chat session stores its runtime config in:

```text
agents/<agent>/history/<YYYY-MM>/<session-id>/RUNTIME.json
```

That file currently holds:

- `provider`
- `model`
- `reasoningEffort` when explicitly chosen
- `lmStudioEnableThinking` when LM Studio thinking mode is overridden
- `disabledSkills`
- `mcpServers`

The runtime config is parsed with the shared schema before it is written. The provider controls which model catalog entries are eligible for the session and whether reasoning effort, skills, and MCP server wiring remain available in the UI.

For Gemini and LM Studio sessions, `disabledSkills` affects which resolved `SKILL.md` documents are injected into the system prompt. `mcpServers` still persists in the session config for compatibility, but only the GitHub Copilot runtime executes MCP wiring today.

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
      attachments/
        <normalized-filename>
      prompt.txt   # only when a prompt is materialized to disk
      run.sh
```

Normal chat sessions can also write `LLM_STATS.json` beside `SESSION.md` and `RUNTIME.json`. That file stores aggregated GitHub Copilot SDK usage totals such as request counts, premium request units, token counts, duration, and the latest quota snapshot for the session.

Normal chat sessions may also include attachment metadata and files:

```text
agents/<agent>/history/<YYYY-MM>/<session-id>/
  SESSION.md
  RUNTIME.json
  LLM_STATS.json        # optional
  attachments/
    <turn-id>/
      <normalized-filename>
  turns/
    <timestamp>-user.md
    <timestamp>-user.md.json   # only when that turn has an attachment
    <timestamp>-assistant.md
```

`SESSION.md` stays human-readable. `ORCHESTRATOR.json` mirrors mutable tmux/runtime metadata such as the project path, project purpose, selected CLI provider, tmux window and pane IDs, active job, discovered custom agents, selected custom agent, execution mode, and accumulated premium request usage for tmux-backed delegations. Each delegation folder keeps the queued job record, completion record, optional uploaded attachment, optional materialized prompt, and generated shell script used to invoke either `copilot --model ... --yolo -p` or `gemini --model ... --yolo --prompt ...`.

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
2. Starting a new session uses the selected agent's `agents/<agent>/RUNTIME.json` defaults when present, then falls back to the built-in default config
3. Editing runtime controls in the conversation header updates in-memory request state immediately
4. Sending a message persists that session config back into `RUNTIME.json`

For the built-in orchestrator agent, creating a new session writes `SESSION.md` and `ORCHESTRATOR.json` immediately because the session must exist before any tmux window or delegated job can be tracked.

## Attachments

The web UI currently accepts a single file per chat send or orchestrator delegation, capped at 5 MB. Uploaded files are stored in the session directory, while the turn or job metadata keeps the attachment id, original filename, content type, byte size, media classification, and relative path under the store root.

Chat attachments are exposed back through `/api/agents/:agentId/sessions/:sessionId/attachments/:attachmentId`. Images are served with `Content-Disposition: inline`; other files are served as downloads.

## Model catalog behavior

The runtime exposes a provider-aware model catalog with `defaultProvider`, `providers`, and `models`. The GitHub Copilot provider uses the Copilot SDK `listModels()` API to discover models and metadata, including supported reasoning effort options and premium request billing multipliers when the SDK exposes them. The app also ships a bundled Copilot fallback catalog so the selector can stay populated if live discovery fails.

The Gemini provider uses the Google GenAI SDK `models.list()` API and falls back to bundled `gemini-3-flash-preview`, `gemini-3.1-pro-preview`, `gemini-2.5-flash`, and `gemini-2.5-pro` descriptors plus the optional configured fallback model id when discovery fails.

The LM Studio provider discovers local models from its OpenAI-compatible `/models` endpoint, using the configured base URL and optional fallback model id when discovery fails.

When sending a chat request through Gemini or LM Studio, the runtime prepends the selected agent prompt and any enabled skill documents as prompt context. This improves non-Copilot behavior for agentic workflows while staying honest about the runtime boundary: MCP server wiring and native tool execution still require the GitHub Copilot provider.

The web UI shows the reasoning effort selector only when the selected provider and model expose supported reasoning effort values. LM Studio also shows a provider-specific thinking-mode selector that sends the model's custom `enable_thinking` flag when you want quicker replies from supported models such as Gemma 4. Skills and MCP configuration remain visible but disabled when the provider does not support those capabilities. In the orchestrator workspace, Copilot sessions expose custom-agent and fleet-mode controls, while Gemini sessions intentionally limit those controls to the subset supported by the `gemini` CLI.

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
- `docs/API.md`
- `packages/copilot-runtime/src/index.ts`
- `packages/min-kb-store/src/orchestrator.ts`
- `packages/min-kb-store/src/sessions.ts`
- `packages/min-kb-store/src/workspace.ts`
- `packages/shared/src/index.ts`
- `apps/web/src/cache.ts`
- `apps/web/src/api.ts`
