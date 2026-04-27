import type { ModelInfo } from "@github/copilot-sdk";
import type {
  ChatProviderDescriptor,
  ChatRuntimeConfig,
  ModelDescriptor,
} from "@min-kb-app/shared";

export const COPILOT_RUNTIME_PROVIDER = {
  id: "copilot",
  displayName: "GitHub Copilot",
  description:
    "Uses the GitHub Copilot runtime with skills, MCP, and reasoning controls.",
  capabilities: {
    supportsReasoningEffort: true,
    supportsSkills: true,
    supportsMcpServers: true,
  },
} satisfies ChatProviderDescriptor;

export const LM_STUDIO_RUNTIME_PROVIDER = {
  id: "lmstudio",
  displayName: "LM Studio",
  description:
    "Uses LM Studio's local OpenAI-compatible API with prompt-backed skills for slower local models.",
  capabilities: {
    supportsReasoningEffort: false,
    supportsSkills: true,
    supportsMcpServers: false,
  },
} satisfies ChatProviderDescriptor;

export const GEMINI_RUNTIME_PROVIDER = {
  id: "gemini",
  displayName: "Gemini SDK",
  description:
    "Uses Google's official Gemini SDK with prompt-backed skills and server-side API credentials.",
  capabilities: {
    supportsReasoningEffort: false,
    supportsSkills: true,
    supportsMcpServers: false,
  },
} satisfies ChatProviderDescriptor;

export const RUNTIME_PROVIDERS: ChatProviderDescriptor[] = [
  COPILOT_RUNTIME_PROVIDER,
  GEMINI_RUNTIME_PROVIDER,
  LM_STUDIO_RUNTIME_PROVIDER,
];

export const FALLBACK_MODELS: ModelDescriptor[] = [
  {
    id: "claude-haiku-4.5",
    displayName: "Claude Haiku 4.5",
    runtimeProvider: COPILOT_RUNTIME_PROVIDER.id,
    provider: "Anthropic",
    premiumRequestMultiplier: 0.33,
    supportedReasoningEfforts: [],
  },
  {
    id: "claude-sonnet-4",
    displayName: "Claude Sonnet 4",
    runtimeProvider: COPILOT_RUNTIME_PROVIDER.id,
    provider: "Anthropic",
    premiumRequestMultiplier: 1,
    supportedReasoningEfforts: [],
  },
  {
    id: "claude-sonnet-4.5",
    displayName: "Claude Sonnet 4.5",
    runtimeProvider: COPILOT_RUNTIME_PROVIDER.id,
    provider: "Anthropic",
    premiumRequestMultiplier: 1,
    supportedReasoningEfforts: [],
  },
  {
    id: "claude-sonnet-4.6",
    displayName: "Claude Sonnet 4.6",
    runtimeProvider: COPILOT_RUNTIME_PROVIDER.id,
    provider: "Anthropic",
    premiumRequestMultiplier: 1,
    supportedReasoningEfforts: [],
  },
  {
    id: "gpt-4.1",
    displayName: "GPT-4.1",
    runtimeProvider: COPILOT_RUNTIME_PROVIDER.id,
    provider: "OpenAI",
    premiumRequestMultiplier: 0,
    supportedReasoningEfforts: [],
  },
  {
    id: "gpt-5-mini",
    displayName: "GPT-5 mini",
    runtimeProvider: COPILOT_RUNTIME_PROVIDER.id,
    provider: "OpenAI",
    premiumRequestMultiplier: 0,
    supportedReasoningEfforts: [],
  },
  {
    id: "gpt-5.2",
    displayName: "GPT-5.2",
    runtimeProvider: COPILOT_RUNTIME_PROVIDER.id,
    provider: "OpenAI",
    premiumRequestMultiplier: 1,
    supportedReasoningEfforts: [],
  },
  {
    id: "gpt-5.2-codex",
    displayName: "GPT-5.2 Codex",
    runtimeProvider: COPILOT_RUNTIME_PROVIDER.id,
    provider: "OpenAI",
    premiumRequestMultiplier: 1,
    supportedReasoningEfforts: [],
  },
  {
    id: "gpt-5.3-codex",
    displayName: "GPT-5.3 Codex",
    runtimeProvider: COPILOT_RUNTIME_PROVIDER.id,
    provider: "OpenAI",
    premiumRequestMultiplier: 1,
    supportedReasoningEfforts: [],
  },
  {
    id: "gpt-5.4",
    displayName: "GPT-5.4",
    runtimeProvider: COPILOT_RUNTIME_PROVIDER.id,
    provider: "OpenAI",
    premiumRequestMultiplier: 1,
    supportedReasoningEfforts: [],
  },
  {
    id: "gpt-5.4-mini",
    displayName: "GPT-5.4 mini",
    runtimeProvider: COPILOT_RUNTIME_PROVIDER.id,
    provider: "OpenAI",
    premiumRequestMultiplier: 0.33,
    supportedReasoningEfforts: [],
  },
  {
    id: "gemini-3-flash-preview",
    displayName: "Gemini 3 Flash (Preview)",
    runtimeProvider: GEMINI_RUNTIME_PROVIDER.id,
    provider: "Google",
    supportedReasoningEfforts: [],
  },
  {
    id: "gemini-3.1-pro-preview",
    displayName: "Gemini 3.1 Pro (Preview)",
    runtimeProvider: GEMINI_RUNTIME_PROVIDER.id,
    provider: "Google",
    supportedReasoningEfforts: [],
  },
  {
    id: "gemini-2.5-flash",
    displayName: "Gemini 2.5 Flash",
    runtimeProvider: GEMINI_RUNTIME_PROVIDER.id,
    provider: "Google",
    supportedReasoningEfforts: [],
  },
  {
    id: "gemini-2.5-pro",
    displayName: "Gemini 2.5 Pro",
    runtimeProvider: GEMINI_RUNTIME_PROVIDER.id,
    provider: "Google",
    supportedReasoningEfforts: [],
  },
];

