// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OrchestratorPane } from "./OrchestratorPane";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("OrchestratorPane", () => {
  it("submits a new orchestrator session request", async () => {
    const user = userEvent.setup();
    const onCreateSession = vi.fn();

    render(
      <OrchestratorPane
        capabilities={{
          available: true,
          defaultProjectPath: "/tmp/project",
          recentProjectPaths: ["/tmp/another-project"],
          tmuxInstalled: true,
          copilotInstalled: true,
          tmuxSessionName: "min-kb-app-orchestrator",
        }}
        models={[
          {
            id: "gpt-5",
            displayName: "GPT-5",
            supportedReasoningEfforts: [],
          },
          {
            id: "claude-sonnet-4.6",
            displayName: "Claude Sonnet 4.6",
            provider: "Anthropic",
            supportedReasoningEfforts: [],
          },
        ]}
        defaultModelId="gpt-5"
        projectPathSuggestions={["/tmp/project", "/tmp/another-project"]}
        pending={false}
        onCreateSession={onCreateSession}
        onUpdateSession={() => undefined}
        onDelegate={() => undefined}
        onSendInput={() => undefined}
        onCancelJob={() => undefined}
        onSessionUpdate={() => undefined}
      />
    );

    await user.type(
      screen.getByLabelText("Project purpose"),
      "Repair the login redirect"
    );
    await user.type(
      screen.getByLabelText("Initial prompt"),
      "Investigate the broken redirect flow."
    );
    await user.selectOptions(
      screen.getByDisplayValue("GPT-5"),
      "claude-sonnet-4.6"
    );
    await user.click(screen.getByRole("button", { name: "Create session" }));

    expect(onCreateSession).toHaveBeenCalledWith({
      title: undefined,
      projectPath: "/tmp/project",
      projectPurpose: "Repair the login redirect",
      model: "claude-sonnet-4.6",
      prompt: "Investigate the broken redirect flow.",
    });
  });

  it("lets users update the saved session title and model", async () => {
    const user = userEvent.setup();
    const onUpdateSession = vi.fn();
    class MockEventSource {
      addEventListener = vi.fn();
      removeEventListener = vi.fn();
      close = vi.fn();
      onerror: (() => void) | null = null;
    }
    vi.stubGlobal("EventSource", MockEventSource);

    render(
      <OrchestratorPane
        capabilities={{
          available: true,
          defaultProjectPath: "/tmp/project",
          recentProjectPaths: ["/tmp/another-project"],
          tmuxInstalled: true,
          copilotInstalled: true,
          tmuxSessionName: "min-kb-app-orchestrator",
        }}
        session={{
          sessionId: "2026-03-20-repo-support",
          agentId: "copilot-orchestrator",
          title: "Repo support",
          startedAt: "2026-03-20T12:00:00Z",
          updatedAt: "2026-03-20T12:05:00Z",
          summary: "Handle runtime support work",
          projectPath: "/tmp/project",
          projectPurpose: "Handle runtime support work",
          model: "gpt-5",
          tmuxSessionName: "min-kb-app-orchestrator",
          tmuxWindowName: "project-repo-support-0001",
          tmuxPaneId: "%42",
          status: "idle",
          activeJobId: undefined,
          lastJobId: undefined,
          sessionDirectory: "/tmp/session",
          manifestPath:
            "agents/copilot-orchestrator/history/2026-03/2026-03-20-repo-support/SESSION.md",
          jobs: [],
          terminalTail: "",
          logSize: 0,
        }}
        models={[
          {
            id: "gpt-5",
            displayName: "GPT-5",
            supportedReasoningEfforts: [],
          },
          {
            id: "claude-sonnet-4.6",
            displayName: "Claude Sonnet 4.6",
            provider: "Anthropic",
            supportedReasoningEfforts: [],
          },
        ]}
        defaultModelId="gpt-5"
        projectPathSuggestions={["/tmp/project", "/tmp/another-project"]}
        pending={false}
        onCreateSession={() => undefined}
        onUpdateSession={onUpdateSession}
        onDelegate={() => undefined}
        onSendInput={() => undefined}
        onCancelJob={() => undefined}
        onSessionUpdate={() => undefined}
      />
    );

    expect(screen.queryByLabelText("Project name")).toBeNull();

    await user.click(screen.getByRole("button", { name: "Session settings" }));
    await user.clear(screen.getByLabelText("Project name"));
    await user.type(screen.getByLabelText("Project name"), "Payments platform");
    await user.selectOptions(screen.getByRole("combobox"), "claude-sonnet-4.6");
    await user.click(screen.getByRole("button", { name: "Save details" }));

    expect(onUpdateSession).toHaveBeenCalledWith({
      title: "Payments platform",
      model: "claude-sonnet-4.6",
    });
  });
});
