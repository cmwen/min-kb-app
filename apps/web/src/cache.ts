import type {
  AgentSummary,
  ChatProviderDescriptor,
  ChatRequest,
  ChatRuntimeConfig,
  ChatSessionSummary,
  ModelDescriptor,
  WorkspaceSummary,
} from "@min-kb-app/shared";
import {
  chatRuntimeConfigSchema,
  DEFAULT_CHAT_MODEL,
  DEFAULT_CHAT_PROVIDER,
} from "@min-kb-app/shared";
import {
  normalizeSessionNotificationAcks,
  type SessionNotificationAcks,
} from "./session-notifications";
import {
  createDefaultUiPreferences,
  normalizeUiPreferences,
  type UiPreferences,
} from "./ui-preferences";

const SNAPSHOT_KEY = "min-kb-app:snapshot:v2";
const QUEUE_KEY = "min-kb-app:queue";
const DRAFT_PREFIX = "min-kb-app:draft:";
const UI_PREFERENCES_KEY = "min-kb-app:ui-preferences";
const SESSION_NOTIFICATION_ACKS_KEY = "min-kb-app:session-notification-acks";
const APP_STATE_KEY = "min-kb-app:app-state";

export interface CachedSnapshot {
  workspace?: WorkspaceSummary;
  agents: AgentSummary[];
  providers: ChatProviderDescriptor[];
  defaultProvider: string;
  models: ModelDescriptor[];
  sessionsByAgent: Record<string, ChatSessionSummary[]>;
}

export interface QueuedMessage {
  id: string;
  agentId: string;
  sessionId?: string;
  title?: string;
  request: ChatRequest;
  createdAt: string;
}

export interface CachedAppState {
  selectedAgentId?: string;
  selectedSessionId?: string;
  preferNewSession: boolean;
  draftConfig: ChatRuntimeConfig;
  draftMcpText: string;
}

export function loadSnapshot(): CachedSnapshot {
  const raw = localStorage.getItem(SNAPSHOT_KEY);
  if (!raw) {
    return {
      agents: [],
      providers: [],
      defaultProvider: DEFAULT_CHAT_PROVIDER,
      models: [],
      sessionsByAgent: {},
    };
  }

  try {
    const parsed = JSON.parse(raw) as Partial<CachedSnapshot>;
    return {
      agents: parsed.agents ?? [],
      providers: parsed.providers ?? [],
      defaultProvider: parsed.defaultProvider ?? DEFAULT_CHAT_PROVIDER,
      models: parsed.models ?? [],
      sessionsByAgent: parsed.sessionsByAgent ?? {},
      workspace: parsed.workspace,
    };
  } catch {
    return {
      agents: [],
      providers: [],
      defaultProvider: DEFAULT_CHAT_PROVIDER,
      models: [],
      sessionsByAgent: {},
    };
  }
}

export function saveSnapshot(snapshot: CachedSnapshot): void {
  localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(snapshot));
}

export function loadQueue(): QueuedMessage[] {
  const raw = localStorage.getItem(QUEUE_KEY);
  if (!raw) {
    return [];
  }

  try {
    return JSON.parse(raw) as QueuedMessage[];
  } catch {
    return [];
  }
}

export function saveQueue(queue: QueuedMessage[]): void {
  localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
}

export function loadDraft(key: string): string {
  return localStorage.getItem(`${DRAFT_PREFIX}${key}`) ?? "";
}

export function saveDraft(key: string, value: string): void {
  localStorage.setItem(`${DRAFT_PREFIX}${key}`, value);
}

export function clearDraft(key: string): void {
  localStorage.removeItem(`${DRAFT_PREFIX}${key}`);
}

export function loadUiPreferences(): UiPreferences {
  const raw = localStorage.getItem(UI_PREFERENCES_KEY);
  if (!raw) {
    return createDefaultUiPreferences();
  }

  try {
    return normalizeUiPreferences(JSON.parse(raw) as Partial<UiPreferences>);
  } catch {
    return createDefaultUiPreferences();
  }
}

export function saveUiPreferences(preferences: UiPreferences): void {
  localStorage.setItem(UI_PREFERENCES_KEY, JSON.stringify(preferences));
}

export function loadSessionNotificationAcks(): SessionNotificationAcks {
  const raw = localStorage.getItem(SESSION_NOTIFICATION_ACKS_KEY);
  if (!raw) {
    return {};
  }

  try {
    return normalizeSessionNotificationAcks(JSON.parse(raw));
  } catch {
    return {};
  }
}

export function saveSessionNotificationAcks(
  acknowledgements: SessionNotificationAcks
): void {
  localStorage.setItem(
    SESSION_NOTIFICATION_ACKS_KEY,
    JSON.stringify(acknowledgements)
  );
}

export function createDefaultAppState(): CachedAppState {
  return {
    preferNewSession: false,
    draftConfig: {
      provider: DEFAULT_CHAT_PROVIDER,
      model: DEFAULT_CHAT_MODEL,
      disabledSkills: [],
      mcpServers: {},
    },
    draftMcpText: JSON.stringify({}, null, 2),
  };
}

export function loadAppState(): CachedAppState {
  const raw = localStorage.getItem(APP_STATE_KEY);
  if (!raw) {
    return createDefaultAppState();
  }

  try {
    return normalizeAppState(JSON.parse(raw));
  } catch {
    return createDefaultAppState();
  }
}

export function saveAppState(state: CachedAppState): void {
  localStorage.setItem(APP_STATE_KEY, JSON.stringify(state));
}

function normalizeAppState(raw: unknown): CachedAppState {
  const defaults = createDefaultAppState();
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return defaults;
  }

  const candidate = raw as {
    selectedAgentId?: unknown;
    selectedSessionId?: unknown;
    preferNewSession?: unknown;
    draftConfig?: unknown;
    draftMcpText?: unknown;
  };
  const parsedConfig = chatRuntimeConfigSchema.safeParse(candidate.draftConfig);
  const draftConfig = parsedConfig.success
    ? parsedConfig.data
    : defaults.draftConfig;
  const preferNewSession =
    typeof candidate.preferNewSession === "boolean"
      ? candidate.preferNewSession
      : defaults.preferNewSession;

  return {
    selectedAgentId:
      typeof candidate.selectedAgentId === "string"
        ? candidate.selectedAgentId
        : undefined,
    selectedSessionId:
      !preferNewSession && typeof candidate.selectedSessionId === "string"
        ? candidate.selectedSessionId
        : undefined,
    preferNewSession,
    draftConfig,
    draftMcpText:
      typeof candidate.draftMcpText === "string"
        ? candidate.draftMcpText
        : JSON.stringify(draftConfig.mcpServers, null, 2),
  };
}
