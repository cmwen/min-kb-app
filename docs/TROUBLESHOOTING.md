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

If you start both services together with `pnpm dev`, the root dev script now waits for `GET /api/health` before launching Vite. That avoids the transient `/api/.../stream` proxy `ECONNREFUSED` noise that can happen when the browser restores an orchestrator session before the runtime has finished binding to port `8787`.

## The model list looks incomplete

The runtime exposes a provider-aware model catalog. For GitHub Copilot it first asks the Copilot SDK for the current model catalog. If that lookup fails, the app falls back to a bundled catalog so the selector is still usable.

The capability flags behind those runtime controls are documented in [`docs/CONFIGURATION.md#provider-capabilities-at-a-glance`](CONFIGURATION.md#provider-capabilities-at-a-glance). They gate the UI and runtime behavior, but they do not mean every provider has the same implementation underneath.

If you expect more models than you see:

- confirm GitHub Copilot authentication for the local SDK environment
- restart the runtime host
- inspect runtime logs for model discovery warnings

If the LM Studio provider is selected and its model list is empty:

- make sure LM Studio is running locally
- confirm `MIN_KB_APP_LM_STUDIO_BASE_URL` or `LM_STUDIO_BASE_URL` points at the correct OpenAI-compatible `/v1` root
- optionally set `MIN_KB_APP_LM_STUDIO_MODEL` to expose a fallback model id when live discovery is unavailable
- the web chat now streams LM Studio replies incrementally, so a slow local model should show partial progress before the final assistant turn lands
- if Gemma or another reasoning model still stops mid-answer, increase `MIN_KB_APP_LM_STUDIO_MAX_COMPLETION_TOKENS` so LM Studio reserves more completion budget for visible output; the runtime now also prefers fuller visible text from `reasoning_content` when LM Studio leaves `message.content` incomplete
- if Gemma 4 is still verbose or slow, switch the LM Studio runtime control to `Thinking mode -> Quick response (thinking off)` so supported models send `enable_thinking: false`
- LM Studio's `/v1/models` can include downloaded models that are not loaded into memory yet; if a send fails with `Failed to load model`, load it in LM Studio's Local Server UI or let the app retry through `/api/v1/models/load`
- if auto-load itself fails with `model_load_failed`, the runtime request path is working but LM Studio could not load that model into memory; try loading it manually, reducing memory usage, or switching to a smaller/local-server-compatible model

## I cannot send a message

Check the composer footer and runtime controls:

- no agent selected means the send button stays disabled
- invalid MCP JSON blocks sending until the JSON parses again
- some providers intentionally disable skills, MCP servers, or reasoning effort based on their capability flags; Gemini and LM Studio keep skills available as prompt-backed context but still disable MCP wiring and reasoning effort controls
- runtime/network failures queue the message for retry instead of silently dropping it

If the message only contains an attachment, keep in mind the runtime still requires at least one of `prompt` or `attachment`; an empty prompt plus a valid attachment is allowed.

## I see queued messages

Queued messages mean the web UI could not reach the runtime while sending. Use the retry buttons in the queue banner after the runtime is back online.

## The settings modal or sidebar state feels wrong

UI preferences such as theme, visible models, sidebar width, and sidebar collapse state are stored locally in the browser under `min-kb-app:ui-preferences`. If the UI gets into a bad local state, clear that key or clear the app's site storage and reload.

## A session loads unexpected settings

Existing sessions load the runtime config saved in that session's `RUNTIME.json`. If an older session has unexpected model, reasoning, skills, or MCP values, inspect the saved file in the session directory.

The saved config is provider-aware. If a session was last used with LM Studio, the UI will still keep skills available, but Copilot-only controls like MCP wiring remain disabled until you switch the provider back.

## My attachment is missing or will not open

Chat attachments are stored in the session folder and loaded back through `/api/agents/:agentId/sessions/:sessionId/attachments/:attachmentId`.

- the browser currently rejects files larger than 5 MB before upload
- image attachments are served inline; other files download as attachments
- if an older session references a missing file on disk, reopen the session after restoring the attachment under the session `attachments/` directory

For orchestrator jobs, uploaded files are stored under the delegation folder and are consumed from disk by the selected CLI backend rather than through the chat attachment endpoint.

## The orchestrator session cannot run

The built-in `copilot-orchestrator` agent requires `tmux` plus at least one supported CLI backend: GitHub `copilot` or Google `gemini`.

- confirm `tmux` is installed and on `PATH`
- confirm the selected CLI backend is installed and authenticated
- open the orchestrator workspace and check the capability banner for missing dependencies
- if the server restarted and the shared tmux session disappeared, delegating a new task now recreates the tmux session automatically and records a recovery notice in the pane output
- if a pane gets stuck, use the restart action to recreate it without deleting the saved session
- Copilot-backed delegated jobs now pause their retry loop until the reported limit reset time when the CLI output includes `Retry-After`, `X-RateLimit-Reset`, `available again at`, or similar retry timing details; generic rate-limit messages fall back to a conservative one-minute wait before retrying
- if a Gemini-backed job prints `You have exhausted your capacity on this model.`, that message comes from the Gemini CLI provider inside tmux rather than from tmux itself; switch to a model/account with available quota or retry later

## Scheduled email delivery is not working

Legacy orchestrator schedule emails only send when `MIN_KB_APP_SMTP_HOST`, `MIN_KB_APP_SMTP_PORT`, and `MIN_KB_APP_SMTP_FROM` are configured. `MIN_KB_APP_SMTP_REPLY_TO` is optional and only sets the `Reply-To` header; it does not enable delivery by itself.

## The web app cannot reach a non-default runtime URL

For local dev, `vite` proxies `/api` to `http://localhost:8787`. For deployed or custom builds, set `VITE_API_BASE_URL` so the web app points at the correct runtime host.
