interface NetworkConnectionLike {
  effectiveType?: string;
  saveData?: boolean;
}

export interface ReconnectCostHints {
  effectiveType?: "slow-2g" | "2g" | "3g" | "4g";
  saveData: boolean;
}

interface AdaptiveDelayInput extends ReconnectCostHints {
  attempt: number;
  pageVisible: boolean;
}

const VISIBLE_POLL_DELAY_MS = 30_000;
const HIDDEN_POLL_DELAY_MS = 120_000;
const VISIBLE_POLL_MAX_DELAY_MS = 180_000;
const HIDDEN_POLL_MAX_DELAY_MS = 600_000;
const VISIBLE_RECONNECT_DELAY_MS = 3_000;
const HIDDEN_RECONNECT_DELAY_MS = 20_000;
const VISIBLE_RECONNECT_MAX_DELAY_MS = 60_000;
const HIDDEN_RECONNECT_MAX_DELAY_MS = 300_000;

export function readReconnectCostHints(): ReconnectCostHints {
  if (typeof navigator === "undefined") {
    return {
      saveData: false,
    };
  }

  const connection = getNavigatorConnection(navigator);
  return {
    effectiveType: normalizeEffectiveType(connection?.effectiveType),
    saveData: connection?.saveData === true,
  };
}

export function getAdaptivePollDelayMs(input: AdaptiveDelayInput): number {
  return getAdaptiveDelayMs(input, {
    visibleBaseDelayMs: VISIBLE_POLL_DELAY_MS,
    hiddenBaseDelayMs: HIDDEN_POLL_DELAY_MS,
    visibleMaxDelayMs: VISIBLE_POLL_MAX_DELAY_MS,
    hiddenMaxDelayMs: HIDDEN_POLL_MAX_DELAY_MS,
  });
}

export function getAdaptiveReconnectDelayMs(input: AdaptiveDelayInput): number {
  return getAdaptiveDelayMs(input, {
    visibleBaseDelayMs: VISIBLE_RECONNECT_DELAY_MS,
    hiddenBaseDelayMs: HIDDEN_RECONNECT_DELAY_MS,
    visibleMaxDelayMs: VISIBLE_RECONNECT_MAX_DELAY_MS,
    hiddenMaxDelayMs: HIDDEN_RECONNECT_MAX_DELAY_MS,
  });
}

function getAdaptiveDelayMs(
  input: AdaptiveDelayInput,
  config: {
    visibleBaseDelayMs: number;
    hiddenBaseDelayMs: number;
    visibleMaxDelayMs: number;
    hiddenMaxDelayMs: number;
  }
): number {
  const baseDelayMs = input.pageVisible
    ? config.visibleBaseDelayMs
    : config.hiddenBaseDelayMs;
  const maxDelayMs = input.pageVisible
    ? config.visibleMaxDelayMs
    : config.hiddenMaxDelayMs;
  const backoffMultiplier = 2 ** Math.max(0, input.attempt);
  const costMultiplier = getCostMultiplier(input);
  return Math.min(baseDelayMs * backoffMultiplier * costMultiplier, maxDelayMs);
}

function getCostMultiplier(input: ReconnectCostHints): number {
  let multiplier = 1;
  if (input.saveData) {
    multiplier *= 2;
  }

  switch (input.effectiveType) {
    case "slow-2g":
    case "2g":
      multiplier *= 4;
      break;
    case "3g":
      multiplier *= 2;
      break;
    default:
      break;
  }

  return multiplier;
}

function normalizeEffectiveType(
  value: string | undefined
): ReconnectCostHints["effectiveType"] {
  switch (value) {
    case "slow-2g":
    case "2g":
    case "3g":
    case "4g":
      return value;
    default:
      return undefined;
  }
}

function getNavigatorConnection(
  value: Navigator
): NetworkConnectionLike | undefined {
  return (
    value as Navigator & {
      connection?: NetworkConnectionLike;
      mozConnection?: NetworkConnectionLike;
      webkitConnection?: NetworkConnectionLike;
    }
  ).connection;
}
