import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { resolveWorkspace } from "@min-kb-app/min-kb-store";
import type {
  ChatSession,
  OrchestratorJob,
  OrchestratorSession,
} from "@min-kb-app/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const storeMocks = vi.hoisted(() => ({
  createOrchestratorJob: vi.fn(),
  deleteOrchestratorJob: vi.fn(),
  deleteOrchestratorSession: vi.fn(),
  getOrchestratorSession: vi.fn(),
  resetOrchestratorTerminalLog: vi.fn(),
  updateOrchestratorJob: vi.fn(),
  updateOrchestratorSession: vi.fn(),
  writeOrchestratorJobCompletion: vi.fn(),
}));

vi.mock("@min-kb-app/min-kb-store", async () => {
  const actual = await vi.importActual<
    typeof import("@min-kb-app/min-kb-store")
  >("@min-kb-app/min-kb-store");
  return {
    ...actual,
    createOrchestratorJob: storeMocks.createOrchestratorJob,
    deleteOrchestratorJob: storeMocks.deleteOrchestratorJob,
    deleteOrchestratorSession: storeMocks.deleteOrchestratorSession,
    getOrchestratorSession: storeMocks.getOrchestratorSession,
    resetOrchestratorTerminalLog: storeMocks.resetOrchestratorTerminalLog,
    updateOrchestratorJob: storeMocks.updateOrchestratorJob,
    updateOrchestratorSession: storeMocks.updateOrchestratorSession,
    writeOrchestratorJobCompletion: storeMocks.writeOrchestratorJobCompletion,
  };
});

import {
  buildCopilotCommand,
  buildDelegationShellScript,
  buildMemoryAnalysisPrompt,
  buildMemoryAnalysisRuntimeConfig,
  DEFAULT_MEMORY_ANALYSIS_MODEL,
  deriveSessionStatus,
  isMemorySkillName,
  parseMemoryAnalysisMarkdown,
  resolveMemoryAnalysisModel,
  shouldMaterializePrompt,
  TmuxOrchestratorService,
} from "./orchestrator.js";

const tempRoots: string[] = [];

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(async () => {
  await Promise.all(
    tempRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true }))
  );
});

async function createTempJobDirectory(): Promise<string> {
  const root = await mkdtemp(
    path.join(os.tmpdir(), "min-kb-app-orch-runtime-")
  );
  tempRoots.push(root);
  return root;
}

async function createTempWorkspaceRoot(): Promise<string> {
  const root = await mkdtemp(
    path.join(os.tmpdir(), "min-kb-app-orch-workspace-")
  );
  tempRoots.push(root);
  return root;
}

beforeEach(() => {
  storeMocks.createOrchestratorJob.mockReset();
  storeMocks.getOrchestratorSession.mockReset();
  storeMocks.resetOrchestratorTerminalLog.mockReset();
});

describe("TmuxOrchestratorService.createSession", () => {
  it("defaults new sessions to the implementation orchestrator custom agent", async () => {
    const root = await createTempWorkspaceRoot();
    await mkdir(path.join(root, ".github", "agents"), { recursive: true });
    await writeFile(
      path.join(
        root,
        ".github",
        "agents",
        "implementation-orchestrator.agent.md"
      ),
      [
        "---",
        "name: Implementation Orchestrator",
        "description: Coordinates the specialist Copilot agents.",
        "---",
        "",
        "Delegate implementation through the specialist team.",
        "",
      ].join("\n"),
      "utf8"
    );
    const workspace = await resolveWorkspace({
      storeRoot: root,
      copilotConfigDir: path.join(root, ".copilot-home"),
    });
    const service = new TmuxOrchestratorService(workspace, root);
    Object.assign(service as object, {
      assertCapabilities: vi.fn().mockResolvedValue(undefined),
      createWindow: vi.fn().mockResolvedValue("%42"),
      getSession: vi.fn().mockResolvedValue({
        sessionId: "2026-03-23-ship-a-coordinated-implementation",
        agentId: "copilot-orchestrator",
        title: "Ship a coordinated implementation",
        startedAt: "2026-03-23T00:00:00.000Z",
        updatedAt: "2026-03-23T00:00:00.000Z",
        summary: "Ship a coordinated implementation",
        projectPath: root,
        projectPurpose: "Ship a coordinated implementation",
        model: "gpt-5.4",
        tmuxSessionName: "min-kb-app-orchestrator",
        tmuxWindowName: "tmp-ship-a-coordinated-impl",
        tmuxPaneId: "%42",
        status: "idle",
        activeJobId: undefined,
        lastJobId: undefined,
        availableCustomAgents: [
          {
            id: "implementation-orchestrator",
            name: "Implementation Orchestrator",
            description: "Coordinates the specialist Copilot agents.",
            path: ".github/agents/implementation-orchestrator.agent.md",
          },
        ],
        selectedCustomAgentId: "implementation-orchestrator",
        sessionDirectory: path.join(
          root,
          "agents",
          "copilot-orchestrator",
          "history",
          "2026-03",
          "2026-03-23-ship-a-coordinated-implementation"
        ),
        manifestPath:
          "agents/copilot-orchestrator/history/2026-03/2026-03-23-ship-a-coordinated-implementation/SESSION.md",
        jobs: [],
        terminalTail: "",
        logSize: 0,
      }),
    });

    const session = await service.createSession({
      projectPath: root,
      projectPurpose: "Ship a coordinated implementation",
      model: "gpt-5.4",
    });

    expect(session.availableCustomAgents).toEqual([
      {
        id: "implementation-orchestrator",
        name: "Implementation Orchestrator",
        description: "Coordinates the specialist Copilot agents.",
        path: ".github/agents/implementation-orchestrator.agent.md",
      },
    ]);
    expect(session.selectedCustomAgentId).toBe("implementation-orchestrator");
  });
});

