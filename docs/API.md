# Runtime API

The local runtime host serves the web UI and exposes a JSON API under `/api`.

Unless noted otherwise:

- request and response bodies are JSON
- there is no authentication layer yet; the runtime is intended for local or trusted-network use
- validation errors return `400` with `{ "error": "..." }`
- missing resources return `404` with `{ "error": "..." }`
- unexpected failures return `500` with `{ "error": "..." }`

The shared request and response contracts live in `packages/shared/src/index.ts`.

## Core endpoints

### `GET /api/health`

Returns a lightweight health response plus the current workspace summary.

```json
{
  "ok": true,
  "workspace": {
    "storeRoot": "/absolute/path/to/min-kb-store",
    "copilotConfigDir": "/home/user/.config/github-copilot",
    "storeSkillDirectory": "/absolute/path/to/min-kb-store/skills",
    "copilotSkillDirectory": "/home/user/.copilot/skills",
    "agentCount": 12
  }
}
```

### `GET /api/workspace`

Returns the same `WorkspaceSummary` payload without the outer `ok` wrapper.

### `GET /api/models`

Returns a provider-aware `ModelCatalog`:

```json
{
  "defaultProvider": "copilot",
  "providers": [
    {
      "id": "copilot",
      "displayName": "GitHub Copilot",
      "capabilities": {
        "supportsReasoningEffort": true,
        "supportsSkills": true,
        "supportsMcpServers": true
      }
    }
  ],
  "models": [
    {
      "id": "gpt-5",
      "displayName": "GPT-5",
      "runtimeProvider": "copilot",
      "premiumRequestMultiplier": 1,
      "supportedReasoningEfforts": ["low", "medium", "high"]
    }
  ]
}
```

The runtime merges live Copilot SDK model discovery with a bundled fallback catalog. LM Studio models come from the configured OpenAI-compatible `/models` endpoint, with the environment fallback model id used when discovery is unavailable.

## Agents, sessions, and memory

### `GET /api/agents`

Returns all chat agents plus the built-in `copilot-orchestrator` agent summary.

### `GET /api/agents/:agentId`

Returns one agent summary. The reserved `copilot-orchestrator` agent is synthesized by the runtime instead of being loaded from `min-kb-store`.

### `GET /api/agents/:agentId/skills`

Returns the resolved skill descriptors for a normal chat agent. The built-in orchestrator agent returns an empty array.

### `GET /api/agents/:agentId/sessions`

For normal chat agents, returns `ChatSessionSummary[]`.

For `copilot-orchestrator`, returns orchestrator sessions projected into the same list view used by the web app.

### `GET /api/agents/:agentId/sessions/:sessionId`

Returns the full `ChatSession` or `OrchestratorSession`.

### `DELETE /api/agents/:agentId/sessions/:sessionId`

Deletes an entire chat or orchestrator session directory from the store.

### `GET /api/agents/:agentId/sessions/:sessionId/attachments/:attachmentId`

Streams one persisted chat attachment back from disk.

- images are served with `Content-Disposition: inline`
- non-images are served with `Content-Disposition: attachment`
- the response uses the stored `content-type`
- `Cache-Control` is set to `no-store`

This endpoint is only for chat-session attachments. Orchestrator job attachments live under delegation directories and are consumed from disk by the Copilot CLI.

### `POST /api/agents/:agentId/sessions`

Creates a new chat session by sending the first user turn.

Request body: `ChatRequest`

```json
{
  "title": "Investigate flaky tests",
  "prompt": "Find the root cause of the flaky test.",
  "config": {
    "provider": "copilot",
    "model": "gpt-5",
    "reasoningEffort": "medium",
    "disabledSkills": [],
    "mcpServers": {}
  },
  "attachment": {
    "name": "failure.log",
    "contentType": "text/plain",
    "size": 1234,
    "base64Data": "..."
  }
}
```

Notes:

- either `prompt` or `attachment` must be present
- `attachment` is optional and is persisted under the session directory
- the runtime augments the model prompt with local file context for the saved attachment
- Copilot-backed requests wait for the agent session to settle before responding and currently allow up to 10 minutes for longer tool/reasoning loops before timing out

Response body: `ChatResponse`

### `POST /api/agents/:agentId/sessions/:sessionId/messages`

Appends a new user turn to an existing chat session. Uses the same `ChatRequest` and `ChatResponse` shapes as the create endpoint.

Like session creation, Copilot-backed message sends wait for the underlying SDK session to settle and use the same 10-minute timeout budget for long-running agent loops.

### `POST /api/agents/:agentId/sessions/:sessionId/analyze-for-memory`

Runs the memory-analysis pass without appending a chat turn.

Request body: `MemoryAnalysisRequest`

