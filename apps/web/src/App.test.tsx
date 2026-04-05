// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";

const apiMocks = vi.hoisted(() => ({
  getWorkspace: vi.fn(),
  listAgents: vi.fn(),
  listModels: vi.fn(),
  listSessions: vi.fn(),
  listOrchestratorSessions: vi.fn(),
  listSkills: vi.fn(),
  getSession: vi.fn(),
  deleteSession: vi.fn(),
  getOrchestratorCapabilities: vi.fn(),
  getScheduledTask: vi.fn(),
  analyzeMemory: vi.fn(),
  sendMessage: vi.fn(),
  sendMessageStream: vi.fn(),
  delegateOrchestratorJob: vi.fn(),
  createScheduledTask: vi.fn(),
  updateScheduledTask: vi.fn(),
  deleteScheduledTask: vi.fn(),
  runScheduledTaskNow: vi.fn(),
}));

vi.mock("./api", () => ({
  api: apiMocks,
  API_ROOT: "",
}));

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

beforeEach(() => {
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockImplementation(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }))
  );

  apiMocks.getWorkspace.mockResolvedValue({
    storeRoot: "/tmp/store",
    copilotConfigDir: "/tmp/.copilot",
    storeSkillDirectory: "/tmp/store/skills",
    copilotSkillDirectory: "/tmp/.copilot/skills",
    agentCount: 1,
  });
  apiMocks.listAgents.mockResolvedValue([
    {
      id: "support-agent",
      kind: "chat",
      title: "Support agent",
      description: "Helps with support work.",
      combinedPrompt: "Be helpful.",
      agentPath: "/tmp/agents/support-agent/AGENT.md",
      defaultSoulPath: "/tmp/agents/default/SOUL.md",
      historyRoot: "/tmp/agents/support-agent/history",
      workingMemoryRoot: "/tmp/agents/support-agent/memory/working",
      skillRoot: "/tmp/agents/support-agent/skills",
      skillNames: ["memory-capture"],
      sessionCount: 1,
    },
  ]);
  apiMocks.listModels.mockResolvedValue({
    defaultProvider: "copilot",
    providers: [
      {
        id: "copilot",
        displayName: "GitHub Copilot",
        capabilities: {
          supportsReasoningEffort: true,
          supportsSkills: true,
          supportsMcpServers: true,
        },
      },
      {
        id: "lmstudio",
        displayName: "LM Studio",
        capabilities: {
          supportsReasoningEffort: false,
          supportsSkills: true,
          supportsMcpServers: false,
        },
      },
    ],
    models: [
      {
        id: "gpt-5",
        displayName: "GPT-5",
        runtimeProvider: "copilot",
        supportedReasoningEfforts: [],
      },
      {
        id: "qwen2.5-7b-instruct",
        displayName: "qwen2.5-7b-instruct",
        runtimeProvider: "lmstudio",
        supportedReasoningEfforts: [],
      },
    ],
  });
  apiMocks.getOrchestratorCapabilities.mockResolvedValue({
    available: true,
    defaultProjectPath: "/tmp/store",
    recentProjectPaths: [],
    tmuxInstalled: true,
    copilotInstalled: true,
    tmuxSessionName: "min-kb-app-orchestrator",
  });
  apiMocks.listOrchestratorSessions.mockResolvedValue([]);
  apiMocks.deleteSession.mockResolvedValue({ ok: true });
  apiMocks.listSessions.mockResolvedValue([
    {
      sessionId: "session-1",
      agentId: "support-agent",
      title: "Support chat",
      startedAt: "2026-03-20T12:00:00Z",
      summary: "Investigate memory analysis behavior",
      manifestPath: "/tmp/session-1/SESSION.md",
      turnCount: 2,
      lastTurnAt: "2026-03-20T12:01:00Z",
      runtimeConfig: {
        model: "gpt-5",
        disabledSkills: [],
        mcpServers: {},
      },
    },
  ]);
  apiMocks.listSkills.mockResolvedValue([
    {
      name: "memory-capture",
      description: "Capture durable memory",
      scope: "agent-local",
      path: "/tmp/agents/support-agent/skills/memory-capture/SKILL.md",
      sourceRoot: "/tmp/agents/support-agent/skills",
    },
  ]);
  apiMocks.getSession.mockResolvedValue({
    sessionId: "session-1",
    agentId: "support-agent",
    title: "Support chat",
    startedAt: "2026-03-20T12:00:00Z",
    summary: "Investigate memory analysis behavior",
    manifestPath: "/tmp/session-1/SESSION.md",
    turnCount: 2,
    lastTurnAt: "2026-03-20T12:01:00Z",
    runtimeConfig: {
      model: "gpt-5",
      disabledSkills: [],
      mcpServers: {},
    },
    turns: [
      {
        messageId: "m1",
        sender: "user",
        createdAt: "2026-03-20T12:00:00Z",
        bodyMarkdown: "Please remember the deployment owner.",
        relativePath: "turns/m1.md",
      },
      {
        messageId: "m2",
        sender: "assistant",
        createdAt: "2026-03-20T12:01:00Z",
        bodyMarkdown: "I will capture the owner in memory.",
        relativePath: "turns/m2.md",
      },
    ],
  });
  apiMocks.sendMessageStream.mockImplementation(
    async (
      agentId: string,
      sessionId: string | undefined,
      request: unknown,
      _onEvent: (event: unknown) => void
    ) => apiMocks.sendMessage(agentId, sessionId, request)
  );
});

