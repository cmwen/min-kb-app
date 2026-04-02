// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SchedulePane } from "./SchedulePane";

afterEach(() => {
  cleanup();
});

const CHAT_AGENT = {
  id: "support-agent",
  kind: "chat" as const,
  title: "Support agent",
  description: "Helps with support work.",
  combinedPrompt: "Be helpful.",
  agentPath: "/tmp/agents/support-agent/AGENT.md",
  defaultSoulPath: "/tmp/agents/default/SOUL.md",
  historyRoot: "/tmp/agents/support-agent/history",
  workingMemoryRoot: "/tmp/agents/support-agent/memory/working",
  skillRoot: "/tmp/agents/support-agent/skills",
  skillNames: ["email-report"],
  sessionCount: 1,
};

describe("SchedulePane", () => {
  it("creates a scheduled chat task from the empty state", async () => {
    const user = userEvent.setup();
    const onCreateTask = vi.fn();

    render(
      <SchedulePane
        chatAgents={[CHAT_AGENT]}
        orchestratorSessions={[]}
        pending={false}
        onCreateTask={onCreateTask}
        onUpdateTask={() => undefined}
        onDeleteTask={() => undefined}
        onRunNow={() => undefined}
        onOpenTarget={() => undefined}
      />
    );

    await user.click(screen.getByRole("button", { name: "New schedule" }));
    await user.type(screen.getByLabelText("Schedule title"), "Daily digest");
    await user.type(
      screen.getByPlaceholderText(
        "Review the latest project activity and summarize what matters most."
      ),
      "Summarize the latest support activity."
    );
    await user.click(screen.getByRole("button", { name: "Create schedule" }));

    expect(onCreateTask).toHaveBeenCalledWith({
      targetKind: "chat",
      agentId: "support-agent",
      orchestratorSessionId: undefined,
      title: "Daily digest",
      prompt: "Summarize the latest support activity.",
      frequency: "daily",
      timeOfDay: "08:00",
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
      dayOfWeek: undefined,
      dayOfMonth: undefined,
      enabled: true,
    });
  });

  it("opens the backing chat from an existing chat schedule", async () => {
    const user = userEvent.setup();
    const onOpenTarget = vi.fn();

    render(
      <SchedulePane
        task={{
          scheduleId: "daily-digest",
          targetKind: "chat",
          agentId: "support-agent",
          chatSessionId: "daily-digest-chat",
          title: "Daily digest",
          prompt: "Summarize the latest support activity.",
          frequency: "daily",
          timeOfDay: "08:00",
          timezone: "UTC",
          enabled: true,
          createdAt: "2026-03-23T12:00:00.000Z",
          updatedAt: "2026-03-23T12:00:00.000Z",
          nextRunAt: "2026-03-24T08:00:00.000Z",
          lastRunStatus: "completed",
          totalRuns: 3,
          failedRuns: 0,
          runtimeConfig: {
            provider: "copilot",
            model: "gpt-5",
            disabledSkills: [],
            mcpServers: {},
          },
        }}
        thread={{
          sessionId: "daily-digest-chat",
          agentId: "support-agent",
          title: "Daily digest",
          startedAt: "2026-03-23T12:00:00.000Z",
          summary: "Scheduled digest",
          manifestPath: "/tmp/session/SESSION.md",
          turnCount: 2,
          lastTurnAt: "2026-03-23T12:00:00.000Z",
          turns: [],
        }}
        chatAgents={[CHAT_AGENT]}
        orchestratorSessions={[]}
        pending={false}
        onCreateTask={() => undefined}
        onUpdateTask={() => undefined}
        onDeleteTask={() => undefined}
        onRunNow={() => undefined}
        onOpenTarget={onOpenTarget}
      />
    );

    await user.click(screen.getByRole("button", { name: "Open target" }));

    expect(onOpenTarget).toHaveBeenCalledWith(
      expect.objectContaining({
        scheduleId: "daily-digest",
        targetKind: "chat",
      })
    );
  });

  it("creates an orchestrator-backed schedule", async () => {
    const user = userEvent.setup();
    const onCreateTask = vi.fn();

    render(
      <SchedulePane
        chatAgents={[]}
        orchestratorSessions={[
          {
            sessionId: "ship-session",
            agentId: "copilot-orchestrator",
            title: "Ship repo changes",
            startedAt: "2026-03-23T12:00:00.000Z",
            summary: "Ship repo changes",
            manifestPath: "/tmp/orchestrator/SESSION.md",
            turnCount: 0,
          },
        ]}
        pending={false}
        onCreateTask={onCreateTask}
        onUpdateTask={() => undefined}
        onDeleteTask={() => undefined}
        onRunNow={() => undefined}
        onOpenTarget={() => undefined}
      />
    );

    await user.click(screen.getByRole("button", { name: "New schedule" }));
    await user.selectOptions(
      screen.getByLabelText("Target type"),
      "orchestrator"
    );
    await user.type(
      screen.getByLabelText("Schedule title"),
      "Ship nightly changes"
    );
    await user.type(
      screen.getByPlaceholderText(
        "Review the latest project activity and summarize what matters most."
      ),
      "Commit the current changes and push them to the remote."
    );
    await user.click(screen.getByRole("button", { name: "Create schedule" }));

    expect(onCreateTask).toHaveBeenCalledWith({
      targetKind: "orchestrator",
      agentId: undefined,
      orchestratorSessionId: "ship-session",
      title: "Ship nightly changes",
      prompt: "Commit the current changes and push them to the remote.",
      frequency: "daily",
      timeOfDay: "08:00",
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
      dayOfWeek: undefined,
      dayOfMonth: undefined,
      enabled: true,
    });
  });
});