describe("TmuxOrchestratorService.delegate", () => {
  it("queues another job instead of rejecting when a session is already running", async () => {
    const runningJob: OrchestratorJob = {
      jobId: "job-1",
      sessionId: "session-1",
      promptPreview: "Investigate the stuck deploy",
      promptMode: "inline",
      status: "running",
      submittedAt: "2026-03-20T12:03:00Z",
      startedAt: "2026-03-20T12:03:05Z",
      jobDirectory: await createTempJobDirectory(),
    };
    const queuedJob: OrchestratorJob = {
      jobId: "job-2",
      sessionId: "session-1",
      promptPreview: "Write the rollback checklist",
      promptMode: "inline",
      status: "queued",
      submittedAt: "2026-03-20T12:04:00Z",
      jobDirectory: await createTempJobDirectory(),
    };
    const runningSession: OrchestratorSession = {
      sessionId: "session-1",
      agentId: "copilot-orchestrator",
      title: "Repo support",
      startedAt: "2026-03-20T12:00:00Z",
      updatedAt: "2026-03-20T12:05:00Z",
      summary: "Handle runtime support work",
      projectPath: "/tmp/project",
      projectPurpose: "Handle runtime support work",
      model: "gpt-5.4",
      tmuxSessionName: "min-kb-app-orchestrator",
      tmuxWindowName: "project-repo-support-0001",
      tmuxPaneId: "%42",
      status: "running",
      activeJobId: "job-1",
      lastJobId: "job-1",
      availableCustomAgents: [],
      selectedCustomAgentId: undefined,
      sessionDirectory: "/tmp/orchestrator/session-1",
      manifestPath:
        "agents/copilot-orchestrator/history/2026-03/session-1/SESSION.md",
      jobs: [runningJob],
      terminalTail: "",
      logSize: 0,
    };
    const queuedSession: OrchestratorSession = {
      ...runningSession,
      updatedAt: "2026-03-20T12:06:00Z",
      lastJobId: "job-2",
      jobs: [queuedJob, runningJob],
    };

    const service = new TmuxOrchestratorService(
      { agentsRoot: "/tmp" } as never,
      "/tmp",
      undefined,
      vi.fn(async () => ({
        id: "gpt-5.4",
        displayName: "GPT-5.4",
        runtimeProvider: "copilot",
        provider: "OpenAI",
        premiumRequestMultiplier: 2,
        supportedReasoningEfforts: [],
      }))
    );
    Object.assign(service as object, {
      getSession: vi
        .fn()
        .mockResolvedValueOnce(runningSession)
        .mockResolvedValueOnce(queuedSession),
      runTmux: vi.fn(),
      getCapabilities: vi.fn().mockResolvedValue({
        available: true,
        defaultProjectPath: "/tmp",
        recentProjectPaths: [],
        tmuxInstalled: true,
        copilotInstalled: true,
        tmuxSessionName: "min-kb-app-orchestrator",
      }),
    });
    storeMocks.createOrchestratorJob.mockResolvedValueOnce(queuedJob);

    const result = await service.delegate(
      "session-1",
      "Write the rollback checklist"
    );

    expect(storeMocks.createOrchestratorJob).toHaveBeenCalledWith(
      expect.anything(),
      "session-1",
      expect.objectContaining({
        promptPreview: "Write the rollback checklist",
        promptMode: "inline",
        premiumUsage: {
          source: "tmux-estimate",
          model: "gpt-5.4",
          premiumRequestUnits: 2,
          billingMultiplier: 2,
          recordedAt: expect.any(String),
        },
      })
    );
    expect(storeMocks.updateOrchestratorSession).toHaveBeenCalledWith(
      expect.anything(),
      "session-1",
      {
        lastJobId: "job-2",
        status: "running",
      }
    );
    expect(storeMocks.updateOrchestratorJob).toHaveBeenCalledWith(
      expect.anything(),
      "session-1",
      "job-2",
      expect.objectContaining({
        outputPath: expect.stringContaining("/output.log"),
      })
    );
    expect(result).toEqual(queuedSession);
  });

  it("passes the selected custom agent through to queued jobs", async () => {
    const queuedJob: OrchestratorJob = {
      jobId: "job-2",
      sessionId: "session-1",
      promptPreview: "Review the release diff",
      promptMode: "inline",
      customAgentId: "reviewer",
      status: "queued",
      submittedAt: "2026-03-20T12:04:00Z",
      jobDirectory: await createTempJobDirectory(),
    };
    const session: OrchestratorSession = {
      sessionId: "session-1",
      agentId: "copilot-orchestrator",
      title: "Repo support",
      startedAt: "2026-03-20T12:00:00Z",
      updatedAt: "2026-03-20T12:05:00Z",
      summary: "Handle runtime support work",
      projectPath: "/tmp/project",
      projectPurpose: "Handle runtime support work",
      model: "gpt-5.4",
      tmuxSessionName: "min-kb-app-orchestrator",
      tmuxWindowName: "project-repo-support-0001",
      tmuxPaneId: "%42",
      status: "idle",
      activeJobId: undefined,
      lastJobId: undefined,
      availableCustomAgents: [
        {
          id: "reviewer",
          name: "Reviewer",
          description: "Reviews changes.",
          path: ".github/agents/reviewer.agent.md",
        },
      ],
      selectedCustomAgentId: undefined,
      sessionDirectory: "/tmp/orchestrator/session-1",
      manifestPath:
        "agents/copilot-orchestrator/history/2026-03/session-1/SESSION.md",
      jobs: [],
      terminalTail: "",
      logSize: 0,
    };
    const queuedSession: OrchestratorSession = {
      ...session,
      updatedAt: "2026-03-20T12:06:00Z",
      selectedCustomAgentId: "reviewer",
      lastJobId: "job-2",
      jobs: [queuedJob],
    };

    const service = new TmuxOrchestratorService(
      { agentsRoot: "/tmp" } as never,
      "/tmp"
    );
    Object.assign(service as object, {
      getSession: vi
        .fn()
        .mockResolvedValueOnce(session)
        .mockResolvedValueOnce(queuedSession),
      startPreparedJob: vi.fn().mockResolvedValue(undefined),
      prepareJobArtifacts: vi.fn().mockResolvedValue(queuedJob),
      getCapabilities: vi.fn().mockResolvedValue({
        available: true,
        defaultProjectPath: "/tmp",
        recentProjectPaths: [],
        tmuxInstalled: true,
        copilotInstalled: true,
        tmuxSessionName: "min-kb-app-orchestrator",
      }),
    });
    storeMocks.createOrchestratorJob.mockResolvedValueOnce(queuedJob);

    const result = await service.delegate("session-1", {
      prompt: "Review the release diff",
      customAgentId: "reviewer",
    });

    expect(storeMocks.createOrchestratorJob).toHaveBeenCalledWith(
      expect.anything(),
      "session-1",
      expect.objectContaining({
        customAgentId: "reviewer",
      })
    );
    expect(storeMocks.updateOrchestratorSession).toHaveBeenCalledWith(
      expect.anything(),
      "session-1",
      {
        selectedCustomAgentId: "reviewer",
      }
    );
    expect(result).toEqual(queuedSession);
  });
});

