const DEFAULT_RUNTIME_PORT = 8787;
const DEFAULT_STARTUP_TIMEOUT_MS = 60_000;
const HEALTH_CHECK_INTERVAL_MS = 250;

const runtimeBaseUrl =
  process.env.MIN_KB_APP_RUNTIME_URL ??
  `http://localhost:${process.env.MIN_KB_APP_PORT ?? DEFAULT_RUNTIME_PORT}`;
const healthUrl = new URL("api/health", ensureTrailingSlash(runtimeBaseUrl));
const timeoutMs = Number(
  process.env.MIN_KB_APP_RUNTIME_STARTUP_TIMEOUT_MS ??
    DEFAULT_STARTUP_TIMEOUT_MS
);

if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
  throw new Error(
    "MIN_KB_APP_RUNTIME_STARTUP_TIMEOUT_MS must be a positive number when set."
  );
}

console.log(`Waiting for runtime health at ${healthUrl.toString()}...`);

const deadline = Date.now() + timeoutMs;
let lastFailure;

while (Date.now() < deadline) {
  try {
    const response = await fetch(healthUrl, {
      headers: {
        accept: "application/json",
      },
    });
    if (response.ok) {
      console.log(`Runtime healthy at ${healthUrl.origin}. Starting web UI.`);
      process.exit(0);
    }
    lastFailure = new Error(`HTTP ${response.status}`);
  } catch (error) {
    lastFailure = error;
  }

  await delay(HEALTH_CHECK_INTERVAL_MS);
}

const failureMessage =
  lastFailure instanceof Error ? lastFailure.message : String(lastFailure);
throw new Error(
  `Timed out waiting for runtime health at ${healthUrl.toString()} after ${timeoutMs}ms: ${failureMessage}`
);

function ensureTrailingSlash(value) {
  return value.endsWith("/") ? value : `${value}/`;
}

function delay(durationMs) {
  return new Promise((resolve) => {
    setTimeout(resolve, durationMs);
  });
}
