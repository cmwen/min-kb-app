import type { ModelInfo } from "@github/copilot-sdk";
import type { ModelDescriptor } from "@min-kb-app/shared";

export const FALLBACK_MODELS: ModelDescriptor[] = [
  {
    id: "claude-haiku-4.5",
    displayName: "Claude Haiku 4.5",
    provider: "Anthropic",
    supportedReasoningEfforts: [],
  },
  {
    id: "claude-opus-4.5",
    displayName: "Claude Opus 4.5",
    provider: "Anthropic",
    supportedReasoningEfforts: [],
  },
  {
    id: "claude-opus-4.6",
    displayName: "Claude Opus 4.6",
    provider: "Anthropic",
    supportedReasoningEfforts: [],
  },
  {
    id: "claude-sonnet-4",
    displayName: "Claude Sonnet 4",
    provider: "Anthropic",
    supportedReasoningEfforts: [],
  },
  {
    id: "claude-sonnet-4.5",
    displayName: "Claude Sonnet 4.5",
    provider: "Anthropic",
    supportedReasoningEfforts: [],
  },
  {
    id: "claude-sonnet-4.6",
    displayName: "Claude Sonnet 4.6",
    provider: "Anthropic",
    supportedReasoningEfforts: [],
  },
  {
    id: "gemini-2.5-pro",
    displayName: "Gemini 2.5 Pro",
    provider: "Google",
    supportedReasoningEfforts: [],
  },
  {
    id: "gemini-3-pro-preview",
    displayName: "Gemini 3 Pro (Preview)",
    provider: "Google",
    supportedReasoningEfforts: [],
  },
  {
    id: "gpt-4.1",
    displayName: "GPT-4.1",
    provider: "OpenAI",
    supportedReasoningEfforts: [],
  },
  {
    id: "gpt-5",
    displayName: "GPT-5",
    provider: "OpenAI",
    supportedReasoningEfforts: [],
  },
  {
    id: "gpt-5-mini",
    displayName: "GPT-5 mini",
    provider: "OpenAI",
    supportedReasoningEfforts: [],
  },
  {
    id: "gpt-5.1",
    displayName: "GPT-5.1",
    provider: "OpenAI",
    supportedReasoningEfforts: [],
  },
  {
    id: "gpt-5.1-codex",
    displayName: "GPT-5.1 Codex",
    provider: "OpenAI",
    supportedReasoningEfforts: [],
  },
  {
    id: "gpt-5.1-codex-max",
    displayName: "GPT-5.1 Codex Max",
    provider: "OpenAI",
    supportedReasoningEfforts: [],
  },
  {
    id: "gpt-5.1-codex-mini",
    displayName: "GPT-5.1 Codex Mini",
    provider: "OpenAI",
    supportedReasoningEfforts: [],
  },
  {
    id: "gpt-5.2",
    displayName: "GPT-5.2",
    provider: "OpenAI",
    supportedReasoningEfforts: [],
  },
  {
    id: "gpt-5.2-codex",
    displayName: "GPT-5.2 Codex",
    provider: "OpenAI",
    supportedReasoningEfforts: [],
  },
  {
    id: "gpt-5.3-codex",
    displayName: "GPT-5.3 Codex",
    provider: "OpenAI",
    supportedReasoningEfforts: [],
  },
  {
    id: "gpt-5.4",
    displayName: "GPT-5.4",
    provider: "OpenAI",
    supportedReasoningEfforts: [],
  },
  {
    id: "gpt-5.4-mini",
    displayName: "GPT-5.4 mini",
    provider: "OpenAI",
    supportedReasoningEfforts: [],
  },
];

export function mapModelInfoToDescriptor(model: ModelInfo): ModelDescriptor {
  return {
    id: model.id,
    displayName: model.name,
    provider: inferModelProvider(model.id),
    supportedReasoningEfforts: model.supportedReasoningEfforts ?? [],
    defaultReasoningEffort: model.defaultReasoningEffort,
  };
}

export function mergeModelCatalogs(
  ...catalogs: ModelDescriptor[][]
): ModelDescriptor[] {
  const byId = new Map<string, ModelDescriptor>();

  for (const catalog of catalogs) {
    for (const model of catalog) {
      const normalizedModel = normalizeModelDescriptor(model);
      const existing = byId.get(normalizedModel.id);
      byId.set(
        normalizedModel.id,
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

  if (modelId.startsWith("gpt-")) {
    return "OpenAI";
  }

  return undefined;
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
  const providerComparison = (left.provider ?? "").localeCompare(
    right.provider ?? ""
  );
  if (providerComparison !== 0) {
    return providerComparison;
  }

  return left.displayName.localeCompare(right.displayName);
}