describe("TmuxOrchestratorService premium usage tracking", () => {
  it("increments the tmux session premium usage when a queued job starts", async () => {
    const service = new TmuxOrchestratorService(
      { agentsRoot: "/tmp" } as never,
      "/tmp"
    );
    Object.assign(service as object, {
      runTmux: vi.fn().mockResolvedValue({ stdout: "", stderr: "" }),
    });

    await Reflect.get(service, "startPreparedJob").call(
      service,
      {
        sessionId: "session-1",
        tmuxPaneId: "%42",
        premiumUsage: {
          chargedRequestCount: 1,
          premiumRequestUnits: 2,
          lastRecordedAt: "2026-03-20T12:03:00Z",
          lastModel: "gpt-5.4",
        },
      },
      {
        jobId: "job-2",
        jobDirectory: "/tmp/orchestrator/session-1/delegations/job-2",
        premiumUsage: {
          source: "tmux-estimate",
          model: "gpt-5.4",
          premiumRequestUnits: 2,
          billingMultiplier: 2,
          recordedAt: "2026-03-20T12:04:00Z",
        },
      }
    );

    expect(storeMocks.updateOrchestratorSession).toHaveBeenCalledWith(
      expect.anything(),
      "session-1",
      {
        activeJobId: "job-2",
        lastJobId: "job-2",
        premiumUsage: {
          chargedRequestCount: 2,
          premiumRequestUnits: 4,
          lastRecordedAt: "2026-03-20T12:04:00Z",
          lastModel: "gpt-5.4",
        },
        status: "running",
      }
    );
  });
});

describe("shouldMaterializePrompt", () => {
  it("spills large or multiline prompts to files", () => {
    expect(shouldMaterializePrompt("short prompt")).toBe(false);
    expect(shouldMaterializePrompt("line\n".repeat(16))).toBe(true);
    expect(shouldMaterializePrompt("x".repeat(801))).toBe(true);
  });
});