interface LmStudioModelInfo {
  id: string;
  owned_by?: string;
}

interface GeminiModelInfo {
  name?: string;
  displayName?: string;
}

export function mapModelInfoToDescriptor(
  model: ModelInfo,
  runtimeProvider = COPILOT_RUNTIME_PROVIDER.id
): ModelDescriptor {
  return {
    id: model.id,
    displayName: model.name,
    runtimeProvider,
    provider: inferModelProvider(model.id),
    premiumRequestMultiplier: model.billing?.multiplier,
    supportedReasoningEfforts: model.supportedReasoningEfforts ?? [],
    defaultReasoningEffort: model.defaultReasoningEffort,
  };
}

export function mapLmStudioModelToDescriptor(
  model: LmStudioModelInfo
): ModelDescriptor {
  return {
    id: model.id,
    displayName: model.id,
    runtimeProvider: LM_STUDIO_RUNTIME_PROVIDER.id,
    provider:
      model.owned_by && model.owned_by !== "organization-owner"
        ? model.owned_by
        : undefined,
    supportedReasoningEfforts: [],
  };
}

export function mapGeminiModelToDescriptor(
  model: GeminiModelInfo
): ModelDescriptor | undefined {
  const normalizedId = normalizeGeminiModelName(model.name);
  if (!normalizedId) {
    return undefined;
  }

  return {
    id: normalizedId,
    displayName: model.displayName?.trim() || normalizedId,
    runtimeProvider: GEMINI_RUNTIME_PROVIDER.id,
    provider: "Google",
    supportedReasoningEfforts: [],
  };
}

export function findModelDescriptor(
  models: ModelDescriptor[],
  modelId: string,
  runtimeProvider?: string
): ModelDescriptor | undefined {
  return models.find(
    (model) =>
      model.id === modelId &&
      (runtimeProvider === undefined ||
        model.runtimeProvider === runtimeProvider)
  );
}

export function getModelsForProvider(
  models: ModelDescriptor[],
  runtimeProvider: string
): ModelDescriptor[] {
  return models.filter((model) => model.runtimeProvider === runtimeProvider);
}

