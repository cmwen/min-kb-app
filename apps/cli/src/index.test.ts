import type { OrchestratorSession } from "@min-kb-app/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createProgram, getLatestOrchestratorJob } from "./index.js";

describe("createProgram", () => {
  const originalFetch = globalThis.fetch;
  const originalExitCode = process.exitCode;
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    process.exitCode = undefined;
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    process.exitCode = originalExitCode;
    vi.restoreAllMocks();
  });

  it("sends a non-interactive chat message with --message", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        thread: {
          sessionId: "session-1",
          agentId: "coding-agent",
          title: "Fix auth",
          startedAt: "2026-03-21T00:00:00Z",
          summary: "Fix auth",
          manifestPath: "SESSION.md",
          turnCount: 2,
          turns: [],
        },
        assistantTurn: {
          messageId: "turn-2",
          sender: "assistant",
          createdAt: "2026-03-21T00:01:00Z",
          bodyMarkdown: "Patched the auth flow.",
          relativePath: "turns/turn-2.md",
        },
      }),
    } satisfies Partial<Response>);
    globalThis.fetch = fetchMock as typeof fetch;

    const program = createProgram();
    await program.parseAsync([
      "node",
      "min-kb-app",
      "chat",
      "coding-agent",
      "--message",
      "Fix the auth flow",
    ]);

    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:8787/api/agents/coding-agent/sessions",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          prompt: "Fix the auth flow",
          config: {
            provider: "copilot",
            model: "gpt-5-mini",
          },
        }),
      })
    );
    expect(logSpy).toHaveBeenCalledWith("Patched the auth flow.");
  });

  it("creates and queues a new orchestrator session from one command", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () =>
        ({
          sessionId: "2026-03-21-fix-auth",
          agentId: "copilot-orchestrator",
          title: "Auth fixes",
          startedAt: "2026-03-21T00:00:00Z",
          updatedAt: "2026-03-21T00:00:00Z",
          summary: "Keep auth green",
          projectPath: "/repo",
          projectPurpose: "Keep auth green",
          model: "gpt-5",
          tmuxSessionName: "min-kb-app-orchestrator",
          tmuxWindowName: "repo-auth-fixes",
          tmuxPaneId: "%42",
          status: "running",
          lastJobId: "job-1",
          availableCustomAgents: [],
          selectedCustomAgentId: undefined,
          sessionDirectory: "/repo/agents/copilot-orchestrator",
          manifestPath: "SESSION.md",
          jobs: [
            {
              jobId: "job-1",
              sessionId: "2026-03-21-fix-auth",
              promptPreview: "Fix auth",
              promptMode: "inline",
              status: "queued",
              submittedAt: "2026-03-21T00:00:00Z",
              jobDirectory: "/repo/jobs/job-1",
            },
          ],
          terminalTail: "",
          logSize: 0,
        }) satisfies OrchestratorSession,
    } satisfies Partial<Response>);
    globalThis.fetch = fetchMock as typeof fetch;

    const program = createProgram();
    await program.parseAsync([
      "node",
      "min-kb-app",
      "orchestrate",
      "Fix the auth redirect loop",
      "--project-path",
      "/repo",
      "--project-purpose",
      "Keep auth green",
      "--agent",
      "reviewer",
    ]);

    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:8787/api/orchestrator/sessions",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          title: undefined,
          projectPath: "/repo",
          projectPurpose: "Keep auth green",
          model: "gpt-5-mini",
          selectedCustomAgentId: "reviewer",
          executionMode: "standard",
          prompt: "Fix the auth redirect loop",
        }),
      })
    );
    expect(logSpy).toHaveBeenCalledWith(
      "Queued orchestrator job job-1 in session 2026-03-21-fix-auth."
    );
  });

  it("creates a fleet orchestrator session when requested", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () =>
        ({
          sessionId: "2026-03-21-fix-auth",
          agentId: "copilot-orchestrator",
          title: "Auth fixes",
          startedAt: "2026-03-21T00:00:00Z",
          updatedAt: "2026-03-21T00:00:00Z",
          summary: "Keep auth green",
          projectPath: "/repo",
          projectPurpose: "Keep auth green",
          model: "gpt-5",
          tmuxSessionName: "min-kb-app-orchestrator",
          tmuxWindowName: "repo-auth-fixes",
          tmuxPaneId: "%42",
          status: "running",
          lastJobId: "job-1",
          availableCustomAgents: [],
          selectedCustomAgentId: undefined,
          executionMode: "fleet",
          sessionDirectory: "/repo/agents/copilot-orchestrator",
          manifestPath: "SESSION.md",
          jobs: [
            {
              jobId: "job-1",
              sessionId: "2026-03-21-fix-auth",
              promptPreview: "Fix auth",
              promptMode: "inline",
              status: "queued",
              submittedAt: "2026-03-21T00:00:00Z",
              jobDirectory: "/repo/jobs/job-1",
            },
          ],
          terminalTail: "",
          logSize: 0,
        }) satisfies OrchestratorSession,
    } satisfies Partial<Response>);
    globalThis.fetch = fetchMock as typeof fetch;

    const program = createProgram();
    await program.parseAsync([
      "node",
      "min-kb-app",
      "orchestrate",
      "Fix the auth redirect loop",
      "--project-path",
      "/repo",
      "--project-purpose",
      "Keep auth green",
      "--execution-mode",
      "fleet",
    ]);

    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:8787/api/orchestrator/sessions",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          title: undefined,
          projectPath: "/repo",
          projectPurpose: "Keep auth green",
          model: "gpt-5-mini",
          selectedCustomAgentId: null,
          executionMode: "fleet",
          prompt: "Fix the auth redirect loop",
        }),
      })
    );
  });
});

describe("getLatestOrchestratorJob", () => {
  it("prefers the lastJobId when present", () => {
    expect(
      getLatestOrchestratorJob({
        lastJobId: "job-2",
        jobs: [
          {
            jobId: "job-1",
            sessionId: "session-1",
            promptPreview: "Older",
            promptMode: "inline",
            status: "completed",
            submittedAt: "2026-03-20T00:00:00Z",
            jobDirectory: "/tmp/job-1",
          },
          {
            jobId: "job-2",
            sessionId: "session-1",
            promptPreview: "Newest",
            promptMode: "inline",
            status: "queued",
            submittedAt: "2026-03-21T00:00:00Z",
            jobDirectory: "/tmp/job-2",
          },
        ],
      })?.jobId
    ).toBe("job-2");
  });
});