describe("buildCopilotCommand", () => {
  it("uses direct prompts when possible", () => {
    expect(
      buildCopilotCommand({
        model: "gpt-5.4",
        prompt: "Fix the flaky test",
        promptMode: "inline",
        projectPurpose: "Repair test stability",
        executionMode: "standard",
      })
    ).toContain("copilot --model 'gpt-5.4' --yolo -p");
  });

  it("includes a custom agent flag when selected", () => {
    expect(
      buildCopilotCommand({
        model: "gpt-5.4",
        prompt: "Review the release diff",
        promptMode: "inline",
        projectPurpose: "Review release risk",
        customAgentId: "reviewer",
        executionMode: "standard",
      })
    ).toContain("--agent 'reviewer'");
  });

  it("references a prompt file for large prompts", () => {
    const command = buildCopilotCommand({
      model: "claude-sonnet-4.6",
      prompt: "See file",
      promptMode: "file",
      promptPath: "/tmp/prompt.txt",
      projectPurpose: "Review logs",
      executionMode: "standard",
    });
    expect(command).toContain("/tmp/prompt.txt");
    expect(command).toContain("Project purpose: Review logs");
  });

  it("uses fleet mode when requested", () => {
    expect(
      buildCopilotCommand({
        model: "gpt-5.4",
        prompt: "Refactor auth and tests",
        promptMode: "inline",
        projectPurpose: "Ship auth cleanup",
        executionMode: "fleet",
      })
    ).toContain("--yolo -p '/fleet Refactor auth and tests'");
  });
});

describe("buildDelegationShellScript", () => {
  it("writes completion markers and notifies tmux", () => {
    const script = buildDelegationShellScript({
      jobId: "job-1234",
      donePath: "/tmp/job-1234/DONE.json",
      outputPath: "/tmp/job-1234/output.log",
      model: "gpt-5.4",
      prompt: "Investigate the regression",
      promptMode: "inline",
      projectPurpose: "Repair regressions",
      executionMode: "standard",
      tmuxTarget: "%42",
    });

    expect(script).toContain('completion_message="min-kb-app: job $job_id');
    expect(script).toContain("[min-kb-app] Notification:");
    expect(script).toContain("tmux display-message -d 15000");
    expect(script).toContain("copilot --model 'gpt-5.4' --yolo -p");
    expect(script).toContain("/tmp/job-1234/DONE.json");
  });
});

describe("deriveSessionStatus", () => {
  it("marks sessions missing when the tmux pane disappears", () => {
    expect(
      deriveSessionStatus(
        {
          status: "running",
          activeJobId: "job-1",
          lastJobId: "job-1",
          jobs: [],
        },
        false
      )
    ).toEqual({
      status: "missing",
      activeJobId: undefined,
      lastJobId: "job-1",
    });
  });
});

describe("buildMemoryAnalysisPrompt", () => {
  it("formats a chat transcript for skill-driven memory updates", () => {
    const thread: ChatSession = {
      sessionId: "thread-1",
      agentId: "coding-agent",
      title: "Auth debugging",
      startedAt: "2026-03-20T12:00:00Z",
      summary: "Investigating auth redirects",
      manifestPath: "agents/coding-agent/history/2026-03/thread-1/SESSION.md",
      turnCount: 2,
      turns: [
        {
          messageId: "m1",
          sender: "user",
          createdAt: "2026-03-20T12:00:00Z",
          bodyMarkdown: "Please remember that redirects fail on Safari.",
          relativePath: "turns/m1.md",
        },
        {
          messageId: "m2",
          sender: "assistant",
          createdAt: "2026-03-20T12:01:00Z",
          bodyMarkdown: "I will investigate the Safari-specific cookie flow.",
          relativePath: "turns/m2.md",
        },
      ],
    };

    const prompt = buildMemoryAnalysisPrompt(thread, [
      "memory-capture",
      "capture-working-memory",
    ]);
    expect(prompt).toContain("Working memory");
    expect(prompt).toContain("capture-working-memory");
    expect(prompt).toContain("Safari-specific cookie flow");
    expect(prompt).toContain("exactly three sections");
    expect(prompt).toContain("If you are unsure which tier applies");
  });
});