describe("App memory analysis", () => {
  it("opens the memory analysis modal after the run completes", async () => {
    const user = userEvent.setup();
    let resolveAnalysis: ((value: unknown) => void) | undefined;
    apiMocks.analyzeMemory.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveAnalysis = resolve;
        })
    );

    render(<App />);

    const analyzeButton = await screen.findByRole("button", {
      name: "Analyze memory",
    });
    await waitFor(() =>
      expect(analyzeButton.getAttribute("disabled")).toBeNull()
    );

    await user.click(analyzeButton);

    expect(
      await screen.findByRole("dialog", { name: "Memory analysis" })
    ).not.toBeNull();
    expect(
      screen.queryByText(
        "Analyzing memory and waiting for the runtime to report what changed..."
      )
    ).not.toBeNull();

    resolveAnalysis?.({
      markdown: "## Long-term memory\n\nStored the deployment owner.",
      model: "gpt-5-mini",
      configuredMemorySkillNames: ["memory-capture"],
      enabledSkillNames: ["memory-capture"],
      loadedSkillNames: ["memory-capture"],
      invokedSkillNames: ["memory-capture"],
      toolExecutions: [
        {
          toolName: "write_memory",
          success: true,
          content: "Stored the deployment owner.",
          memoryTier: "long-term",
        },
      ],
      reportedLoadedSkills: true,
      analysisByTier: {
        working: {
          summary:
            "Keep the deployment owner in working memory for this incident.",
          items: [],
        },
        shortTerm: {
          summary: "",
          items: ["Check whether ownership changes after this deploy"],
        },
        longTerm: {
          summary: "Stored the deployment owner.",
          items: [],
        },
      },
      memoryChanges: {
        working: [],
        shortTerm: [],
        longTerm: [
          {
            id: "deployment-owner",
            title: "Deployment owner",
            path: "/tmp/memory/shared/long-term/deployment-owner.md",
            status: "added",
            tier: "long-term",
          },
        ],
      },
    });

    expect(
      await screen.findByRole("dialog", { name: "Memory analysis" })
    ).not.toBeNull();
    expect(screen.queryByText("Memory updates were reported")).not.toBeNull();
  });

  it("sends one attached file with a chat request", async () => {
    const user = userEvent.setup();
    apiMocks.sendMessage.mockResolvedValue({
      thread: {
        sessionId: "session-1",
        agentId: "support-agent",
        title: "Support chat",
        startedAt: "2026-03-20T12:00:00Z",
        summary: "Investigate memory analysis behavior",
        manifestPath: "/tmp/session-1/SESSION.md",
        turnCount: 3,
        lastTurnAt: "2026-03-20T12:02:00Z",
        runtimeConfig: {
          model: "gpt-5",
          disabledSkills: [],
          mcpServers: {},
        },
        turns: [
          {
            messageId: "m1",
            sender: "user",
            createdAt: "2026-03-20T12:00:00Z",
            bodyMarkdown: "Please remember the deployment owner.",
            relativePath: "turns/m1.md",
          },
          {
            messageId: "m2",
            sender: "assistant",
            createdAt: "2026-03-20T12:01:00Z",
            bodyMarkdown: "I will capture the owner in memory.",
            relativePath: "turns/m2.md",
          },
          {
            messageId: "m3",
            sender: "user",
            createdAt: "2026-03-20T12:02:00Z",
            bodyMarkdown: "Review this image.",
            relativePath: "turns/m3.md",
            attachment: {
              attachmentId: "attach-1",
              name: "diagram.png",
              contentType: "image/png",
              size: 4,
              mediaType: "image",
              relativePath: "attachments/m3/diagram.png",
            },
          },
        ],
      },
      assistantTurn: {
        messageId: "m4",
        sender: "assistant",
        createdAt: "2026-03-20T12:02:30Z",
        bodyMarkdown: "I reviewed the image.",
        relativePath: "turns/m4.md",
      },
    });

    render(<App />);

    await user.type(
      await screen.findByLabelText("Message composer"),
      "Review this image."
    );
    const input = await screen.findByLabelText("Attach file");
    await user.upload(
      input,
      new File([Uint8Array.from([137, 80, 78, 71])], "diagram.png", {
        type: "image/png",
      })
    );
    await user.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() =>
      expect(apiMocks.sendMessageStream).toHaveBeenCalledTimes(1)
    );
    expect(apiMocks.sendMessageStream).toHaveBeenCalledWith(
      "support-agent",
      "session-1",
      expect.objectContaining({
        prompt: expect.stringContaining("image"),
        attachment: expect.objectContaining({
          name: "diagram.png",
          contentType: "image/png",
          size: 4,
        }),
      }),
      expect.any(Function)
    );
  });

  it("renders streaming assistant snapshots before the final chat response lands", async () => {
    const user = userEvent.setup();
    let resolveResponse:
      | ((value: {
          thread: {
            sessionId: string;
            agentId: string;
            title: string;
            startedAt: string;
            summary: string;
            manifestPath: string;
            turnCount: number;
            lastTurnAt: string;
            runtimeConfig: {
              model: string;
              disabledSkills: string[];
              mcpServers: Record<string, never>;
            };
            turns: Array<{
              messageId: string;
              sender: "user" | "assistant";
              createdAt: string;
              bodyMarkdown: string;
              thinkingMarkdown?: string;
              relativePath: string;
            }>;
          };
          assistantTurn: {
            messageId: string;
            sender: "assistant";
            createdAt: string;
            bodyMarkdown: string;
            thinkingMarkdown?: string;
            relativePath: string;
          };
        }) => void)
      | undefined;
    apiMocks.sendMessageStream.mockImplementation(
      async (
        _agentId: string,
        _sessionId: string | undefined,
        _request: unknown,
        onEvent: (event: {
          type: "thread" | "assistant_snapshot";
          thread?: {
            sessionId: string;
            agentId: string;
            title: string;
            startedAt: string;
            summary: string;
            manifestPath: string;
            turnCount: number;
            lastTurnAt: string;
            runtimeConfig: {
              model: string;
              disabledSkills: string[];
              mcpServers: Record<string, never>;
            };
            turns: Array<{
              messageId: string;
              sender: "user";
              createdAt: string;
              bodyMarkdown: string;
              relativePath: string;
            }>;
          };
          assistantText?: string;
          thinkingText?: string;
        }) => void
      ) => {
        onEvent({
          type: "thread",
          thread: {
            sessionId: "session-1",
            agentId: "support-agent",
            title: "Support chat",
            startedAt: "2026-03-20T12:00:00Z",
            summary: "Investigate memory analysis behavior",
            manifestPath: "/tmp/session-1/SESSION.md",
            turnCount: 3,
            lastTurnAt: "2026-03-20T12:02:00Z",
            runtimeConfig: {
              model: "gpt-5",
              disabledSkills: [],
              mcpServers: {},
            },
            turns: [
              {
                messageId: "m1",
                sender: "user",
                createdAt: "2026-03-20T12:02:00Z",
                bodyMarkdown: "Stream this reply.",
                relativePath: "turns/m1.md",
              },
            ],
          },
        });
        onEvent({
          type: "assistant_snapshot",
          assistantText: "Streaming reply in progress.",
          thinkingText: "Check the deploy logs before summarizing.",
        });
        return await new Promise((resolve) => {
          resolveResponse = resolve;
        });
      }
    );

    render(<App />);

    await user.type(
      await screen.findByLabelText("Message composer"),
      "Stream this reply."
    );
    await user.click(screen.getByRole("button", { name: "Send" }));

    expect(
      await screen.findByText("Streaming reply in progress.")
    ).not.toBeNull();
    const streamingThinkingPanel = screen
      .getByText("Thinking process")
      .closest("details");
    expect(streamingThinkingPanel?.hasAttribute("open")).toBe(false);

    resolveResponse?.({
      thread: {
        sessionId: "session-1",
        agentId: "support-agent",
        title: "Support chat",
        startedAt: "2026-03-20T12:00:00Z",
        summary: "Investigate memory analysis behavior",
        manifestPath: "/tmp/session-1/SESSION.md",
        turnCount: 4,
        lastTurnAt: "2026-03-20T12:02:30Z",
        runtimeConfig: {
          model: "gpt-5",
          disabledSkills: [],
          mcpServers: {},
        },
        turns: [
          {
            messageId: "m1",
            sender: "user",
            createdAt: "2026-03-20T12:02:00Z",
            bodyMarkdown: "Stream this reply.",
            relativePath: "turns/m1.md",
          },
          {
            messageId: "m2",
            sender: "assistant",
            createdAt: "2026-03-20T12:02:30Z",
            bodyMarkdown: "Final streamed reply.",
            thinkingMarkdown: "Check the deploy logs before summarizing.",
            relativePath: "turns/m2.md",
          },
        ],
      },
      assistantTurn: {
        messageId: "m2",
        sender: "assistant",
        createdAt: "2026-03-20T12:02:30Z",
        bodyMarkdown: "Final streamed reply.",
        thinkingMarkdown: "Check the deploy logs before summarizing.",
        relativePath: "turns/m2.md",
      },
    });

    expect(await screen.findByText("Final streamed reply.")).not.toBeNull();
    const finalThinkingPanel = screen
      .getByText("Thinking process")
      .closest("details");
    expect(finalThinkingPanel?.hasAttribute("open")).toBe(false);
  });

  it("shows an agent badge when another session completed in the background", async () => {
    apiMocks.listAgents.mockResolvedValue([
      {
        id: "support-agent",
        kind: "chat",
        title: "Support agent",
        description: "Helps with support work.",
        combinedPrompt: "Be helpful.",
        agentPath: "/tmp/agents/support-agent/AGENT.md",
        defaultSoulPath: "/tmp/agents/default/SOUL.md",
        historyRoot: "/tmp/agents/support-agent/history",
        workingMemoryRoot: "/tmp/agents/support-agent/memory/working",
        skillRoot: "/tmp/agents/support-agent/skills",
        skillNames: ["memory-capture"],
        sessionCount: 1,
      },
      {
        id: "copilot-orchestrator",
        kind: "orchestrator",
        title: "Copilot orchestrator",
        description: "Delegates tmux-backed work.",
        combinedPrompt: "Queue work.",
        agentPath: "/tmp/agents/copilot-orchestrator/AGENT.md",
        defaultSoulPath: "/tmp/agents/default/SOUL.md",
        historyRoot: "/tmp/agents/copilot-orchestrator/history",
        workingMemoryRoot: "/tmp/agents/copilot-orchestrator/memory/working",
        skillRoot: "/tmp/agents/copilot-orchestrator/skills",
        skillNames: [],
        sessionCount: 1,
      },
    ]);
    apiMocks.listSessions.mockImplementation(async (agentId: string) => {
      if (agentId === "copilot-orchestrator") {
        return [
          {
            sessionId: "orch-session-1",
            agentId: "copilot-orchestrator",
            title: "Release support",
            startedAt: "2026-03-20T12:00:00Z",
            summary: "Ship the release",
            manifestPath:
              "/tmp/agents/copilot-orchestrator/history/2026-03/orch-session-1/SESSION.md",
            turnCount: 3,
            lastTurnAt: "2026-03-20T12:05:00Z",
            completionStatus: "completed" as const,
          },
        ];
      }

      return [
        {
          sessionId: "session-1",
          agentId: "support-agent",
          title: "Support chat",
          startedAt: "2026-03-20T12:00:00Z",
          summary: "Investigate memory analysis behavior",
          manifestPath: "/tmp/session-1/SESSION.md",
          turnCount: 2,
          lastTurnAt: "2026-03-20T12:01:00Z",
          runtimeConfig: {
            model: "gpt-5",
            disabledSkills: [],
            mcpServers: {},
          },
        },
      ];
    });

    render(<App />);

    expect(
      await screen.findByLabelText("Agent has completed work waiting")
    ).not.toBeNull();
  });

  it("deletes older duplicate orchestrator sessions from the selected session", async () => {
    const user = userEvent.setup();
    localStorage.setItem(
      "min-kb-app:app-state",
      JSON.stringify({
        selectedAgentId: "copilot-orchestrator",
        selectedSessionId: "orch-session-new",
        preferNewSession: false,
        draftConfig: {
          provider: "copilot",
          model: "gpt-5",
          disabledSkills: [],
          mcpServers: {},
        },
        draftMcpText: "{}",
      })
    );
    apiMocks.listAgents.mockResolvedValue([
      {
        id: "copilot-orchestrator",
        kind: "orchestrator",
        title: "Copilot orchestrator",
        description: "Delegates tmux-backed work.",
        combinedPrompt: "Queue work.",
        agentPath: "/tmp/agents/copilot-orchestrator/AGENT.md",
        defaultSoulPath: "/tmp/agents/default/SOUL.md",
        historyRoot: "/tmp/agents/copilot-orchestrator/history",
        workingMemoryRoot: "/tmp/agents/copilot-orchestrator/memory/working",
        skillRoot: "/tmp/agents/copilot-orchestrator/skills",
        skillNames: [],
        sessionCount: 2,
      },
    ]);
    apiMocks.listSessions.mockImplementation(async (agentId: string) => {
      if (agentId !== "copilot-orchestrator") {
        return [];
      }

      return [
        {
          sessionId: "orch-session-new",
          agentId: "copilot-orchestrator",
          title: "Ship a coordinated implementation",
          startedAt: "2026-04-03T12:00:00Z",
          summary: "Ship a coordinated implementation • idle",
          manifestPath:
            "/tmp/agents/copilot-orchestrator/history/2026-04/orch-session-new/SESSION.md",
          turnCount: 1,
          lastTurnAt: "2026-04-03T12:10:00Z",
        },
        {
          sessionId: "orch-session-old",
          agentId: "copilot-orchestrator",
          title: "Ship a coordinated implementation",
          startedAt: "2026-04-02T12:00:00Z",
          summary: "Ship a coordinated implementation • completed",
          manifestPath:
            "/tmp/agents/copilot-orchestrator/history/2026-04/orch-session-old/SESSION.md",
          turnCount: 2,
          lastTurnAt: "2026-04-02T12:10:00Z",
        },
      ];
    });
    apiMocks.listOrchestratorSessions.mockResolvedValue([
      {
        sessionId: "orch-session-new",
        agentId: "copilot-orchestrator",
        title: "Ship a coordinated implementation",
        startedAt: "2026-04-03T12:00:00Z",
        updatedAt: "2026-04-03T12:10:00Z",
        summary: "Ship a coordinated implementation",
        projectPath: "/tmp/store",
        projectPurpose: "Ship a coordinated implementation",
        cliProvider: "copilot",
        model: "gpt-5",
        tmuxSessionName: "min-kb-app-orchestrator",
        tmuxWindowName: "tmp-new",
        tmuxPaneId: "%42",
        status: "idle" as const,
        activeJobId: undefined,
        lastJobId: undefined,
        availableCustomAgents: [],
        selectedCustomAgentId: undefined,
        executionMode: "fleet" as const,
        sessionDirectory:
          "/tmp/agents/copilot-orchestrator/history/2026-04/orch-session-new",
        manifestPath:
          "agents/copilot-orchestrator/history/2026-04/orch-session-new/SESSION.md",
        jobs: [],
        terminalTail: "",
        logSize: 0,
      },
      {
        sessionId: "orch-session-old",
        agentId: "copilot-orchestrator",
        title: "Ship a coordinated implementation",
        startedAt: "2026-04-02T12:00:00Z",
        updatedAt: "2026-04-02T12:10:00Z",
        summary: "Ship a coordinated implementation",
        projectPath: "/tmp/store/",
        projectPurpose: "Ship a coordinated implementation ",
        cliProvider: "copilot",
        model: "gpt-5",
        tmuxSessionName: "min-kb-app-orchestrator",
        tmuxWindowName: "tmp-old",
        tmuxPaneId: "%43",
        status: "completed" as const,
        activeJobId: undefined,
        lastJobId: undefined,
        availableCustomAgents: [],
        selectedCustomAgentId: undefined,
        executionMode: "fleet" as const,
        sessionDirectory:
          "/tmp/agents/copilot-orchestrator/history/2026-04/orch-session-old",
        manifestPath:
          "agents/copilot-orchestrator/history/2026-04/orch-session-old/SESSION.md",
        jobs: [],
        terminalTail: "",
        logSize: 0,
      },
    ]);

    render(<App />);

    await user.click(
      await screen.findByRole("button", { name: "Remove 1 older duplicate" })
    );
    await user.click(
      await screen.findByLabelText(
        "I understand the older duplicate sessions cannot be restored."
      )
    );
    await user.click(
      screen.getByRole("button", { name: "Delete older duplicates" })
    );

    await waitFor(() =>
      expect(apiMocks.deleteSession).toHaveBeenCalledWith(
        "copilot-orchestrator",
        "orch-session-old"
      )
    );
    expect(screen.queryByText("orch-session-old")).toBeNull();
  });

  it("restores the previously selected session after a restart", async () => {
    localStorage.setItem(
      "min-kb-app:app-state",
      JSON.stringify({
        selectedAgentId: "support-agent",
        selectedSessionId: "session-2",
        preferNewSession: false,
        draftConfig: {
          provider: "copilot",
          model: "gpt-5",
          disabledSkills: [],
          mcpServers: {},
        },
        draftMcpText: "{}",
      })
    );
    apiMocks.listSessions.mockResolvedValue([
      {
        sessionId: "session-1",
        agentId: "support-agent",
        title: "Support chat",
        startedAt: "2026-03-20T12:00:00Z",
        summary: "Investigate memory analysis behavior",
        manifestPath: "/tmp/session-1/SESSION.md",
        turnCount: 2,
        lastTurnAt: "2026-03-20T12:01:00Z",
        runtimeConfig: {
          model: "gpt-5",
          disabledSkills: [],
          mcpServers: {},
        },
      },
      {
        sessionId: "session-2",
        agentId: "support-agent",
        title: "Escalation follow-up",
        startedAt: "2026-03-20T12:10:00Z",
        summary: "Handle a reopened incident",
        manifestPath: "/tmp/session-2/SESSION.md",
        turnCount: 4,
        lastTurnAt: "2026-03-20T12:12:00Z",
        runtimeConfig: {
          model: "gpt-5",
          disabledSkills: [],
          mcpServers: {},
        },
      },
    ]);
    apiMocks.getSession.mockImplementation(
      async (_agentId: string, sessionId: string) => ({
        sessionId,
        agentId: "support-agent",
        title:
          sessionId === "session-2" ? "Escalation follow-up" : "Support chat",
        startedAt:
          sessionId === "session-2"
            ? "2026-03-20T12:10:00Z"
            : "2026-03-20T12:00:00Z",
        summary:
          sessionId === "session-2"
            ? "Handle a reopened incident"
            : "Investigate memory analysis behavior",
        manifestPath: `/tmp/${sessionId}/SESSION.md`,
        turnCount: sessionId === "session-2" ? 4 : 2,
        lastTurnAt:
          sessionId === "session-2"
            ? "2026-03-20T12:12:00Z"
            : "2026-03-20T12:01:00Z",
        runtimeConfig: {
          model: "gpt-5",
          disabledSkills: [],
          mcpServers: {},
        },
        turns: [
          {
            messageId: `${sessionId}-m1`,
            sender: "user" as const,
            createdAt: "2026-03-20T12:00:00Z",
            bodyMarkdown: `Open ${sessionId}`,
            relativePath: `turns/${sessionId}-m1.md`,
          },
        ],
      })
    );

    render(<App />);

    const openButtons = await screen.findAllByRole("button", {
      name: "Open chat",
    });
    expect(openButtons).toHaveLength(1);
    expect(screen.getByText("Handle a reopened incident")).not.toBeNull();
    expect(apiMocks.getSession).not.toHaveBeenCalled();
  });

  it("restores new-chat mode without auto-opening the first saved session", async () => {
    localStorage.setItem(
      "min-kb-app:app-state",
      JSON.stringify({
        selectedAgentId: "support-agent",
        preferNewSession: true,
        draftConfig: {
          provider: "lmstudio",
          model: "qwen2.5-7b-instruct",
          disabledSkills: [],
          mcpServers: {},
        },
        draftMcpText: "{}",
      })
    );
    apiMocks.listSessions.mockResolvedValue([
      {
        sessionId: "session-1",
        agentId: "support-agent",
        title: "Support chat",
        startedAt: "2026-03-20T12:00:00Z",
        summary: "Investigate memory analysis behavior",
        manifestPath: "/tmp/session-1/SESSION.md",
        turnCount: 2,
        lastTurnAt: "2026-03-20T12:01:00Z",
        runtimeConfig: {
          model: "gpt-5",
          disabledSkills: [],
          mcpServers: {},
        },
      },
    ]);

    render(<App />);

    expect(
      await screen.findByText("Model: qwen2.5-7b-instruct")
    ).not.toBeNull();
    await waitFor(() =>
      expect(apiMocks.listSessions).toHaveBeenCalledWith("support-agent")
    );
    expect(apiMocks.getSession).not.toHaveBeenCalled();
  });

  it("lets settings change the default chat model", async () => {
    const user = userEvent.setup();

    render(<App />);

    await user.click(
      await screen.findByRole("button", { name: "Open app settings" })
    );
    const dialog = await screen.findByRole("dialog", { name: "App settings" });
    expect(dialog).not.toBeNull();

    await user.selectOptions(
      screen.getByLabelText("New chat model"),
      "qwen2.5-7b-instruct"
    );
    await user.click(screen.getByRole("button", { name: "Done" }));

    await user.keyboard("{Alt>}{Shift>}N{/Shift}{/Alt}");

    expect(
      await screen.findByText("Model: qwen2.5-7b-instruct")
    ).not.toBeNull();
  });

  it("falls back to the first available session when the restored one is gone", async () => {
    localStorage.setItem(
      "min-kb-app:app-state",
      JSON.stringify({
        selectedAgentId: "support-agent",
        selectedSessionId: "missing-session",
        preferNewSession: false,
        draftConfig: {
          provider: "copilot",
          model: "gpt-5",
          disabledSkills: [],
          mcpServers: {},
        },
        draftMcpText: "{}",
      })
    );
    apiMocks.listSessions.mockResolvedValue([
      {
        sessionId: "session-1",
        agentId: "support-agent",
        title: "Support chat",
        startedAt: "2026-03-20T12:00:00Z",
        summary: "Investigate memory analysis behavior",
        manifestPath: "/tmp/session-1/SESSION.md",
        turnCount: 2,
        lastTurnAt: "2026-03-20T12:01:00Z",
        runtimeConfig: {
          model: "gpt-5",
          disabledSkills: [],
          mcpServers: {},
        },
      },
      {
        sessionId: "session-2",
        agentId: "support-agent",
        title: "Escalation follow-up",
        startedAt: "2026-03-20T12:10:00Z",
        summary: "Handle a reopened incident",
        manifestPath: "/tmp/session-2/SESSION.md",
        turnCount: 4,
        lastTurnAt: "2026-03-20T12:12:00Z",
        runtimeConfig: {
          model: "gpt-5",
          disabledSkills: [],
          mcpServers: {},
        },
      },
    ]);
    apiMocks.getSession.mockImplementation(
      async (_agentId: string, sessionId: string) => ({
        sessionId,
        agentId: "support-agent",
        title:
          sessionId === "session-2" ? "Escalation follow-up" : "Support chat",
        startedAt:
          sessionId === "session-2"
            ? "2026-03-20T12:10:00Z"
            : "2026-03-20T12:00:00Z",
        summary:
          sessionId === "session-2"
            ? "Handle a reopened incident"
            : "Investigate memory analysis behavior",
        manifestPath: `/tmp/${sessionId}/SESSION.md`,
        turnCount: sessionId === "session-2" ? 4 : 2,
        lastTurnAt:
          sessionId === "session-2"
            ? "2026-03-20T12:12:00Z"
            : "2026-03-20T12:01:00Z",
        runtimeConfig: {
          model: "gpt-5",
          disabledSkills: [],
          mcpServers: {},
        },
        turns: [
          {
            messageId: `${sessionId}-m1`,
            sender: "user" as const,
            createdAt: "2026-03-20T12:00:00Z",
            bodyMarkdown: `Open ${sessionId}`,
            relativePath: `turns/${sessionId}-m1.md`,
          },
        ],
      })
    );

    render(<App />);

    expect(apiMocks.getSession).not.toHaveBeenCalled();
  });

  it("loads a restored session only when explicitly opened", async () => {
    const user = userEvent.setup();
    localStorage.setItem(
      "min-kb-app:app-state",
      JSON.stringify({
        selectedAgentId: "support-agent",
        selectedSessionId: "session-1",
        preferNewSession: false,
        draftConfig: {
          provider: "copilot",
          model: "gpt-5",
          disabledSkills: [],
          mcpServers: {},
        },
        draftMcpText: "{}",
      })
    );

    render(<App />);

    const openButton = (
      await screen.findAllByRole("button", {
        name: "Open chat",
      })
    )[0];
    expect(openButton).toBeDefined();
    if (!openButton) {
      throw new Error("Expected an Open chat button.");
    }
    await user.click(openButton);

    await waitFor(() => expect(apiMocks.getSession).toHaveBeenCalledTimes(1));
    expect(apiMocks.getSession).toHaveBeenCalledWith(
      "support-agent",
      "session-1"
    );
  });
});
