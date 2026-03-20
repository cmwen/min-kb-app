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

The runtime first asks the GitHub Copilot SDK for the current model catalog. If that lookup fails, the app falls back to a bundled catalog so the selector is still usable.

If you expect more models than you see:

- confirm GitHub Copilot authentication for the local SDK environment
- restart the runtime host
- inspect runtime logs for model discovery warnings

## I cannot send a message

Check the composer footer and settings drawer:

- no agent selected means the send button stays disabled
- invalid MCP JSON blocks sending until the JSON parses again
- runtime/network failures queue the message for retry instead of silently dropping it

## I see queued messages

Queued messages mean the web UI could not reach the runtime while sending. Use the retry buttons in the queue banner after the runtime is back online.

## The settings drawer state feels wrong

The drawer open/closed state is stored locally in the browser under `min-kb-app:ui-preferences`. If the UI gets into a bad local state, clear that key or clear the app's site storage and reload.

## A session loads unexpected settings

Existing sessions load the runtime config saved in that session's `RUNTIME.json`. If an older session has unexpected model, reasoning, skills, or MCP values, inspect the saved file in the session directory.

## The web app cannot reach a non-default runtime URL

For local dev, `vite` proxies `/api` to `http://localhost:8787`. For deployed or custom builds, set `VITE_API_BASE_URL` so the web app points at the correct runtime host.
