import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createScheduleTask,
  deleteScheduleTask,
  getScheduleTask,
  listScheduleTasks,
  resolveWorkspace,
  toScheduleChatSummary,
} from "./index.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))
  );
});

describe("scheduled task persistence", () => {
  it("stores scheduled chats under the built-in schedule agent history tree", async () => {
    const root = await createStoreFixture();
    const workspace = await resolveWorkspace({
      storeRoot: root,
      copilotConfigDir: path.join(root, ".copilot-home"),
    });

    const task = await createScheduleTask(workspace, {
      targetKind: "chat",
      agentId: "support-agent",
      title: "Daily digest",
      prompt: "Summarize the latest support activity.",
      frequency: "daily",
      timeOfDay: "08:00",
      timezone: "UTC",
      enabled: true,
      nextRunAt: "2026-03-24T08:00:00.000Z",
      createdAt: "2026-03-23T12:00:00.000Z",
      runtimeConfig: {
        provider: "copilot",
        model: "gpt-5",
        disabledSkills: [],
        mcpServers: {},
      },
    });

    expect(task.scheduleId).toBe("2026-03-23-daily-digest");
    expect(task.chatSessionId).toBe("2026-03-23-daily-digest-chat");

    const listed = await listScheduleTasks(workspace);
    expect(listed).toHaveLength(1);
    expect(listed[0]?.scheduleId).toBe(task.scheduleId);

    const summary = toScheduleChatSummary(task, "Support agent");
    expect(summary.agentId).toBe("copilot-schedule");
    expect(summary.summary).toContain("Support agent");
  });

  it("deletes the persisted schedule task", async () => {
    const root = await createStoreFixture();
    const workspace = await resolveWorkspace({
      storeRoot: root,
      copilotConfigDir: path.join(root, ".copilot-home"),
    });

    const task = await createScheduleTask(workspace, {
      targetKind: "chat",
      agentId: "support-agent",
      title: "Daily digest",
      prompt: "Summarize the latest support activity.",
      frequency: "daily",
      timeOfDay: "08:00",
      timezone: "UTC",
      enabled: true,
      nextRunAt: "2026-03-24T08:00:00.000Z",
      runtimeConfig: {
        provider: "copilot",
        model: "gpt-5",
        disabledSkills: [],
        mcpServers: {},
      },
    });

    expect(await getScheduleTask(workspace, task.scheduleId)).toBeDefined();
    await deleteScheduleTask(workspace, task.scheduleId);
    await expect(getScheduleTask(workspace, task.scheduleId)).rejects.toThrow(
      "Schedule task not found"
    );
  });

  it("stores scheduled orchestrator tasks without a backing chat thread", async () => {
    const root = await createStoreFixture();
    const workspace = await resolveWorkspace({
      storeRoot: root,
      copilotConfigDir: path.join(root, ".copilot-home"),
    });

    const task = await createScheduleTask(workspace, {
      targetKind: "orchestrator",
      orchestratorSessionId: "orchestrator-session-1",
      title: "Ship nightly changes",
      prompt: "Commit the staged changes and push them to the remote.",
      frequency: "daily",
      timeOfDay: "21:00",
      timezone: "UTC",
      enabled: true,
      nextRunAt: "2026-03-24T21:00:00.000Z",
    });

    expect(task.targetKind).toBe("orchestrator");
    expect(task.orchestratorSessionId).toBe("orchestrator-session-1");
    expect(task.chatSessionId).toBeUndefined();
    expect(task.runtimeConfig).toBeUndefined();

    const summary = toScheduleChatSummary(task, "Release train");
    expect(summary.summary).toContain("Release train");
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