describe("parseMemoryAnalysisMarkdown", () => {
  it("extracts working, short-term, and long-term sections", () => {
    expect(
      parseMemoryAnalysisMarkdown(`## Working memory

Keep the active incident in view.
- Follow up with the on-call engineer

## Short-term memory

Track the open rollout decision.
- Revisit after tomorrow's deployment

## Long-term memory

Remember the user's preferred release window.
- Deploy after 6pm local time`)
    ).toEqual({
      working: {
        summary: "Keep the active incident in view.",
        items: ["Follow up with the on-call engineer"],
      },
      shortTerm: {
        summary: "Track the open rollout decision.",
        items: ["Revisit after tomorrow's deployment"],
      },
      longTerm: {
        summary: "Remember the user's preferred release window.",
        items: ["Deploy after 6pm local time"],
      },
    });
  });

  it("accepts inline section labels and numbered bullets from weaker models", () => {
    expect(
      parseMemoryAnalysisMarkdown(`Working memory: Keep the rollback owner visible.
1. Page the on-call engineer

Short-term memory - Revisit after tomorrow's deployment.
2. Verify the retry window

Long-term memory
3. The user prefers blue-green deploys`)
    ).toEqual({
      working: {
        summary: "Keep the rollback owner visible.",
        items: ["Page the on-call engineer"],
      },
      shortTerm: {
        summary: "Revisit after tomorrow's deployment.",
        items: ["Verify the retry window"],
      },
      longTerm: {
        summary: "",
        items: ["The user prefers blue-green deploys"],
      },
    });
  });

  it("falls back to working memory when the model skips section headings", () => {
    expect(
      parseMemoryAnalysisMarkdown(
        "Keep the deployment owner visible.\n- Check again after tomorrow's deploy"
      )
    ).toEqual({
      working: {
        summary: "Keep the deployment owner visible.",
        items: ["Check again after tomorrow's deploy"],
      },
      shortTerm: {
        summary: "",
        items: [],
      },
      longTerm: {
        summary: "",
        items: [],
      },
    });
  });
});

describe("isMemorySkillName", () => {
  it("matches memory skill names with spaces or hyphens", () => {
    expect(isMemorySkillName("capture working memory")).toBe(true);
    expect(isMemorySkillName("capture-short term")).toBe(true);
    expect(isMemorySkillName("project long-term notes")).toBe(true);
    expect(isMemorySkillName("repo-search")).toBe(false);
  });
});

describe("resolveMemoryAnalysisModel", () => {
  it("defaults memory analysis to gpt-5-mini", () => {
    expect(resolveMemoryAnalysisModel()).toBe(DEFAULT_MEMORY_ANALYSIS_MODEL);
  });

  it("accepts an explicit memory analysis model override", () => {
    expect(resolveMemoryAnalysisModel("gpt-5.4-mini")).toBe("gpt-5.4-mini");
  });
});

describe("buildMemoryAnalysisRuntimeConfig", () => {
  it("disables non-memory skills during memory analysis", () => {
    expect(
      buildMemoryAnalysisRuntimeConfig({
        availableSkillNames: [
          "repo-search",
          "memory-capture",
          "capture-working-memory",
        ],
        baseConfig: {
          reasoningEffort: "high",
          mcpServers: {
            github: {
              type: "local",
              command: "node",
              args: ["server.js"],
              env: {},
              tools: ["*"],
            },
          },
        },
      })
    ).toEqual({
      provider: "copilot",
      model: DEFAULT_MEMORY_ANALYSIS_MODEL,
      reasoningEffort: "high",
      mcpServers: {
        github: {
          type: "local",
          command: "node",
          args: ["server.js"],
          env: {},
          tools: ["*"],
        },
      },
      disabledSkills: ["repo-search"],
    });
  });
});

