import type { ChatSessionSummary } from "@min-kb-app/shared";
import { getSessionNotificationKey } from "./session-notifications";
import type { CompletionNotificationPreferences } from "./ui-preferences";

export type CompletionObservationState = Record<string, string | null>;
export type CompletionNotificationDeliveries = Record<string, string>;
export type BrowserNotificationPermission =
  | NotificationPermission
  | "unsupported";

export interface CompletionNotificationItem {
  key: string;
  agentId: string;
  sessionId: string;
  title: string;
  body: string;
  tag: string;
  completedAt: string;
}

interface EvaluateCompletionNotificationsInput {
  sessionsByAgent: Readonly<Record<string, readonly ChatSessionSummary[]>>;
  observedCompletions: CompletionObservationState;
  deliveredCompletions: CompletionNotificationDeliveries;
  preferences: CompletionNotificationPreferences;
  selectedAgentId?: string;
  selectedSessionId?: string;
  pageVisible: boolean;
  windowFocused: boolean;
}

interface EvaluateCompletionNotificationsResult {
  notifications: CompletionNotificationItem[];
  nextObservedCompletions: CompletionObservationState;
}

export function evaluateCompletionNotifications(
  input: EvaluateCompletionNotificationsInput
): EvaluateCompletionNotificationsResult {
  const notifications: CompletionNotificationItem[] = [];
  const nextObservedCompletions: CompletionObservationState = {};

  for (const sessions of Object.values(input.sessionsByAgent)) {
    for (const session of sessions) {
      const key = getSessionNotificationKey(session.agentId, session.sessionId);
      const completedAt = getCompletionTimestamp(session);

      if (!completedAt) {
        nextObservedCompletions[key] = null;
        continue;
      }

      nextObservedCompletions[key] = completedAt;
      const previousCompletion = input.observedCompletions[key];

      if (previousCompletion === undefined) {
        continue;
      }

      if (
        previousCompletion !== null &&
        !isMoreRecentTimestamp(completedAt, previousCompletion)
      ) {
        continue;
      }

      if (
        !input.preferences.enabled ||
        input.preferences.disabledAgentIds.includes(session.agentId)
      ) {
        continue;
      }

      if (!isLongRunningCompletion(session, input.preferences)) {
        continue;
      }

      const isSelectedSession =
        session.agentId === input.selectedAgentId &&
        session.sessionId === input.selectedSessionId;
      if (isSelectedSession && input.pageVisible && input.windowFocused) {
        continue;
      }

      if (
        !isMoreRecentTimestamp(completedAt, input.deliveredCompletions[key])
      ) {
        continue;
      }

      notifications.push(buildCompletionNotification(session, completedAt));
    }
  }

  return { notifications, nextObservedCompletions };
}

export async function deliverCompletionNotification(
  notification: CompletionNotificationItem
): Promise<boolean> {
  if (getBrowserNotificationPermission() !== "granted") {
    return false;
  }

  const registration = await getServiceWorkerRegistration();
  if (registration) {
    await registration.showNotification(notification.title, {
      body: notification.body,
      tag: notification.tag,
      data: {
        agentId: notification.agentId,
        sessionId: notification.sessionId,
      },
    });
    return true;
  }

  if (typeof Notification === "undefined") {
    return false;
  }

  const instance = new Notification(notification.title, {
    body: notification.body,
    tag: notification.tag,
  });
  instance.onclick = () => window.focus();
  return true;
}

export function getBrowserNotificationPermission(): BrowserNotificationPermission {
  if (typeof Notification === "undefined") {
    return "unsupported";
  }

  return Notification.permission;
}

export async function requestBrowserNotificationPermission(): Promise<BrowserNotificationPermission> {
  if (typeof Notification === "undefined") {
    return "unsupported";
  }

  return Notification.requestPermission();
}

function buildCompletionNotification(
  session: ChatSessionSummary,
  completedAt: string
): CompletionNotificationItem {
  const statusLabel =
    session.completionStatus === "failed" ? "failed" : "completed";
  const durationMinutes = formatDurationMinutes(session, completedAt);

  return {
    key: getSessionNotificationKey(session.agentId, session.sessionId),
    agentId: session.agentId,
    sessionId: session.sessionId,
    completedAt,
    tag: `completion:${session.agentId}:${session.sessionId}`,
    title:
      session.completionStatus === "failed"
        ? `${session.title} failed`
        : `${session.title} completed`,
    body: `${session.agentId} ${statusLabel} after ${durationMinutes}.`,
  };
}

function isLongRunningCompletion(
  session: ChatSessionSummary,
  preferences: CompletionNotificationPreferences
): boolean {
  const durationMs = getCompletionDurationMs(session);
  if (durationMs === undefined) {
    return false;
  }

  return durationMs >= preferences.minimumDurationMinutes * 60 * 1_000;
}

function formatDurationMinutes(
  session: ChatSessionSummary,
  completedAt: string
): string {
  const startedAt = Date.parse(session.startedAt);
  const completedTimestamp = Date.parse(completedAt);
  if (Number.isNaN(startedAt) || Number.isNaN(completedTimestamp)) {
    return "a long run";
  }

  const totalMinutes = Math.max(
    1,
    Math.round((completedTimestamp - startedAt) / 60_000)
  );
  return totalMinutes === 1 ? "1 minute" : `${totalMinutes} minutes`;
}

function getCompletionDurationMs(
  session: ChatSessionSummary
): number | undefined {
  const completedAt = getCompletionTimestamp(session);
  if (!completedAt) {
    return undefined;
  }

  const startedAt = Date.parse(session.startedAt);
  const completedTimestamp = Date.parse(completedAt);
  if (Number.isNaN(startedAt) || Number.isNaN(completedTimestamp)) {
    return undefined;
  }

  return Math.max(0, completedTimestamp - startedAt);
}

function getCompletionTimestamp(
  session: ChatSessionSummary
): string | undefined {
  if (!session.completionStatus) {
    return undefined;
  }

  return session.lastTurnAt ?? session.startedAt;
}

function isMoreRecentTimestamp(
  timestamp: string,
  comparisonTimestamp?: string | null
): boolean {
  if (!comparisonTimestamp) {
    return true;
  }

  const parsedTimestamp = Date.parse(timestamp);
  const parsedComparison = Date.parse(comparisonTimestamp);
  if (!Number.isNaN(parsedTimestamp) && !Number.isNaN(parsedComparison)) {
    return parsedTimestamp > parsedComparison;
  }

  return timestamp !== comparisonTimestamp;
}

async function getServiceWorkerRegistration(): Promise<
  ServiceWorkerRegistration | undefined
> {
  if (
    typeof navigator === "undefined" ||
    !("serviceWorker" in navigator) ||
    !navigator.serviceWorker
  ) {
    return undefined;
  }

  return navigator.serviceWorker.ready;
}
