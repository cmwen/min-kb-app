import type {
  ChatRuntimeConfig,
  ModelDescriptor,
  ReasoningEffort,
} from "@min-kb-app/shared";

export function findModelDescriptor(
  models: ModelDescriptor[],
  modelId: string
): ModelDescriptor | undefined {
  return models.find((model) => model.id === modelId);
}

export function normalizeConfigForModel(
  config: ChatRuntimeConfig,
  models: ModelDescriptor[]
): ChatRuntimeConfig {
  if (!config.reasoningEffort || models.length === 0) {
    return config;
  }

  const model = findModelDescriptor(models, config.model);
  if (!model) {
    return config;
  }

  if (model.supportedReasoningEfforts.includes(config.reasoningEffort)) {
    return config;
  }

  return {
    ...config,
    reasoningEffort: undefined,
  };
}

export function formatReasoningEffort(
  reasoningEffort: ReasoningEffort
): string {
  return reasoningEffort === "xhigh"
    ? "Extra high"
    : reasoningEffort.charAt(0).toUpperCase() + reasoningEffort.slice(1);
}
