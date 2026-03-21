# Troubleshooting

## The web UI says the app is offline

Make sure the runtime host is running:

```bash
pnpm dev:runtime
```

Then confirm the runtime is reachable:

```bash
curl http://localhost:8787/api/health
```

If the runtime cannot resolve your store root, set `MIN_KB_STORE_ROOT` explicitly before starting it.

## The model list looks incomplete

The runtime exposes a provider-aware model catalog. For GitHub Copilot it first asks the Copilot SDK for the current model catalog. If that lookup fails, the app falls back to a bundled catalog so the selector is still usable.

If you expect more models than you see:

- confirm GitHub Copilot authentication for the local SDK environment
- restart the runtime host
- inspect runtime logs for model discovery warnings

If the LM Studio provider is selected and its model list is empty:

- make sure LM Studio is running locally
- confirm `MIN_KB_APP_LM_STUDIO_BASE_URL` or `LM_STUDIO_BASE_URL` points at the correct OpenAI-compatible `/v1` root
- optionally set `MIN_KB_APP_LM_STUDIO_MODEL` to expose a fallback model id when live discovery is unavailable

## I cannot send a message

Check the composer footer and runtime controls:

- no agent selected means the send button stays disabled
- invalid MCP JSON blocks sending until the JSON parses again
- some providers intentionally disable skills, MCP servers, or reasoning effort based on their capability flags
- runtime/network failures queue the message for retry instead of silently dropping it

If the message only contains an attachment, keep in mind the runtime still requires at least one of `prompt` or `attachment`; an empty prompt plus a valid attachment is allowed.

## I see queued messages

Queued messages mean the web UI could not reach the runtime while sending. Use the retry buttons in the queue banner after the runtime is back online.

## The settings modal or sidebar state feels wrong

UI preferences such as theme, visible models, sidebar width, and sidebar collapse state are stored locally in the browser under `min-kb-app:ui-preferences`. If the UI gets into a bad local state, clear that key or clear the app's site storage and reload.

## A session loads unexpected settings

Existing sessions load the runtime config saved in that session's `RUNTIME.json`. If an older session has unexpected model, reasoning, skills, or MCP values, inspect the saved file in the session directory.

The saved config is provider-aware. If a session was last used with LM Studio, the UI may disable Copilot-only controls until you switch the provider back.

## My attachment is missing or will not open

Chat attachments are stored in the session folder and loaded back through `/api/agents/:agentId/sessions/:sessionId/attachments/:attachmentId`.

- the browser currently rejects files larger than 5 MB before upload
- image attachments are served inline; other files download as attachments
- if an older session references a missing file on disk, reopen the session after restoring the attachment under the session `attachments/` directory

For orchestrator jobs, uploaded files are stored under the delegation folder and are consumed from disk by the Copilot CLI rather than through the chat attachment endpoint.

## The orchestrator session cannot run

The built-in `copilot-orchestrator` agent requires both `tmux` and the GitHub `copilot` CLI.

- confirm `tmux` is installed and on `PATH`
- confirm `copilot` is installed and authenticated
- open the orchestrator workspace and check the capability banner for missing dependencies
- if a pane gets stuck, use the restart action to recreate it without deleting the saved session

## The web app cannot reach a non-default runtime URL

For local dev, `vite` proxies `/api` to `http://localhost:8787`. For deployed or custom builds, set `VITE_API_BASE_URL` so the web app points at the correct runtime host.
