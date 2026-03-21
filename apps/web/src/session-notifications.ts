import type { ChatSessionSummary } from "@min-kb-app/shared";

export type SessionNotificationAcks = Record<string, string>;

export function normalizeSessionNotificationAcks(
  value: unknown
): SessionNotificationAcks {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string"
    )
  );
}

export function hasSessionNotification(
  session: ChatSessionSummary,
  acknowledgements: SessionNotificationAcks
): boolean {
  const completedAt = getSessionCompletionTimestamp(session);
  if (!completedAt) {
    return false;
  }

  const acknowledgedAt =
    acknowledgements[
      getSessionNotificationKey(session.agentId, session.sessionId)
    ];
  return isMoreRecentTimestamp(completedAt, acknowledgedAt);
}

export function listSessionNotificationIds(
  sessions: readonly ChatSessionSummary[],
  acknowledgements: SessionNotificationAcks
): Set<string> {
  return new Set(
    sessions
      .filter((session) => hasSessionNotification(session, acknowledgements))
      .map((session) => session.sessionId)
  );
}

export function listAgentNotificationIds(
  sessionsByAgent: Readonly<Record<string, readonly ChatSessionSummary[]>>,
  acknowledgements: SessionNotificationAcks
): Set<string> {
  return new Set(
    Object.entries(sessionsByAgent)
      .filter(([, sessions]) =>
        sessions.some((session) =>
          hasSessionNotification(session, acknowledgements)
        )
      )
      .map(([agentId]) => agentId)
  );
}

export function acknowledgeSessionNotification(
  session: ChatSessionSummary,
  acknowledgements: SessionNotificationAcks
): SessionNotificationAcks {
  const completedAt = getSessionCompletionTimestamp(session);
  if (!completedAt) {
    return acknowledgements;
  }

  const key = getSessionNotificationKey(session.agentId, session.sessionId);
  if (acknowledgements[key] === completedAt) {
    return acknowledgements;
  }

  return {
    ...acknowledgements,
    [key]: completedAt,
  };
}

export function getSessionNotificationKey(
  agentId: string,
  sessionId: string
): string {
  return `${agentId}:${sessionId}`;
}

function getSessionCompletionTimestamp(
  session: ChatSessionSummary
): string | undefined {
  if (!session.completionStatus) {
    return undefined;
  }

  return session.lastTurnAt ?? session.startedAt;
}

function isMoreRecentTimestamp(
  timestamp: string,
  comparisonTimestamp?: string
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