describe("TmuxOrchestratorService.cancelJob", () => {
  it("marks the active job failed and recreates the tmux pane", async () => {
    const runningJob = {
      jobId: "job-1",
      sessionId: "session-1",
      promptPreview: "Investigate the stuck deploy",
      promptMode: "inline" as const,
      status: "running" as const,
      submittedAt: "2026-03-20T12:03:00Z",
      startedAt: "2026-03-20T12:03:05Z",
      jobDirectory: "/tmp/orchestrator/session-1/delegations/job-1",
    };
    const runningSession: OrchestratorSession = {
      sessionId: "session-1",
      agentId: "copilot-orchestrator",
      title: "Repo support",
      startedAt: "2026-03-20T12:00:00Z",
      updatedAt: "2026-03-20T12:05:00Z",
      summary: "Handle runtime support work",
      projectPath: "/tmp/project",
      projectPurpose: "Handle runtime support work",
      model: "gpt-5.4",
      tmuxSessionName: "min-kb-app-orchestrator",
      tmuxWindowName: "project-repo-support-0001",
      tmuxPaneId: "%42",
      status: "running",
      activeJobId: "job-1",
      lastJobId: "job-1",
      availableCustomAgents: [],
      selectedCustomAgentId: undefined,
      sessionDirectory: "/tmp/orchestrator/session-1",
      manifestPath:
        "agents/copilot-orchestrator/history/2026-03/session-1/SESSION.md",
      jobs: [runningJob],
      terminalTail: "",
      logSize: 0,
    };
    const recoveredSession: OrchestratorSession = {
      ...runningSession,
      tmuxPaneId: "%99",
      status: "failed",
      activeJobId: undefined,
      jobs: [
        {
          ...runningJob,
          status: "failed",
          completedAt: "2026-03-20T12:06:00Z",
          exitCode: -1,
        },
      ],
    };

    const service = new TmuxOrchestratorService(
      { agentsRoot: "/tmp" } as never,
      "/tmp"
    );
    const getSession = vi
      .fn()
      .mockResolvedValueOnce(runningSession)
      .mockResolvedValueOnce(recoveredSession);
    const runTmux = vi.fn().mockResolvedValue({ stdout: "", stderr: "" });
    const createWindow = vi.fn().mockResolvedValue("%99");

    Object.assign(service as object, {
      getSession,
      tmuxPaneExists: vi.fn().mockResolvedValue(true),
      readTmuxValue: vi.fn().mockResolvedValue("@7"),
      runTmux,
      createWindow,
    });

    const result = await service.cancelJob("session-1");

    expect(runTmux).toHaveBeenCalledWith(["kill-window", "-t", "@7"]);
    expect(createWindow).toHaveBeenCalledWith({
      projectPath: "/tmp/project",
      tmuxWindowName: "project-repo-support-0001",
      startedAt: "2026-03-20T12:00:00Z",
      title: "Repo support",
      sessionId: "session-1",
    });
    expect(storeMocks.updateOrchestratorJob).toHaveBeenCalledWith(
      expect.anything(),
      "session-1",
      "job-1",
      expect.objectContaining({
        status: "failed",
        exitCode: -1,
        completedAt: expect.any(String),
      })
    );
    expect(storeMocks.writeOrchestratorJobCompletion).toHaveBeenCalledWith(
      expect.anything(),
      "session-1",
      "job-1",
      {
        exitCode: -1,
        completedAt: expect.any(String),
      }
    );
    expect(storeMocks.updateOrchestratorSession).toHaveBeenCalledWith(
      expect.anything(),
      "session-1",
      {
        tmuxPaneId: "%99",
        status: "failed",
        activeJobId: undefined,
        lastJobId: "job-1",
      }
    );
    expect(result).toEqual(recoveredSession);
  });
});

describe("TmuxOrchestratorService.deleteSession", () => {
  it("kills the tmux window before deleting persisted session data", async () => {
    const session: OrchestratorSession = {
      sessionId: "session-1",
      agentId: "copilot-orchestrator",
      title: "Repo support",
      startedAt: "2026-03-20T12:00:00Z",
      updatedAt: "2026-03-20T12:05:00Z",
      summary: "Handle runtime support work",
      projectPath: "/tmp/project",
      projectPurpose: "Handle runtime support work",
      model: "gpt-5.4",
      tmuxSessionName: "min-kb-app-orchestrator",
      tmuxWindowName: "project-repo-support-0001",
      tmuxPaneId: "%42",
      status: "idle",
      activeJobId: undefined,
      lastJobId: undefined,
      availableCustomAgents: [],
      selectedCustomAgentId: undefined,
      sessionDirectory: "/tmp/orchestrator/session-1",
      manifestPath:
        "agents/copilot-orchestrator/history/2026-03/session-1/SESSION.md",
      jobs: [],
      terminalTail: "",
      logSize: 0,
    };
    const service = new TmuxOrchestratorService(
      { agentsRoot: "/tmp" } as never,
      "/tmp"
    );
    const runTmux = vi.fn().mockResolvedValue({ stdout: "", stderr: "" });
    Object.assign(service as object, {
      getSession: vi.fn().mockResolvedValue(session),
      tmuxPaneExists: vi.fn().mockResolvedValue(true),
      readTmuxValue: vi.fn().mockResolvedValue("@7"),
      runTmux,
    });

    await service.deleteSession("session-1");

    expect(runTmux).toHaveBeenCalledWith(["kill-window", "-t", "@7"]);
    expect(storeMocks.deleteOrchestratorSession).toHaveBeenCalledWith(
      expect.anything(),
      "session-1"
    );
  });
});

