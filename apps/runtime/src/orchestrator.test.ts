import type { ChatSession, OrchestratorSession } from "@min-kb-app/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";

const storeMocks = vi.hoisted(() => ({
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
    updateOrchestratorJob: storeMocks.updateOrchestratorJob,
    updateOrchestratorSession: storeMocks.updateOrchestratorSession,
    writeOrchestratorJobCompletion: storeMocks.writeOrchestratorJobCompletion,
  };
});

import {
  buildCopilotCommand,
  buildDelegationShellScript,
  buildMemoryAnalysisPrompt,
  deriveSessionStatus,
  shouldMaterializePrompt,
  TmuxOrchestratorService,
} from "./orchestrator.js";

beforeEach(() => {
  vi.clearAllMocks();
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
      })
    ).toContain("copilot --model 'gpt-5.4' --yolo -p");
  });

  it("references a prompt file for large prompts", () => {
    const command = buildCopilotCommand({
      model: "claude-sonnet-4.6",
      prompt: "See file",
      promptMode: "file",
      promptPath: "/tmp/prompt.txt",
      projectPurpose: "Review logs",
    });
    expect(command).toContain("/tmp/prompt.txt");
    expect(command).toContain("Project purpose: Review logs");
  });
});

describe("buildDelegationShellScript", () => {
  it("writes completion markers and notifies tmux", () => {
    const script = buildDelegationShellScript({
      jobId: "job-1234",
      donePath: "/tmp/job-1234/DONE.json",
      model: "gpt-5.4",
      prompt: "Investigate the regression",
      promptMode: "inline",
      projectPurpose: "Repair regressions",
      tmuxTarget: "%42",
    });

    expect(script).toContain("tmux display-message");
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
  it("formats a chat transcript for GPT-4.1 memory review", () => {
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
        model: "claude-sonnet-4.6",
        tmuxWindowName: "project-payments-platform-on",
      }
    );
    expect(result).toEqual(updatedSession);
  });
});