export function normalizeConfigForModel(
  config: ChatRuntimeConfig,
  models: ModelDescriptor[]
): ChatRuntimeConfig {
  const provider = config.provider.trim();
  const providerModels = getModelsForProvider(models, provider);
  const selectedModel =
    findModelDescriptor(providerModels, config.model, provider) ??
    providerModels[0];
  const normalizedConfig: ChatRuntimeConfig = {
    ...config,
    provider,
    model: selectedModel?.id ?? config.model,
  };

  if (!normalizedConfig.reasoningEffort) {
    return normalizedConfig;
  }

  if (
    !selectedModel?.supportedReasoningEfforts.includes(
      normalizedConfig.reasoningEffort
    )
  ) {
    return {
      ...normalizedConfig,
      reasoningEffort: undefined,
    };
  }

  return normalizedConfig;
}

export function mergeModelCatalogs(
  ...catalogs: ModelDescriptor[][]
): ModelDescriptor[] {
  const byId = new Map<string, ModelDescriptor>();

  for (const catalog of catalogs) {
    for (const model of catalog) {
      const normalizedModel = normalizeModelDescriptor(model);
      const existing = byId.get(
        buildModelKey(normalizedModel.id, normalizedModel.runtimeProvider)
      );
      byId.set(
        buildModelKey(normalizedModel.id, normalizedModel.runtimeProvider),
        existing
          ? mergeModelDescriptors(existing, normalizedModel)
          : normalizedModel
      );
    }
  }

  return [...byId.values()].sort(compareModelDescriptors);
}

export function inferModelProvider(modelId: string): string | undefined {
  if (modelId.startsWith("claude-")) {
    return "Anthropic";
  }

  if (modelId.startsWith("gemini-")) {
    return "Google";
  }

  if (modelId.startsWith("grok-")) {
    return "xAI";
  }

  if (modelId.startsWith("gpt-")) {
    return "OpenAI";
  }

  return undefined;
}

function buildModelKey(modelId: string, runtimeProvider: string): string {
  return `${runtimeProvider}:${modelId}`;
}

function mergeModelDescriptors(
  existing: ModelDescriptor,
  incoming: ModelDescriptor
): ModelDescriptor {
  return normalizeModelDescriptor({
    ...existing,
    ...incoming,
    displayName: incoming.displayName || existing.displayName,
    provider: incoming.provider ?? existing.provider,
    supportedReasoningEfforts: [
      ...existing.supportedReasoningEfforts,
      ...incoming.supportedReasoningEfforts,
    ],
    premiumRequestMultiplier:
      incoming.premiumRequestMultiplier ?? existing.premiumRequestMultiplier,
    defaultReasoningEffort:
      incoming.defaultReasoningEffort ?? existing.defaultReasoningEffort,
  });
}

function normalizeModelDescriptor(model: ModelDescriptor): ModelDescriptor {
  return {
    ...model,
    provider: model.provider ?? inferModelProvider(model.id),
    supportedReasoningEfforts: [
      ...new Set(model.supportedReasoningEfforts),
    ].sort(),
  };
}

function compareModelDescriptors(
  left: ModelDescriptor,
  right: ModelDescriptor
): number {
  const runtimeProviderComparison = left.runtimeProvider.localeCompare(
    right.runtimeProvider
  );
  if (runtimeProviderComparison !== 0) {
    return runtimeProviderComparison;
  }

  const providerComparison = (left.provider ?? "").localeCompare(
    right.provider ?? ""
  );
  if (providerComparison !== 0) {
    return providerComparison;
  }

  return left.displayName.localeCompare(right.displayName);
}

function normalizeGeminiModelName(
  name: string | undefined
): string | undefined {
  const trimmed = name?.trim();
  if (!trimmed) {
    return undefined;
  }

  if (trimmed.startsWith("models/")) {
    return trimmed.slice("models/".length);
  }

  if (trimmed.startsWith("publishers/")) {
    const parts = trimmed.split("/");
    return parts.at(-1);
  }

  if (trimmed.startsWith("projects/")) {
    const parts = trimmed.split("/");
    return parts.at(-1);
  }

  return trimmed;
}
