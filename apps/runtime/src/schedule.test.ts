import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { resolveWorkspace } from "@min-kb-app/min-kb-store";
import type { OrchestratorSession } from "@min-kb-app/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ChatScheduleService } from "./schedule.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))
  );
});

describe("ChatScheduleService", () => {
  it("supports orchestrator-backed schedule tasks", async () => {
    const root = await createStoreFixture();
    const workspace = await resolveWorkspace({
      storeRoot: root,
      copilotConfigDir: path.join(root, ".copilot-home"),
    });
    const runScheduledOrchestrator = vi.fn().mockResolvedValue(undefined);
    const service = new ChatScheduleService(workspace, {
      resolveAgent: vi.fn(async () => undefined),
      resolveOrchestratorSession: vi.fn(async (sessionId: string) =>
        buildOrchestratorSession(sessionId, root)
      ),
      runScheduledChat: vi.fn().mockResolvedValue(undefined),
      runScheduledOrchestrator,
      intervalMs: 60_000,
    });

    const task = await service.createTask({
      targetKind: "orchestrator",
      orchestratorSessionId: "ship-session",
      title: "Ship nightly changes",
      prompt: "Commit the current changes and push them to the remote.",
      frequency: "daily",
      timeOfDay: "21:00",
      timezone: "UTC",
      enabled: true,
    });

    expect(task.targetKind).toBe("orchestrator");
    expect(task.orchestratorSessionId).toBe("ship-session");
    expect(task.chatSessionId).toBeUndefined();

    const completedTask = await service.runNow(task.scheduleId);

    expect(runScheduledOrchestrator).toHaveBeenCalledWith({
      sessionId: "ship-session",
      prompt: "Commit the current changes and push them to the remote.",
    });
    expect(completedTask.lastRunStatus).toBe("completed");
    expect(completedTask.totalRuns).toBe(1);
  });
});

async function createStoreFixture(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "min-kb-app-schedule-"));
  roots.push(root);
  await Promise.all([
    mkdir(path.join(root, "agents", "default"), { recursive: true }),
    mkdir(path.join(root, "memory", "shared", "short-term"), {
      recursive: true,
    }),
    mkdir(path.join(root, "memory", "shared", "long-term"), {
      recursive: true,
    }),
    mkdir(path.join(root, "skills"), { recursive: true }),
  ]);
  return root;
}

function buildOrchestratorSession(
  sessionId: string,
  root: string
): OrchestratorSession {
  return {
    sessionId,
    agentId: "copilot-orchestrator",
    title: "Ship repo changes",
    startedAt: "2026-03-23T00:00:00.000Z",
    updatedAt: "2026-03-23T00:00:00.000Z",
    summary: "Ship repo changes",
    projectPath: root,
    projectPurpose: "Ship repo changes",
    model: "gpt-5",
    tmuxSessionName: "min-kb-app-orchestrator",
    tmuxWindowName: "ship-repo-changes",
    tmuxPaneId: "%42",
    status: "idle",
    availableCustomAgents: [],
    sessionDirectory: path.join(root, "agents", "copilot-orchestrator"),
    manifestPath:
      "agents/copilot-orchestrator/history/2026-03/ship-session/SESSION.md",
    jobs: [],
    terminalTail: "",
    logSize: 0,
  };
}
