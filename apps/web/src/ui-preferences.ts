import {
  DEFAULT_CHAT_MODEL,
  DEFAULT_CHAT_PROVIDER,
  type ModelDescriptor,
} from "@min-kb-app/shared";

export type ThemePreference = "system" | "dark" | "light";
export type ResolvedTheme = "dark" | "light";

export interface UiPreferences {
  theme: ThemePreference;
  hiddenModelIds: string[];
  defaultChatProvider: string;
  defaultChatModelId: string;
  sidebarWidth: number;
  sidebarCollapsed: boolean;
}

export const DEFAULT_SIDEBAR_WIDTH = 320;
export const MIN_SIDEBAR_WIDTH = 260;
export const MAX_SIDEBAR_WIDTH = 460;

export function createDefaultUiPreferences(): UiPreferences {
  return {
    theme: "system",
    hiddenModelIds: [],
    defaultChatProvider: DEFAULT_CHAT_PROVIDER,
    defaultChatModelId: DEFAULT_CHAT_MODEL,
    sidebarWidth: DEFAULT_SIDEBAR_WIDTH,
    sidebarCollapsed: false,
  };
}

export function normalizeUiPreferences(
  raw?: Partial<UiPreferences> | null
): UiPreferences {
  const defaults = createDefaultUiPreferences();

  return {
    theme: isThemePreference(raw?.theme) ? raw.theme : defaults.theme,
    hiddenModelIds: Array.isArray(raw?.hiddenModelIds)
      ? [
          ...new Set(
            raw.hiddenModelIds.filter(
              (value): value is string => typeof value === "string"
            )
          ),
        ]
      : defaults.hiddenModelIds,
    defaultChatProvider:
      typeof raw?.defaultChatProvider === "string" &&
      raw.defaultChatProvider.trim().length > 0
        ? raw.defaultChatProvider.trim()
        : defaults.defaultChatProvider,
    defaultChatModelId:
      typeof raw?.defaultChatModelId === "string" &&
      raw.defaultChatModelId.trim().length > 0
        ? raw.defaultChatModelId.trim()
        : defaults.defaultChatModelId,
    sidebarWidth:
      typeof raw?.sidebarWidth === "number"
        ? clampSidebarWidth(raw.sidebarWidth)
        : defaults.sidebarWidth,
    sidebarCollapsed:
      typeof raw?.sidebarCollapsed === "boolean"
        ? raw.sidebarCollapsed
        : defaults.sidebarCollapsed,
  };
}

export function clampSidebarWidth(width: number): number {
  return Math.min(
    MAX_SIDEBAR_WIDTH,
    Math.max(MIN_SIDEBAR_WIDTH, Math.round(width))
  );
}

export function resolveTheme(
  preference: ThemePreference,
  prefersDark: boolean
): ResolvedTheme {
  return preference === "system"
    ? prefersDark
      ? "dark"
      : "light"
    : preference;
}

export function getVisibleModels(
  models: ModelDescriptor[],
  hiddenModelIds: string[],
  selectedModelId?: string
): ModelDescriptor[] {
  if (models.length === 0) {
    return [];
  }

  const hiddenModelSet = new Set(hiddenModelIds);
  const visibleModels = models.filter((model) => !hiddenModelSet.has(model.id));
  if (
    selectedModelId &&
    !visibleModels.some((model) => model.id === selectedModelId)
  ) {
    const selectedModel = models.find((model) => model.id === selectedModelId);
    if (selectedModel) {
      return [...visibleModels, selectedModel];
    }
  }

  return visibleModels.length > 0 ? visibleModels : models.slice(0, 1);
}

export function isLastVisibleModel(
  models: ModelDescriptor[],
  hiddenModelIds: string[],
  modelId: string
): boolean {
  const visibleModels = models.filter(
    (model) => !hiddenModelIds.includes(model.id)
  );
  return visibleModels.length === 1 && visibleModels[0]?.id === modelId;
}

function isThemePreference(value: unknown): value is ThemePreference {
  return value === "system" || value === "dark" || value === "light";
}
