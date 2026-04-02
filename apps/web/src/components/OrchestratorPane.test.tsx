// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
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
            runtimeProvider: "copilot",
            supportedReasoningEfforts: [],
          },
          {
            id: "claude-sonnet-4.6",
            displayName: "Claude Sonnet 4.6",
            runtimeProvider: "copilot",
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
        onRestartSession={() => undefined}
        onDeleteQueuedJob={() => undefined}
        schedules={[]}
        onCreateSchedule={() => undefined}
        onUpdateSchedule={() => undefined}
        onDeleteSchedule={() => undefined}
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
      executionMode: "standard",
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
          availableCustomAgents: [],
          selectedCustomAgentId: undefined,
          executionMode: "standard",
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
            runtimeProvider: "copilot",
            supportedReasoningEfforts: [],
          },
          {
            id: "claude-sonnet-4.6",
            displayName: "Claude Sonnet 4.6",
            runtimeProvider: "copilot",
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
        onRestartSession={() => undefined}
        onDeleteQueuedJob={() => undefined}
        schedules={[]}
        onCreateSchedule={() => undefined}
        onUpdateSchedule={() => undefined}
        onDeleteSchedule={() => undefined}
        onSessionUpdate={() => undefined}
      />
    );

    expect(screen.queryByLabelText("Project name")).toBeNull();

    await user.click(screen.getByRole("button", { name: /session settings/i }));
    await user.clear(screen.getByLabelText("Project name"));
    await user.type(screen.getByLabelText("Project name"), "Payments platform");
    const [modelSelect] = screen.getAllByRole("combobox");
    await user.selectOptions(modelSelect ?? document.body, "claude-sonnet-4.6");
    await user.click(screen.getByRole("button", { name: "Save details" }));

    expect(onUpdateSession).toHaveBeenCalledWith({
      title: "Payments platform",
      model: "claude-sonnet-4.6",
      selectedCustomAgentId: null,
      executionMode: "standard",
    });
  });

  it("lets users save a discovered custom agent for future delegated jobs", async () => {
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
          availableCustomAgents: [
            {
              id: "reviewer",
              name: "PR Reviewer",
              description: "Reviews pull requests.",
              path: ".github/agents/reviewer.agent.md",
            },
          ],
          selectedCustomAgentId: undefined,
          executionMode: "standard",
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
            runtimeProvider: "copilot",
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
        onRestartSession={() => undefined}
        onDeleteQueuedJob={() => undefined}
        schedules={[]}
        onCreateSchedule={() => undefined}
        onUpdateSchedule={() => undefined}
        onDeleteSchedule={() => undefined}
        onSessionUpdate={() => undefined}
      />
    );

    await user.click(screen.getByRole("button", { name: /session settings/i }));
    const [, customAgentSelect] = screen.getAllByRole("combobox");
    await user.selectOptions(customAgentSelect ?? document.body, "reviewer");
    await user.click(screen.getByRole("button", { name: "Save details" }));

    expect(onUpdateSession).toHaveBeenCalledWith({
      title: "Repo support",
      model: "gpt-5",
      selectedCustomAgentId: "reviewer",
      executionMode: "standard",
    });
  });

  it("lets users switch a session to fleet mode", async () => {
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
          availableCustomAgents: [],
          selectedCustomAgentId: undefined,
          executionMode: "standard",
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
            runtimeProvider: "copilot",
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
        onRestartSession={() => undefined}
        onDeleteQueuedJob={() => undefined}
        schedules={[]}
        onCreateSchedule={() => undefined}
        onUpdateSchedule={() => undefined}
        onDeleteSchedule={() => undefined}
        onSessionUpdate={() => undefined}
      />
    );

    await user.click(screen.getByRole("button", { name: /session settings/i }));
    const selects = screen.getAllByRole("combobox");
    await user.selectOptions(selects[2] ?? document.body, "fleet");
    await user.click(screen.getByRole("button", { name: "Save details" }));

    expect(onUpdateSession).toHaveBeenCalledWith({
      title: "Repo support",
      model: "gpt-5",
      selectedCustomAgentId: null,
      executionMode: "fleet",
    });
  });

  it("sends one attached file with a delegated prompt", async () => {
    const user = userEvent.setup();
    const onDelegate = vi.fn();
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
          availableCustomAgents: [],
          selectedCustomAgentId: undefined,
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
            runtimeProvider: "copilot",
            supportedReasoningEfforts: [],
          },
        ]}
        defaultModelId="gpt-5"
        projectPathSuggestions={["/tmp/project", "/tmp/another-project"]}
        pending={false}
        onCreateSession={() => undefined}
        onUpdateSession={() => undefined}
        onDelegate={onDelegate}
        onSendInput={() => undefined}
        onCancelJob={() => undefined}
        onRestartSession={() => undefined}
        onDeleteQueuedJob={() => undefined}
        schedules={[]}
        onCreateSchedule={() => undefined}
        onUpdateSchedule={() => undefined}
        onDeleteSchedule={() => undefined}
        onSessionUpdate={() => undefined}
      />
    );

    await user.type(
      screen.getByPlaceholderText(
        "Queue another async prompt for the Copilot CLI window."
      ),
      "Inspect the attached image."
    );
    await user.upload(
      screen.getByLabelText("Attach file"),
      new File([Uint8Array.from([137, 80, 78, 71])], "asset.png", {
        type: "image/png",
      })
    );
    await user.click(screen.getByRole("button", { name: "Delegate prompt" }));

    expect(onDelegate).toHaveBeenCalledWith({
      prompt: "Inspect the attached image.",
      attachment: expect.any(File),
    });
  });

  it("creates a recurring schedule from the orchestrator session view", async () => {
    const user = userEvent.setup();
    const onCreateSchedule = vi.fn();
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
          emailDeliveryAvailable: true,
          emailFromAddress: "bot@example.com",
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
          availableCustomAgents: [],
          selectedCustomAgentId: undefined,
          sessionDirectory: "/tmp/session",
          manifestPath:
            "agents/copilot-orchestrator/history/2026-03/2026-03-20-repo-support/SESSION.md",
          jobs: [],
          terminalTail: "",
          logSize: 0,
        }}
        schedules={[]}
        models={[
          {
            id: "gpt-5",
            displayName: "GPT-5",
            runtimeProvider: "copilot",
            supportedReasoningEfforts: [],
          },
        ]}
        defaultModelId="gpt-5"
        projectPathSuggestions={["/tmp/project", "/tmp/another-project"]}
        pending={false}
        onCreateSession={() => undefined}
        onUpdateSession={() => undefined}
        onDelegate={() => undefined}
        onSendInput={() => undefined}
        onCancelJob={() => undefined}
        onRestartSession={() => undefined}
        onDeleteQueuedJob={() => undefined}
        onCreateSchedule={onCreateSchedule}
        onUpdateSchedule={() => undefined}
        onDeleteSchedule={() => undefined}
        onSessionUpdate={() => undefined}
      />
    );

    await user.click(screen.getByRole("button", { name: "Create schedule" }));
    await user.type(
      screen.getByLabelText("Schedule title"),
      "Daily XYZ digest"
    );
    await user.type(
      screen.getByPlaceholderText(
        "Summarize the latest news from XYZ, highlight the top five updates, and end with a short executive summary."
      ),
      "Summarize the latest XYZ news and email me the result."
    );
    await user.type(
      screen.getByPlaceholderText("name@example.com"),
      "person@example.com"
    );
    await user.click(
      screen.getAllByRole("button", { name: "Create schedule" }).at(-1) ??
        document.body
    );

    expect(onCreateSchedule).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "2026-03-20-repo-support",
        title: "Daily XYZ digest",
        prompt: "Summarize the latest XYZ news and email me the result.",
        frequency: "daily",
        timeOfDay: "08:00",
        dayOfWeek: undefined,
        dayOfMonth: undefined,
        customAgentId: null,
        emailTo: "person@example.com",
        enabled: true,
      })
    );
  });

  it("reconnects the terminal stream from the latest offset after errors", async () => {
    const instances: MockEventSource[] = [];
    class MockEventSource {
      readonly listeners = new Map<
        string,
        Array<(event: MessageEvent<string>) => void>
      >();
      readonly close = vi.fn();
      onerror: (() => void) | null = null;

      constructor(public readonly url: string) {
        instances.push(this);
      }

      addEventListener = vi.fn(
        (type: string, listener: (event: MessageEvent<string>) => void) => {
          const listeners = this.listeners.get(type) ?? [];
          listeners.push(listener);
          this.listeners.set(type, listeners);
        }
      );

      removeEventListener = vi.fn(
        (type: string, listener: (event: MessageEvent<string>) => void) => {
          const listeners = this.listeners.get(type) ?? [];
          this.listeners.set(
            type,
            listeners.filter((candidate) => candidate !== listener)
          );
        }
      );

      emit(type: string, payload: unknown) {
        for (const listener of this.listeners.get(type) ?? []) {
          listener({
            data: JSON.stringify(payload),
          } as MessageEvent<string>);
        }
      }
    }
    vi.stubGlobal(
      "EventSource",
      MockEventSource as unknown as typeof EventSource
    );

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
          status: "running",
          activeJobId: "job-1",
          lastJobId: "job-1",
          availableCustomAgents: [],
          selectedCustomAgentId: undefined,
          sessionDirectory: "/tmp/session",
          manifestPath:
            "agents/copilot-orchestrator/history/2026-03/2026-03-20-repo-support/SESSION.md",
          jobs: [
            {
              jobId: "job-1",
              sessionId: "2026-03-20-repo-support",
              promptPreview: "Stream output",
              promptMode: "inline",
              status: "running",
              submittedAt: "2026-03-20T12:04:00Z",
              startedAt: "2026-03-20T12:04:05Z",
              jobDirectory: "/tmp/session/jobs/job-1",
            },
          ],
          terminalTail: "",
          logSize: 0,
        }}
        schedules={[]}
        models={[
          {
            id: "gpt-5",
            displayName: "GPT-5",
            runtimeProvider: "copilot",
            supportedReasoningEfforts: [],
          },
        ]}
        defaultModelId="gpt-5"
        projectPathSuggestions={["/tmp/project", "/tmp/another-project"]}
        pending={false}
        onCreateSession={() => undefined}
        onUpdateSession={() => undefined}
        onDelegate={() => undefined}
        onSendInput={() => undefined}
        onCancelJob={() => undefined}
        onRestartSession={() => undefined}
        onDeleteQueuedJob={() => undefined}
        onCreateSchedule={() => undefined}
        onUpdateSchedule={() => undefined}
        onDeleteSchedule={() => undefined}
        onSessionUpdate={() => undefined}
      />
    );

    expect(instances[0]?.url).toContain("offset=0");

    instances[0]?.emit("output", {
      chunk: "hello",
      nextOffset: 5,
    });
    instances[0]?.onerror?.();

    await waitFor(() => expect(instances).toHaveLength(2), { timeout: 2_000 });
    expect(instances[1]?.url).toContain("offset=5");
  });

  it("loads older tmux output on demand without rewinding the live stream", async () => {
    const user = userEvent.setup();
    const logLines = Array.from(
      { length: 2_500 },
      (_, index) => `line ${index + 1}`
    );
    const recentOutput = `${logLines.slice(500).join("\n")}\n`;
    const olderOutput = `${logLines.slice(0, 500).join("\n")}\n`;
    const fullLog = `${logLines.join("\n")}\n`;
    const beforeOffset =
      Buffer.byteLength(fullLog) - Buffer.byteLength(recentOutput);
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          chunk: olderOutput,
          startOffset: 0,
          endOffset: beforeOffset,
          hasMoreBefore: false,
          lineCount: 500,
        }),
        {
          status: 200,
          headers: {
            "content-type": "application/json",
          },
        }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    const eventSourceUrls: string[] = [];
    class MockEventSource {
      addEventListener = vi.fn();
      removeEventListener = vi.fn();
      close = vi.fn();
      onerror: (() => void) | null = null;

      constructor(url: string) {
        eventSourceUrls.push(url);
      }
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
          status: "running",
          activeJobId: "job-1",
          lastJobId: "job-1",
          availableCustomAgents: [],
          selectedCustomAgentId: undefined,
          sessionDirectory: "/tmp/session",
          manifestPath:
            "agents/copilot-orchestrator/history/2026-03/2026-03-20-repo-support/SESSION.md",
          jobs: [],
          terminalTail: recentOutput,
          logSize: Buffer.byteLength(fullLog),
        }}
        schedules={[]}
        models={[
          {
            id: "gpt-5",
            displayName: "GPT-5",
            runtimeProvider: "copilot",
            supportedReasoningEfforts: [],
          },
        ]}
        defaultModelId="gpt-5"
        projectPathSuggestions={["/tmp/project", "/tmp/another-project"]}
        pending={false}
        onCreateSession={() => undefined}
        onUpdateSession={() => undefined}
        onDelegate={() => undefined}
        onSendInput={() => undefined}
        onCancelJob={() => undefined}
        onRestartSession={() => undefined}
        onDeleteQueuedJob={() => undefined}
        onCreateSchedule={() => undefined}
        onUpdateSchedule={() => undefined}
        onDeleteSchedule={() => undefined}
        onSessionUpdate={() => undefined}
      />
    );

    expect(
      screen.getByRole("button", { name: "Load 2k more lines" })
    ).toBeTruthy();

    await user.click(
      screen.getByRole("button", { name: "Load 2k more lines" })
    );

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        `/api/orchestrator/sessions/2026-03-20-repo-support/terminal?before=${beforeOffset}`,
        undefined
      )
    );
    await waitFor(() => expect(document.body.textContent).toContain("line 1"));
    expect(eventSourceUrls).toEqual([
      `/api/orchestrator/sessions/2026-03-20-repo-support/stream?offset=${Buffer.byteLength(fullLog)}`,
    ]);
    expect(
      screen.queryByRole("button", { name: "Load 2k more lines" })
    ).toBeNull();
  });

  it("keeps the task queue collapsed until users open it", async () => {
    const user = userEvent.setup();
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
          status: "running",
          activeJobId: "job-1",
          lastJobId: "job-3",
          availableCustomAgents: [],
          selectedCustomAgentId: undefined,
          sessionDirectory: "/tmp/session",
          manifestPath:
            "agents/copilot-orchestrator/history/2026-03/2026-03-20-repo-support/SESSION.md",
          jobs: [
            {
              jobId: "job-3",
              sessionId: "2026-03-20-repo-support",
              promptPreview: "Draft the release note update",
              promptMode: "inline",
              status: "queued",
              submittedAt: "2026-03-20T12:04:00Z",
              jobDirectory: "/tmp/session/delegations/job-3",
            },
            {
              jobId: "job-2",
              sessionId: "2026-03-20-repo-support",
              promptPreview: "Update the rollout checklist",
              promptMode: "inline",
              status: "queued",
              submittedAt: "2026-03-20T12:03:30Z",
              jobDirectory: "/tmp/session/delegations/job-2",
            },
            {
              jobId: "job-1",
              sessionId: "2026-03-20-repo-support",
              promptPreview: "Investigate the stuck deploy",
              promptMode: "inline",
              status: "running",
              submittedAt: "2026-03-20T12:03:00Z",
              startedAt: "2026-03-20T12:03:05Z",
              jobDirectory: "/tmp/session/delegations/job-1",
            },
          ],
          terminalTail: "",
          logSize: 0,
        }}
        models={[
          {
            id: "gpt-5",
            displayName: "GPT-5",
            runtimeProvider: "copilot",
            supportedReasoningEfforts: [],
          },
        ]}
        defaultModelId="gpt-5"
        projectPathSuggestions={["/tmp/project", "/tmp/another-project"]}
        pending={false}
        onCreateSession={() => undefined}
        onUpdateSession={() => undefined}
        onDelegate={() => undefined}
        onSendInput={() => undefined}
        onCancelJob={() => undefined}
        onRestartSession={() => undefined}
        onDeleteQueuedJob={() => undefined}
        schedules={[]}
        onCreateSchedule={() => undefined}
        onUpdateSchedule={() => undefined}
        onDeleteSchedule={() => undefined}
        onSessionUpdate={() => undefined}
      />
    );

    expect(screen.getByText("2 queued tasks")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Open task queue" })
    ).toBeTruthy();
    expect(
      screen.getByText("Current run plus any queued follow-up work")
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Queue next prompt" })
    ).toBeTruthy();
    expect(screen.queryByText("Investigate the stuck deploy")).toBeNull();
    expect(screen.queryByText("Update the rollout checklist")).toBeNull();
    expect(screen.queryByText("Draft the release note update")).toBeNull();

    await user.click(screen.getByRole("button", { name: "Open task queue" }));

    expect(
      screen.getByRole("button", { name: "Hide task queue" })
    ).toBeTruthy();
    expect(screen.getByText("Investigate the stuck deploy")).toBeTruthy();
    expect(screen.getByText("Update the rollout checklist")).toBeTruthy();
    expect(screen.getByText("Draft the release note update")).toBeTruthy();
  });

  it("routes queued task deletion through the provided handler", async () => {
    const user = userEvent.setup();
    const onDeleteQueuedJob = vi.fn();
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
          recentProjectPaths: [],
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
          lastJobId: "job-queued",
          availableCustomAgents: [],
          selectedCustomAgentId: undefined,
          sessionDirectory: "/tmp/session",
          manifestPath:
            "agents/copilot-orchestrator/history/2026-03/2026-03-20-repo-support/SESSION.md",
          jobs: [
            {
              jobId: "job-queued",
              sessionId: "2026-03-20-repo-support",
              promptPreview: "Draft the release note update",
              promptMode: "inline",
              status: "queued",
              submittedAt: "2026-03-20T12:04:00Z",
              jobDirectory: "/tmp/session/delegations/job-queued",
            },
          ],
          terminalTail: "",
          logSize: 0,
        }}
        models={[
          {
            id: "gpt-5",
            displayName: "GPT-5",
            runtimeProvider: "copilot",
            supportedReasoningEfforts: [],
          },
        ]}
        defaultModelId="gpt-5"
        projectPathSuggestions={["/tmp/project"]}
        pending={false}
        onCreateSession={() => undefined}
        onUpdateSession={() => undefined}
        onDelegate={() => undefined}
        onSendInput={() => undefined}
        onCancelJob={() => undefined}
        onRestartSession={() => undefined}
        onDeleteQueuedJob={onDeleteQueuedJob}
        schedules={[]}
        onCreateSchedule={() => undefined}
        onUpdateSchedule={() => undefined}
        onDeleteSchedule={() => undefined}
        onSessionUpdate={() => undefined}
      />
    );

    await user.click(screen.getByRole("button", { name: "Open task queue" }));
    await user.click(screen.getByRole("button", { name: "Remove" }));
    expect(onDeleteQueuedJob).toHaveBeenCalledWith("job-queued");
  });

  it("keeps one stream connection for the same session across rerenders", () => {
    const eventSourceUrls: string[] = [];

    class MockEventSource {
      static instances: MockEventSource[] = [];
      addEventListener = vi.fn();
      removeEventListener = vi.fn();
      close = vi.fn();
      onerror: (() => void) | null = null;

      constructor(url: string) {
        eventSourceUrls.push(url);
        MockEventSource.instances.push(this);
      }
    }

    vi.stubGlobal("EventSource", MockEventSource);

    const session = {
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
      status: "running" as const,
      activeJobId: "job-1",
      lastJobId: "job-1",
      availableCustomAgents: [],
      selectedCustomAgentId: undefined,
      sessionDirectory: "/tmp/session",
      manifestPath:
        "agents/copilot-orchestrator/history/2026-03/2026-03-20-repo-support/SESSION.md",
      jobs: [],
      terminalTail: "hello",
      logSize: 5,
    };

    const { rerender } = render(
      <OrchestratorPane
        capabilities={{
          available: true,
          defaultProjectPath: "/tmp/project",
          recentProjectPaths: ["/tmp/another-project"],
          tmuxInstalled: true,
          copilotInstalled: true,
          tmuxSessionName: "min-kb-app-orchestrator",
        }}
        session={session}
        models={[
          {
            id: "gpt-5",
            displayName: "GPT-5",
            runtimeProvider: "copilot",
            supportedReasoningEfforts: [],
          },
        ]}
        defaultModelId="gpt-5"
        projectPathSuggestions={["/tmp/project", "/tmp/another-project"]}
        pending={false}
        onCreateSession={() => undefined}
        onUpdateSession={() => undefined}
        onDelegate={() => undefined}
        onSendInput={() => undefined}
        onCancelJob={() => undefined}
        onRestartSession={() => undefined}
        onDeleteQueuedJob={() => undefined}
        schedules={[]}
        onCreateSchedule={() => undefined}
        onUpdateSchedule={() => undefined}
        onDeleteSchedule={() => undefined}
        onSessionUpdate={() => undefined}
      />
    );

    rerender(
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
          ...session,
          terminalTail: "hello world",
          logSize: 11,
          updatedAt: "2026-03-20T12:06:00Z",
        }}
        models={[
          {
            id: "gpt-5",
            displayName: "GPT-5",
            runtimeProvider: "copilot",
            supportedReasoningEfforts: [],
          },
        ]}
        defaultModelId="gpt-5"
        projectPathSuggestions={["/tmp/project", "/tmp/another-project"]}
        pending={false}
        onCreateSession={() => undefined}
        onUpdateSession={() => undefined}
        onDelegate={() => undefined}
        onSendInput={() => undefined}
        onCancelJob={() => undefined}
        onRestartSession={() => undefined}
        onDeleteQueuedJob={() => undefined}
        schedules={[]}
        onCreateSchedule={() => undefined}
        onUpdateSchedule={() => undefined}
        onDeleteSchedule={() => undefined}
        onSessionUpdate={() => undefined}
      />
    );

    expect(eventSourceUrls).toEqual([
      "/api/orchestrator/sessions/2026-03-20-repo-support/stream?offset=5",
    ]);
    expect(MockEventSource.instances).toHaveLength(1);
    expect(MockEventSource.instances[0]?.close).not.toHaveBeenCalled();
  });

  it("shows the new tmux session action near terminal output", async () => {
    const user = userEvent.setup();
    const onRestartSession = vi.fn();
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
          recentProjectPaths: [],
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
          availableCustomAgents: [],
          selectedCustomAgentId: undefined,
          sessionDirectory: "/tmp/session",
          manifestPath:
            "agents/copilot-orchestrator/history/2026-03/2026-03-20-repo-support/SESSION.md",
          jobs: [],
          terminalTail: "ready\n",
          logSize: 6,
        }}
        models={[
          {
            id: "gpt-5",
            displayName: "GPT-5",
            runtimeProvider: "copilot",
            supportedReasoningEfforts: [],
          },
        ]}
        defaultModelId="gpt-5"
        projectPathSuggestions={["/tmp/project"]}
        pending={false}
        onCreateSession={() => undefined}
        onUpdateSession={() => undefined}
        onDelegate={() => undefined}
        onSendInput={() => undefined}
        onCancelJob={() => undefined}
        onRestartSession={onRestartSession}
        onDeleteQueuedJob={() => undefined}
        schedules={[]}
        onCreateSchedule={() => undefined}
        onUpdateSchedule={() => undefined}
        onDeleteSchedule={() => undefined}
        onSessionUpdate={() => undefined}
      />
    );

    await user.click(
      screen.getByRole("button", { name: "Start a new tmux session" })
    );

    expect(onRestartSession).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: "Delete session" })).toBeNull();
    expect(
      screen.getByText(/Starting a new tmux session closes the current pane/i)
    ).toBeTruthy();
  });
});
