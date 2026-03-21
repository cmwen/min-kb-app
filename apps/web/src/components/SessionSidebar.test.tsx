// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SessionSidebar } from "./SessionSidebar";

afterEach(() => {
  cleanup();
});

const SESSIONS = [
  {
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
  },
];

describe("SessionSidebar", () => {
  it("shows a notification dot for completed sessions until they are opened", () => {
    render(
      <SessionSidebar
        sessions={SESSIONS}
        notificationSessionIds={new Set(["session-1"])}
        onSelect={vi.fn()}
        onNewSession={() => undefined}
        onToggleCollapse={() => undefined}
      />
    );

    expect(
      screen.queryByLabelText("Session completed while you were away")
    ).not.toBeNull();
  });

  it("clears the notification dot for the selected session", () => {
    render(
      <SessionSidebar
        sessions={SESSIONS}
        notificationSessionIds={new Set(["session-1"])}
        selectedSessionId="session-1"
        onSelect={vi.fn()}
        onNewSession={() => undefined}
        onToggleCollapse={() => undefined}
      />
    );

    expect(
      screen.queryByLabelText("Session completed while you were away")
    ).toBeNull();
  });
});
