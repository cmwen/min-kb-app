import type {
  ChatProviderDescriptor,
  ChatRuntimeConfig,
  ModelDescriptor,
  ReasoningEffort,
} from "@min-kb-app/shared";
import { DEFAULT_CHAT_PROVIDER } from "@min-kb-app/shared";

export function findProviderDescriptor(
  providers: ChatProviderDescriptor[],
  providerId: string
): ChatProviderDescriptor | undefined {
  return providers.find((provider) => provider.id === providerId);
}

export function getModelsForProvider(
  models: ModelDescriptor[],
  providerId: string
): ModelDescriptor[] {
  return models.filter((model) => model.runtimeProvider === providerId);
}

export function findModelDescriptor(
  models: ModelDescriptor[],
  modelId: string,
  providerId?: string
): ModelDescriptor | undefined {
  return models.find(
    (model) =>
      model.id === modelId &&
      (providerId === undefined || model.runtimeProvider === providerId)
  );
}

export function normalizeConfigForModel(
  config: ChatRuntimeConfig,
  models: ModelDescriptor[]
): ChatRuntimeConfig {
  const provider = config.provider || DEFAULT_CHAT_PROVIDER;
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
    !selectedModel ||
    !selectedModel.supportedReasoningEfforts.includes(
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

export function formatReasoningEffort(
  reasoningEffort: ReasoningEffort
): string {
  return reasoningEffort === "xhigh"
    ? "Extra high"
    : reasoningEffort.charAt(0).toUpperCase() + reasoningEffort.slice(1);
}
