import { promises as fs } from "node:fs";
import path from "node:path";
import type {
  ChatRuntimeConfig,
  ChatSessionSummary,
  ScheduleTask,
} from "@min-kb-app/shared";
import {
  chatRuntimeConfigSchema,
  scheduleTaskSchema,
} from "@min-kb-app/shared";
import { sessionIdFromTitle } from "./sessions.js";
import { pathExists, walkFiles } from "./utils.js";
import type { MinKbWorkspace } from "./workspace.js";

export const SCHEDULE_AGENT_ID = "copilot-schedule";

const SCHEDULE_TASK_FILENAME = "SCHEDULE_TASK.json";

export interface CreateScheduleTaskInput {
  targetKind: ScheduleTask["targetKind"];
  agentId?: string;
  orchestratorSessionId?: string;
  title: string;
  prompt: string;
  frequency: ScheduleTask["frequency"];
  timeOfDay: string;
  timezone: string;
  dayOfWeek?: ScheduleTask["dayOfWeek"];
  dayOfMonth?: number;
  enabled?: boolean;
  nextRunAt: string;
  createdAt?: string;
  chatSessionId?: string;
  runtimeConfig?: ChatRuntimeConfig;
}

export async function listScheduleTasks(
  workspace: MinKbWorkspace
): Promise<ScheduleTask[]> {
  const root = scheduleHistoryRoot(workspace);
  if (!(await pathExists(root))) {
    return [];
  }

  const stateFiles = (await walkFiles(root)).filter(
    (filePath) => path.basename(filePath) === SCHEDULE_TASK_FILENAME
  );
  const tasks = await Promise.all(stateFiles.map(readScheduleTask));
  return tasks.sort((left, right) =>
    left.nextRunAt.localeCompare(right.nextRunAt)
  );
}

export async function getScheduleTask(
  workspace: MinKbWorkspace,
  scheduleId: string
): Promise<ScheduleTask> {
  const taskPath = await findScheduleTaskPath(workspace, scheduleId);
  if (!taskPath) {
    throw new Error(`Schedule task not found: ${scheduleId}`);
  }

  return readScheduleTask(taskPath);
}

export async function createScheduleTask(
  workspace: MinKbWorkspace,
  input: CreateScheduleTaskInput
): Promise<ScheduleTask> {
  const createdAt = input.createdAt ?? new Date().toISOString();
  const scheduleId = sessionIdFromTitle(input.title, createdAt);
  const existingPath = await findScheduleTaskPath(workspace, scheduleId);
  if (existingPath) {
    return readScheduleTask(existingPath);
  }

  const task: ScheduleTask = scheduleTaskSchema.parse({
    scheduleId,
    targetKind: input.targetKind,
    agentId: input.agentId,
    orchestratorSessionId: input.orchestratorSessionId,
    chatSessionId:
      input.targetKind === "chat"
        ? (input.chatSessionId ?? `${scheduleId}-chat`)
        : undefined,
    title: input.title.trim(),
    prompt: input.prompt.trim(),
    frequency: input.frequency,
    timeOfDay: input.timeOfDay,
    timezone: input.timezone.trim(),
    dayOfWeek: input.dayOfWeek,
    dayOfMonth: input.dayOfMonth,
    enabled: input.enabled ?? true,
    createdAt,
    updatedAt: createdAt,
    nextRunAt: input.nextRunAt,
    lastRunStatus: "idle",
    runtimeConfig:
      input.targetKind === "chat"
        ? chatRuntimeConfigSchema.parse(input.runtimeConfig)
        : undefined,
  });

  const taskDirectory = resolveScheduleTaskDirectory(
    workspace,
    task.scheduleId,
    createdAt
  );
  await fs.mkdir(taskDirectory, { recursive: true });
  await fs.writeFile(
    path.join(taskDirectory, SCHEDULE_TASK_FILENAME),
    `${JSON.stringify(task, null, 2)}\n`,
    "utf8"
  );
  return task;
}

