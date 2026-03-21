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
  listSkills: vi.fn(),
  getSession: vi.fn(),
  getOrchestratorCapabilities: vi.fn(),
  analyzeMemory: vi.fn(),
  sendMessage: vi.fn(),
  delegateOrchestratorJob: vi.fn(),
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
          supportsSkills: false,
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

    await waitFor(() => expect(apiMocks.sendMessage).toHaveBeenCalledTimes(1));
    expect(apiMocks.sendMessage).toHaveBeenCalledWith(
      "support-agent",
      "session-1",
      expect.objectContaining({
        prompt: expect.stringContaining("image"),
        attachment: expect.objectContaining({
          name: "diagram.png",
          contentType: "image/png",
          size: 4,
        }),
      })
    );
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
});