```json
{
  "model": "gpt-5-mini",
  "config": {
    "provider": "copilot",
    "model": "gpt-5"
  }
}
```

Response body: `MemoryAnalysisResponse`, including:

- rendered analysis markdown
- the model that ran the pass
- configured, enabled, loaded, and invoked memory-skill names
- tool execution telemetry
- summaries for working, short-term, and long-term memory
- tracked memory file additions and updates by tier

### `GET /api/memory`

Returns memory entries across the whole store, or for one agent when `?agentId=<id>` is supplied.

## Orchestrator endpoints

The built-in `copilot-orchestrator` agent is backed by tmux and the GitHub `copilot` CLI.

### `GET /api/orchestrator/capabilities`

Returns `OrchestratorCapabilities`:

- whether the orchestrator is available
- whether `tmux` and `copilot` are installed
- the default project path
- recent project paths
- the shared tmux session name

### `GET /api/orchestrator/sessions`

Returns all orchestrator sessions as `OrchestratorSession[]`.

### `POST /api/orchestrator/sessions`

Creates a new orchestrator session.

Request body: `OrchestratorSessionCreateRequest`

```json
{
  "title": "Keep repo healthy",
  "projectPath": "/absolute/path/to/repo",
  "projectPurpose": "Keep the repo healthy",
  "model": "gpt-5",
  "selectedCustomAgentId": "repo-maintainer",
  "prompt": "Run validation and fix the failing test."
}
```

If `prompt` is supplied, the runtime immediately queues the first delegated job after creating the session.

### `GET /api/orchestrator/sessions/:sessionId`

Returns one full `OrchestratorSession`, including:

- session metadata and selected model
- discovered custom agents and the selected custom agent id
- queued, running, and completed jobs
- current terminal tail text and persisted log size
- accumulated premium-usage totals

### `PATCH /api/orchestrator/sessions/:sessionId`

Updates saved orchestrator session metadata.

Request body: `OrchestratorSessionUpdateRequest`

```json
{
  "title": "Repo upkeep",
  "model": "gpt-5.1",
  "selectedCustomAgentId": "repo-maintainer"
}
```

Use `null` for `selectedCustomAgentId` to clear the saved custom-agent preference.

### `POST /api/orchestrator/sessions/:sessionId/jobs`

Queues a delegated Copilot CLI job.

Request body: `OrchestratorDelegateRequest`

```json
{
  "prompt": "Update the docs to match the current implementation.",
  "customAgentId": "repo-maintainer",
  "attachment": {
    "name": "trace.txt",
    "contentType": "text/plain",
    "size": 2048,
    "base64Data": "..."
  }
}
```

Notes:

- `prompt` may be empty when the delegated job is driven entirely by an attachment
- attachments are stored under the delegation directory and exposed to the Copilot CLI from disk
- the runtime estimates premium request usage for tmux-backed orchestrator jobs from model metadata

### `POST /api/orchestrator/sessions/:sessionId/input`

Sends raw terminal input to the tmux pane.

Request body: `OrchestratorTerminalInputRequest`

```json
{
  "input": "pytest -q",
  "submit": true
}
```

When `submit` is `false`, the runtime sends the bytes without appending `Enter`.

### `POST /api/orchestrator/sessions/:sessionId/cancel`

Cancels the active orchestrator job for the session.

### `POST /api/orchestrator/sessions/:sessionId/restart`

Kills the current tmux pane and recreates a fresh pane for the same saved session metadata.

### `DELETE /api/orchestrator/sessions/:sessionId/jobs/:jobId`

Deletes a queued job that has not started yet. Running and completed jobs are not eligible.

### `GET /api/orchestrator/sessions/:sessionId/stream`

Streams terminal output as server-sent events.

The web UI keeps one `EventSource` connection per open orchestrator session and uses the stream to update the live terminal pane while the persisted `terminal/pane.log` remains the durable source of truth.

## Persistence notes

These endpoints map onto the store layout documented in `docs/CONFIGURATION.md`:

- chat runtime config is persisted in `RUNTIME.json`
- chat usage totals are persisted in `LLM_STATS.json`
- chat attachments use `attachments/<turn-id>/` plus `turns/*.md.json` metadata sidecars
- orchestrator sessions persist mutable state in `ORCHESTRATOR.json`
- orchestrator delegations persist `JOB.json`, `DONE.json`, attachments, optional `prompt.txt`, and the generated `run.sh`

## Related files

- `apps/runtime/src/index.ts`
- `apps/runtime/src/orchestrator.ts`
- `apps/web/src/api.ts`
- `packages/shared/src/index.ts`
- `packages/min-kb-store/src/orchestrator.ts`
- `packages/min-kb-store/src/sessions.ts`