describe("TmuxOrchestratorService.restartSession", () => {
  it("creates a fresh tmux pane and clears previous terminal logs", async () => {
    const session: OrchestratorSession = {
      sessionId: "session-1",
      agentId: "copilot-orchestrator",
      title: "Repo support",
      startedAt: "2026-03-20T12:00:00Z",
      updatedAt: "2026-03-20T12:05:00Z",
      summary: "Handle runtime support work",
      projectPath: "/tmp/project",
      projectPurpose: "Handle runtime support work",
      model: "gpt-5.4",
      tmuxSessionName: "min-kb-app-orchestrator",
      tmuxWindowName: "project-repo-support-0001",
      tmuxPaneId: "%42",
      status: "completed",
      activeJobId: undefined,
      lastJobId: "job-1",
      availableCustomAgents: [],
      selectedCustomAgentId: undefined,
      sessionDirectory: "/tmp/orchestrator/session-1",
      manifestPath:
        "agents/copilot-orchestrator/history/2026-03/session-1/SESSION.md",
      jobs: [],
      terminalTail: "old output",
      logSize: 10,
    };
    const restartedSession: OrchestratorSession = {
      ...session,
      tmuxPaneId: "%99",
      terminalTail: "[min-kb-app] Ready for Repo support\n",
      logSize: 36,
    };

    const service = new TmuxOrchestratorService(
      { agentsRoot: "/tmp" } as never,
      "/tmp"
    );
    const createWindow = vi.fn().mockResolvedValue("%99");

    Object.assign(service as object, {
      getCapabilities: vi.fn().mockResolvedValue({
        available: true,
        defaultProjectPath: "/tmp",
        recentProjectPaths: [],
        tmuxInstalled: true,
        copilotInstalled: true,
        tmuxSessionName: "min-kb-app-orchestrator",
      }),
      getSession: vi.fn().mockResolvedValue(restartedSession),
      createWindow,
      killWindowForPane: vi.fn().mockResolvedValue(undefined),
    });
    storeMocks.getOrchestratorSession.mockResolvedValue(session);

    const result = await service.restartSession("session-1");

    expect(storeMocks.resetOrchestratorTerminalLog).toHaveBeenCalledWith(
      expect.anything(),
      "session-1"
    );
    expect(createWindow).toHaveBeenCalledWith({
      projectPath: "/tmp/project",
      tmuxWindowName: "project-repo-support-0001",
      startedAt: "2026-03-20T12:00:00Z",
      title: "Repo support",
      sessionId: "session-1",
    });
    expect(storeMocks.updateOrchestratorSession).toHaveBeenCalledWith(
      expect.anything(),
      "session-1",
      {
        tmuxPaneId: "%99",
        activeJobId: undefined,
        status: "idle",
      }
    );
    expect(result).toEqual(restartedSession);
  });
});

describe("TmuxOrchestratorService.deleteQueuedJob", () => {
  it("removes queued jobs and returns the refreshed session", async () => {
    const queuedJob: OrchestratorJob = {
      jobId: "job-2",
      sessionId: "session-1",
      promptPreview: "Write the rollback checklist",
      promptMode: "inline",
      status: "queued",
      submittedAt: "2026-03-20T12:04:00Z",
      jobDirectory: "/tmp/job-2",
    };
    const session: OrchestratorSession = {
      sessionId: "session-1",
      agentId: "copilot-orchestrator",
      title: "Repo support",
      startedAt: "2026-03-20T12:00:00Z",
      updatedAt: "2026-03-20T12:05:00Z",
      summary: "Handle runtime support work",
      projectPath: "/tmp/project",
      projectPurpose: "Handle runtime support work",
      model: "gpt-5.4",
      tmuxSessionName: "min-kb-app-orchestrator",
      tmuxWindowName: "project-repo-support-0001",
      tmuxPaneId: "%42",
      status: "running",
      activeJobId: "job-1",
      lastJobId: "job-2",
      availableCustomAgents: [],
      selectedCustomAgentId: undefined,
      sessionDirectory: "/tmp/orchestrator/session-1",
      manifestPath:
        "agents/copilot-orchestrator/history/2026-03/session-1/SESSION.md",
      jobs: [queuedJob],
      terminalTail: "",
      logSize: 0,
    };
    const refreshedSession: OrchestratorSession = {
      ...session,
      lastJobId: "job-1",
      jobs: [],
    };
    const service = new TmuxOrchestratorService(
      { agentsRoot: "/tmp" } as never,
      "/tmp"
    );
    Object.assign(service as object, {
      getSession: vi
        .fn()
        .mockResolvedValueOnce(session)
        .mockResolvedValueOnce(refreshedSession),
    });

    const result = await service.deleteQueuedJob("session-1", "job-2");

    expect(storeMocks.deleteOrchestratorJob).toHaveBeenCalledWith(
      expect.anything(),
      "session-1",
      "job-2"
    );
    expect(result).toEqual(refreshedSession);
  });
});

