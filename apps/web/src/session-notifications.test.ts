import { describe, expect, it } from "vitest";
import {
  acknowledgeSessionNotification,
  hasSessionNotification,
  listAgentNotificationIds,
  listSessionNotificationIds,
} from "./session-notifications";

const COMPLETED_SESSION = {
  sessionId: "session-1",
  agentId: "copilot-orchestrator",
  title: "Release support",
  startedAt: "2026-03-20T12:00:00Z",
  summary: "Ship the release",
  manifestPath:
    "agents/copilot-orchestrator/history/2026-03/session-1/SESSION.md",
  turnCount: 3,
  lastTurnAt: "2026-03-20T12:05:00Z",
  completionStatus: "completed" as const,
};

describe("session notifications", () => {
  it("shows a notification until the completed session is acknowledged", () => {
    expect(hasSessionNotification(COMPLETED_SESSION, {})).toBe(true);

    const acknowledgements = acknowledgeSessionNotification(
      COMPLETED_SESSION,
      {}
    );

    expect(hasSessionNotification(COMPLETED_SESSION, acknowledgements)).toBe(
      false
    );
  });

  it("re-opens the notification when a later completion timestamp arrives", () => {
    const acknowledgements = acknowledgeSessionNotification(
      COMPLETED_SESSION,
      {}
    );
    const updatedSession = {
      ...COMPLETED_SESSION,
      lastTurnAt: "2026-03-20T12:10:00Z",
    };

    expect(hasSessionNotification(updatedSession, acknowledgements)).toBe(true);
  });

  it("ignores sessions without a completion status", () => {
    expect(
      hasSessionNotification(
        {
          ...COMPLETED_SESSION,
          completionStatus: undefined,
        },
        {}
      )
    ).toBe(false);
  });

  it("lists the sessions with pending notifications", () => {
    expect(
      listSessionNotificationIds(
        [
          COMPLETED_SESSION,
          {
            ...COMPLETED_SESSION,
            sessionId: "session-2",
            completionStatus: undefined,
          },
        ],
        {}
      )
    ).toEqual(new Set(["session-1"]));
  });

  it("lists the agents with pending notifications", () => {
    expect(
      listAgentNotificationIds(
        {
          "copilot-orchestrator": [COMPLETED_SESSION],
          "support-agent": [
            {
              ...COMPLETED_SESSION,
              agentId: "support-agent",
              sessionId: "session-2",
              completionStatus: undefined,
            },
          ],
        },
        {}
      )
    ).toEqual(new Set(["copilot-orchestrator"]));
  });
});
