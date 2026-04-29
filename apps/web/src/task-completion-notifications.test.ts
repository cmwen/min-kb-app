import { describe, expect, it } from "vitest";
import { getSessionNotificationKey } from "./session-notifications";
import { evaluateCompletionNotifications } from "./task-completion-notifications";
import { createDefaultCompletionNotificationPreferences } from "./ui-preferences";

const RUNNING_SESSION = {
  sessionId: "session-1",
  agentId: "copilot-orchestrator",
  title: "Release support",
  startedAt: "2026-04-27T10:00:00Z",
  summary: "Ship the release",
  manifestPath: "/tmp/session-1/SESSION.md",
  turnCount: 1,
  lastTurnAt: "2026-04-27T10:01:00Z",
  completionStatus: undefined,
} as const;

describe("task completion notifications", () => {
  it("does not notify the first time a completed session is observed", () => {
    const evaluation = evaluateCompletionNotifications({
      sessionsByAgent: {
        "copilot-orchestrator": [
          {
            ...RUNNING_SESSION,
            lastTurnAt: "2026-04-27T10:05:00Z",
            completionStatus: "completed",
          },
        ],
      },
      observedCompletions: {},
      deliveredCompletions: {},
      preferences: createDefaultCompletionNotificationPreferences(),
      selectedAgentId: "support-agent",
      selectedSessionId: "session-2",
      pageVisible: false,
      windowFocused: false,
    });

    expect(evaluation.notifications).toHaveLength(0);
    expect(
      evaluation.nextObservedCompletions[
        getSessionNotificationKey("copilot-orchestrator", "session-1")
      ]
    ).toBe("2026-04-27T10:05:00Z");
  });

  it("notifies when a long-running task completes while the user is elsewhere", () => {
    const evaluation = evaluateCompletionNotifications({
      sessionsByAgent: {
        "copilot-orchestrator": [
          {
            ...RUNNING_SESSION,
            lastTurnAt: "2026-04-27T10:05:00Z",
            completionStatus: "completed" as const,
          },
        ],
      },
      observedCompletions: {
        [getSessionNotificationKey("copilot-orchestrator", "session-1")]: null,
      },
      deliveredCompletions: {},
      preferences: createDefaultCompletionNotificationPreferences(),
      selectedAgentId: "support-agent",
      selectedSessionId: "session-2",
      pageVisible: true,
      windowFocused: true,
    });

    expect(evaluation.notifications).toEqual([
      expect.objectContaining({
        agentId: "copilot-orchestrator",
        sessionId: "session-1",
        title: "Release support completed",
      }),
    ]);
  });

  it("skips notifications for the active visible session", () => {
    const evaluation = evaluateCompletionNotifications({
      sessionsByAgent: {
        "copilot-orchestrator": [
          {
            ...RUNNING_SESSION,
            lastTurnAt: "2026-04-27T10:05:00Z",
            completionStatus: "completed" as const,
          },
        ],
      },
      observedCompletions: {
        [getSessionNotificationKey("copilot-orchestrator", "session-1")]: null,
      },
      deliveredCompletions: {},
      preferences: createDefaultCompletionNotificationPreferences(),
      selectedAgentId: "copilot-orchestrator",
      selectedSessionId: "session-1",
      pageVisible: true,
      windowFocused: true,
    });

    expect(evaluation.notifications).toHaveLength(0);
  });

  it("respects per-agent disables, duration thresholds, and delivered timestamps", () => {
    const completedAt = "2026-04-27T10:05:00Z";
    const preferences = createDefaultCompletionNotificationPreferences();
    preferences.disabledAgentIds = ["copilot-orchestrator"];

    const evaluation = evaluateCompletionNotifications({
      sessionsByAgent: {
        "copilot-orchestrator": [
          {
            ...RUNNING_SESSION,
            startedAt: "2026-04-27T10:04:30Z",
            lastTurnAt: completedAt,
            completionStatus: "completed" as const,
          },
        ],
      },
      observedCompletions: {
        [getSessionNotificationKey("copilot-orchestrator", "session-1")]: null,
      },
      deliveredCompletions: {
        [getSessionNotificationKey("copilot-orchestrator", "session-1")]:
          completedAt,
      },
      preferences,
      selectedAgentId: "support-agent",
      selectedSessionId: "session-2",
      pageVisible: false,
      windowFocused: false,
    });

    expect(evaluation.notifications).toHaveLength(0);
  });
});
