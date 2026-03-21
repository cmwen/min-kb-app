// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentRail } from "./AgentRail";

afterEach(() => {
  cleanup();
});

describe("AgentRail", () => {
  it("shows a notification dot for agents with completed work waiting", () => {
    render(
      <AgentRail
        agents={[
          {
            id: "copilot-orchestrator",
            kind: "orchestrator",
            title: "Copilot orchestrator",
            description: "Delegates tmux-backed work.",
            combinedPrompt: "Queue work.",
            agentPath: "/tmp/agents/copilot-orchestrator/AGENT.md",
            defaultSoulPath: "/tmp/agents/default/SOUL.md",
            historyRoot: "/tmp/agents/copilot-orchestrator/history",
            workingMemoryRoot:
              "/tmp/agents/copilot-orchestrator/memory/working",
            skillRoot: "/tmp/agents/copilot-orchestrator/skills",
            skillNames: [],
            sessionCount: 1,
          },
        ]}
        notificationAgentIds={new Set(["copilot-orchestrator"])}
        offline={false}
        onSelect={vi.fn()}
        onNewSession={() => undefined}
        onOpenSettings={() => undefined}
      />
    );

    expect(
      screen.queryByLabelText("Agent has completed work waiting")
    ).not.toBeNull();
  });
});
