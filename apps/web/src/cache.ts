import type {
  AgentSummary,
  ChatRequest,
  ChatSession,
  ChatSessionSummary,
  ModelDescriptor,
  WorkspaceSummary,
} from "@min-kb-app/shared";
import {
  createDefaultUiPreferences,
  normalizeUiPreferences,
  type UiPreferences,
} from "./ui-preferences";

const SNAPSHOT_KEY = "min-kb-app:snapshot";
const QUEUE_KEY = "min-kb-app:queue";
const DRAFT_PREFIX = "min-kb-app:draft:";
const UI_PREFERENCES_KEY = "min-kb-app:ui-preferences";

export interface CachedSnapshot {
  workspace?: WorkspaceSummary;
  agents: AgentSummary[];
  models: ModelDescriptor[];
  sessionsByAgent: Record<string, ChatSessionSummary[]>;
  threadsByKey: Record<string, ChatSession>;
}

export interface QueuedMessage {
  id: string;
  agentId: string;
  sessionId?: string;
  title?: string;
  request: ChatRequest;
  createdAt: string;
}

export function loadSnapshot(): CachedSnapshot {
  const raw = localStorage.getItem(SNAPSHOT_KEY);
  if (!raw) {
    return {
      agents: [],
      models: [],
      sessionsByAgent: {},
      threadsByKey: {},
    };
  }

  try {
    return JSON.parse(raw) as CachedSnapshot;
  } catch {
    return {
      agents: [],
      models: [],
      sessionsByAgent: {},
      threadsByKey: {},
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