describe("TmuxOrchestratorService queue recovery", () => {
  it("starts the oldest queued job after the active one finishes", async () => {
    const completedJob: OrchestratorJob = {
      jobId: "job-1",
      sessionId: "session-1",
      promptPreview: "Investigate the stuck deploy",
      promptMode: "inline",
      status: "completed",
      submittedAt: "2026-03-20T12:03:00Z",
      startedAt: "2026-03-20T12:03:05Z",
      completedAt: "2026-03-20T12:05:00Z",
      exitCode: 0,
      jobDirectory: await createTempJobDirectory(),
    };
    const queuedJob: OrchestratorJob = {
      jobId: "job-2",
      sessionId: "session-1",
      promptPreview: "Write the rollback checklist",
      promptMode: "inline",
      status: "queued",
      submittedAt: "2026-03-20T12:04:00Z",
      jobDirectory: await createTempJobDirectory(),
    };
    const staleSession: OrchestratorSession = {
      sessionId: "session-1",
      agentId: "copilot-orchestrator",
      title: "Repo support",
      startedAt: "2026-03-20T12:00:00Z",
      updatedAt: "2026-03-20T12:05:00Z",
      summary: "Handle runtime support work",
      projectPath: "/tmp/project",
      projectPurpose: "Handle runtime support work",
      model: "gpt-5.4",
      tmuxSessionName: "min-kb-app-orchestrator",
      tmuxWindowName: "project-repo-support-0001",
      tmuxPaneId: "%42",
      status: "completed",
      activeJobId: undefined,
      lastJobId: "job-1",
      availableCustomAgents: [],
      selectedCustomAgentId: undefined,
      sessionDirectory: "/tmp/orchestrator/session-1",
      manifestPath:
        "agents/copilot-orchestrator/history/2026-03/session-1/SESSION.md",
      jobs: [queuedJob, completedJob],
      terminalTail: "",
      logSize: 0,
    };
    const recoveredSession: OrchestratorSession = {
      ...staleSession,
      updatedAt: "2026-03-20T12:06:00Z",
      status: "running",
      activeJobId: "job-2",
      lastJobId: "job-2",
      jobs: [
        { ...queuedJob, status: "running", startedAt: "2026-03-20T12:06:00Z" },
        completedJob,
      ],
    };

    const service = new TmuxOrchestratorService(
      { agentsRoot: "/tmp" } as never,
      "/tmp"
    );
    Object.assign(service as object, {
      tmuxPaneExists: vi.fn().mockResolvedValue(true),
      runTmux: vi.fn().mockResolvedValue({ stdout: "", stderr: "" }),
    });
    storeMocks.getOrchestratorSession.mockResolvedValueOnce(recoveredSession);

    const reconcileSession = (
      service as unknown as {
        reconcileSession: (
          session: OrchestratorSession
        ) => Promise<OrchestratorSession>;
      }
    ).reconcileSession.bind(service);

    const result = await reconcileSession(staleSession);

    expect(storeMocks.updateOrchestratorJob).toHaveBeenCalledWith(
      expect.anything(),
      "session-1",
      "job-2",
      expect.objectContaining({
        status: "running",
        startedAt: expect.any(String),
      })
    );
    expect(storeMocks.updateOrchestratorSession).toHaveBeenCalledWith(
      expect.anything(),
      "session-1",
      {
        activeJobId: "job-2",
        lastJobId: "job-2",
        status: "running",
      }
    );
    expect(result).toEqual(recoveredSession);
  });
});

describe("TmuxOrchestratorService.updateSession", () => {
  it("updates the saved title and model and renames the tmux window", async () => {
    const existingSession: OrchestratorSession = {
      sessionId: "session-1",
      agentId: "copilot-orchestrator",
      title: "Repo support",
      startedAt: "2026-03-20T12:00:00Z",
      updatedAt: "2026-03-20T12:05:00Z",
      summary: "Handle runtime support work",
      projectPath: "/tmp/project",
      projectPurpose: "Handle runtime support work",
      model: "gpt-5.4",
      tmuxSessionName: "min-kb-app-orchestrator",
      tmuxWindowName: "project-repo-support-0001",
      tmuxPaneId: "%42",
      status: "idle",
      activeJobId: undefined,
      lastJobId: undefined,
      availableCustomAgents: [],
      selectedCustomAgentId: undefined,
      sessionDirectory: "/tmp/orchestrator/session-1",
      manifestPath:
        "agents/copilot-orchestrator/history/2026-03/session-1/SESSION.md",
      jobs: [],
      terminalTail: "",
      logSize: 0,
    };
    const updatedSession: OrchestratorSession = {
      ...existingSession,
      title: "Payments platform",
      model: "claude-sonnet-4.6",
      tmuxWindowName: "project-payments-platform-on",
    };

    const service = new TmuxOrchestratorService(
      { agentsRoot: "/tmp" } as never,
      "/tmp"
    );
    const getSession = vi
      .fn()
      .mockResolvedValueOnce(existingSession)
      .mockResolvedValueOnce(updatedSession);
    const runTmux = vi.fn().mockResolvedValue({ stdout: "", stderr: "" });

    Object.assign(service as object, {
      getSession,
      commandExists: vi.fn().mockResolvedValue(true),
      tmuxPaneExists: vi.fn().mockResolvedValue(true),
      readTmuxValue: vi.fn().mockResolvedValue("@7"),
      runTmux,
    });

    const result = await service.updateSession("session-1", {
      title: "Payments platform",
      model: "claude-sonnet-4.6",
    });

    expect(runTmux).toHaveBeenCalledWith([
      "rename-window",
      "-t",
      "@7",
      "project-payments-platform-on",
    ]);
    expect(storeMocks.updateOrchestratorSession).toHaveBeenCalledWith(
      expect.anything(),
      "session-1",
      {
        title: "Payments platform",
        cliProvider: "copilot",
        model: "claude-sonnet-4.6",
        availableCustomAgents: [],
        selectedCustomAgentId: undefined,
        executionMode: "standard",
        tmuxWindowName: "project-payments-platform-on",
      }
    );
    expect(result).toEqual(updatedSession);
  });
});