export async function updateScheduleTask(
  workspace: MinKbWorkspace,
  scheduleId: string,
  updates: Partial<Omit<ScheduleTask, "scheduleId" | "createdAt">>
): Promise<ScheduleTask> {
  const taskPath = await findScheduleTaskPath(workspace, scheduleId);
  if (!taskPath) {
    throw new Error(`Cannot update missing schedule task: ${scheduleId}`);
  }

  const current = await readScheduleTask(taskPath);
  const next = scheduleTaskSchema.parse({
    ...current,
    ...updates,
    updatedAt: updates.updatedAt ?? new Date().toISOString(),
    runtimeConfig: updates.runtimeConfig
      ? chatRuntimeConfigSchema.parse(updates.runtimeConfig)
      : current.runtimeConfig,
  });
  await fs.writeFile(taskPath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  return next;
}

export async function deleteScheduleTask(
  workspace: MinKbWorkspace,
  scheduleId: string
): Promise<void> {
  const taskPath = await findScheduleTaskPath(workspace, scheduleId);
  if (!taskPath) {
    throw new Error(`Cannot delete missing schedule task: ${scheduleId}`);
  }

  await fs.rm(path.dirname(taskPath), { recursive: true, force: true });
}

export function scheduleHistoryRoot(workspace: MinKbWorkspace): string {
  return path.join(workspace.agentsRoot, SCHEDULE_AGENT_ID, "history");
}

export function toScheduleChatSummary(
  task: ScheduleTask,
  targetTitle?: string
): ChatSessionSummary {
  return {
    sessionId: task.scheduleId,
    agentId: SCHEDULE_AGENT_ID,
    title: task.title,
    startedAt: task.createdAt,
    summary: buildScheduleSummary(task, targetTitle),
    manifestPath: path.posix.join(
      "agents",
      SCHEDULE_AGENT_ID,
      "history",
      task.createdAt.slice(0, 7),
      task.scheduleId,
      SCHEDULE_TASK_FILENAME
    ),
    turnCount: task.totalRuns,
    lastTurnAt: task.lastCompletedAt ?? task.lastRunAt,
    runtimeConfig: task.runtimeConfig,
    completionStatus:
      task.lastRunStatus === "failed"
        ? "failed"
        : task.lastRunStatus === "completed"
          ? "completed"
          : undefined,
  };
}

function buildScheduleSummary(
  task: ScheduleTask,
  targetTitle?: string
): string {
  const status = task.enabled ? "Active" : "Paused";
  const targetLabel = describeScheduleTarget(task, targetTitle);
  return `${targetLabel} • ${status} • Next run ${task.nextRunAt}`;
}

function describeScheduleTarget(
  task: ScheduleTask,
  targetTitle?: string
): string {
  if (task.targetKind === "orchestrator") {
    return targetTitle ?? task.orchestratorSessionId ?? "Orchestrator session";
  }
  return targetTitle ?? task.agentId ?? "Chat agent";
}

function resolveScheduleTaskDirectory(
  workspace: MinKbWorkspace,
  scheduleId: string,
  createdAt: string
): string {
  return path.join(
    scheduleHistoryRoot(workspace),
    createdAt.slice(0, 7),
    scheduleId
  );
}

async function findScheduleTaskPath(
  workspace: MinKbWorkspace,
  scheduleId: string
): Promise<string | undefined> {
  const historyRoot = scheduleHistoryRoot(workspace);
  if (!(await pathExists(historyRoot))) {
    return undefined;
  }

  const taskFiles = (await walkFiles(historyRoot)).filter(
    (filePath) =>
      path.basename(filePath) === SCHEDULE_TASK_FILENAME &&
      path.basename(path.dirname(filePath)) === scheduleId
  );
  return taskFiles[0];
}

async function readScheduleTask(filePath: string): Promise<ScheduleTask> {
  const raw = await fs.readFile(filePath, "utf8");
  return scheduleTaskSchema.parse(JSON.parse(raw));
}
