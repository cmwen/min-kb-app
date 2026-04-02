import path from "node:path";
import {
  createScheduleTask,
  deleteScheduleTask,
  getScheduleTask,
  listScheduleTasks,
  type MinKbWorkspace,
  SCHEDULE_AGENT_ID,
  scheduleHistoryRoot,
  toScheduleChatSummary,
  updateScheduleTask,
} from "@min-kb-app/min-kb-store";
import type {
  AgentSummary,
  ChatRuntimeConfig,
  ChatSessionSummary,
  OrchestratorSession,
  ScheduleTask,
  ScheduleTaskCreateRequest,
  ScheduleTaskUpdateRequest,
} from "@min-kb-app/shared";
import {
  createDefaultChatRuntimeConfig,
  mergeChatRuntimeConfigs,
} from "@min-kb-app/shared";
import { computeNextRunAt } from "./scheduler.js";

interface RunScheduledChatInput {
  agentId: string;
  sessionId: string;
  title: string;
  prompt: string;
  config: ChatRuntimeConfig;
}

interface RunScheduledOrchestratorInput {
  sessionId: string;
  prompt: string;
}

interface ChatScheduleServiceOptions {
  resolveAgent: (agentId: string) => Promise<AgentSummary | undefined>;
  resolveOrchestratorSession: (
    sessionId: string
  ) => Promise<OrchestratorSession | undefined>;
  runScheduledChat: (input: RunScheduledChatInput) => Promise<void>;
  runScheduledOrchestrator: (
    input: RunScheduledOrchestratorInput
  ) => Promise<void>;
  intervalMs?: number;
}

export class ChatScheduleService {
  private timer: NodeJS.Timeout | undefined;

  private busy = false;

  private readonly intervalMs: number;

  constructor(
    private readonly workspace: MinKbWorkspace,
    private readonly options: ChatScheduleServiceOptions
  ) {
    this.intervalMs = options.intervalMs ?? 60_000;
  }

  start() {
    if (this.timer) {
      return;
    }
    this.timer = setInterval(() => {
      void this.tick();
    }, this.intervalMs);
    void this.tick();
  }

  stop() {
    if (!this.timer) {
      return;
    }
    clearInterval(this.timer);
    this.timer = undefined;
  }

  async tick() {
    if (this.busy) {
      return;
    }
    this.busy = true;
    try {
      const tasks = await listScheduleTasks(this.workspace);
      const now = new Date().toISOString();
      for (const task of tasks) {
        if (!task.enabled || task.lastRunStatus === "running") {
          continue;
        }
        if (task.nextRunAt > now) {
          continue;
        }
        await this.runTask(task);
      }
    } catch (error) {
      console.error("Failed to process scheduled chats", error);
    } finally {
      this.busy = false;
    }
  }

  async getAgentSummary(): Promise<AgentSummary> {
    const taskCount = (await listScheduleTasks(this.workspace)).length;
    return {
      id: SCHEDULE_AGENT_ID,
      kind: "schedule",
      title: "Schedules",
      description:
        "Manage recurring scheduled chats that run real agents with their configured skills.",
      combinedPrompt:
        "You are the built-in schedules surface. Manage recurring scheduled chats, keep task state current, and run chat agents on a cadence using their configured skills.",
      agentPath: path.join(this.workspace.agentsRoot, SCHEDULE_AGENT_ID),
      defaultSoulPath: path.join(
        this.workspace.agentsRoot,
        "default",
        "SOUL.md"
      ),
      historyRoot: scheduleHistoryRoot(this.workspace),
      workingMemoryRoot: path.join(
        this.workspace.agentsRoot,
        SCHEDULE_AGENT_ID,
        "memory",
        "working"
      ),
      skillRoot: path.join(
        this.workspace.agentsRoot,
        SCHEDULE_AGENT_ID,
        "skills"
      ),
      skillNames: [],
      sessionCount: taskCount,
    };
  }

  async listChatSummaries(): Promise<ChatSessionSummary[]> {
    const tasks = await listScheduleTasks(this.workspace);
    const summaries = await Promise.all(
      tasks.map(async (task) => {
        return toScheduleChatSummary(task, await this.resolveTargetTitle(task));
      })
    );
    return summaries;
  }

  async listTasks(): Promise<ScheduleTask[]> {
    return listScheduleTasks(this.workspace);
  }

  async getTask(scheduleId: string): Promise<ScheduleTask> {
    return getScheduleTask(this.workspace, scheduleId);
  }

  async createTask(request: ScheduleTaskCreateRequest): Promise<ScheduleTask> {
    if (request.targetKind === "orchestrator") {
      const sessionId = requireTaskValue(
        request.orchestratorSessionId,
        "Scheduled orchestrator tasks require a session id."
      );
      const session =
        await this.requireSchedulableOrchestratorSession(sessionId);
      return createScheduleTask(this.workspace, {
        targetKind: "orchestrator",
        orchestratorSessionId: session.sessionId,
        title: request.title,
        prompt: request.prompt,
        frequency: request.frequency,
        timeOfDay: request.timeOfDay,
        timezone: request.timezone,
        dayOfWeek: request.dayOfWeek,
        dayOfMonth: request.dayOfMonth,
        enabled: request.enabled,
        nextRunAt: computeNextRunAt(request),
      });
    }

    const agentId = requireTaskValue(
      request.agentId,
      "Scheduled chats require an agent id."
    );
    const agent = await this.requireSchedulableAgent(agentId);
    const runtimeConfig = this.buildRuntimeConfig(agent, request.config);
    return createScheduleTask(this.workspace, {
      targetKind: "chat",
      agentId: agent.id,
      title: request.title,
      prompt: request.prompt,
      frequency: request.frequency,
      timeOfDay: request.timeOfDay,
      timezone: request.timezone,
      dayOfWeek: request.dayOfWeek,
      dayOfMonth: request.dayOfMonth,
      enabled: request.enabled,
      nextRunAt: computeNextRunAt(request),
      runtimeConfig,
    });
  }

  async updateTask(
    scheduleId: string,
    request: ScheduleTaskUpdateRequest
  ): Promise<ScheduleTask> {
    const current = await this.getTask(scheduleId);
    if (request.targetKind === "orchestrator") {
      const sessionId = requireTaskValue(
        request.orchestratorSessionId,
        "Scheduled orchestrator tasks require a session id."
      );
      const session =
        await this.requireSchedulableOrchestratorSession(sessionId);
      const targetChanged =
        current.targetKind !== "orchestrator" ||
        session.sessionId !== current.orchestratorSessionId;
      return updateScheduleTask(this.workspace, scheduleId, {
        targetKind: "orchestrator",
        agentId: undefined,
        orchestratorSessionId: session.sessionId,
        chatSessionId: undefined,
        title: request.title,
        prompt: request.prompt,
        frequency: request.frequency,
        timeOfDay: request.timeOfDay,
        timezone: request.timezone,
        dayOfWeek: request.dayOfWeek,
        dayOfMonth: request.dayOfMonth,
        enabled: request.enabled,
        nextRunAt: computeNextRunAt(request),
        runtimeConfig: undefined,
        lastError: undefined,
        lastRunStatus: targetChanged ? "idle" : current.lastRunStatus,
      });
    }

    const agentId = requireTaskValue(
      request.agentId,
      "Scheduled chats require an agent id."
    );
    const agent = await this.requireSchedulableAgent(agentId);
    const runtimeConfig = this.buildRuntimeConfig(agent, request.config);
    const agentChanged =
      current.targetKind !== "chat" || agent.id !== current.agentId;
    return updateScheduleTask(this.workspace, scheduleId, {
      targetKind: "chat",
      agentId: agent.id,
      orchestratorSessionId: undefined,
      chatSessionId: agentChanged
        ? `${scheduleId}-${Date.now()}-chat`
        : current.chatSessionId,
      title: request.title,
      prompt: request.prompt,
      frequency: request.frequency,
      timeOfDay: request.timeOfDay,
      timezone: request.timezone,
      dayOfWeek: request.dayOfWeek,
      dayOfMonth: request.dayOfMonth,
      enabled: request.enabled,
      nextRunAt: computeNextRunAt(request),
      runtimeConfig,
      lastError: undefined,
      lastRunStatus: agentChanged ? "idle" : current.lastRunStatus,
    });
  }

  async deleteTask(scheduleId: string): Promise<void> {
    await deleteScheduleTask(this.workspace, scheduleId);
  }

  async runNow(scheduleId: string): Promise<ScheduleTask> {
    const task = await this.getTask(scheduleId);
    return this.runTask(task);
  }

  private async runTask(task: ScheduleTask): Promise<ScheduleTask> {
    const startedAt = new Date().toISOString();
    const runningTask = await updateScheduleTask(
      this.workspace,
      task.scheduleId,
      {
        lastRunAt: startedAt,
        lastCompletedAt: undefined,
        lastError: undefined,
        lastRunStatus: "running",
      }
    );
    try {
      if (runningTask.targetKind === "orchestrator") {
        const sessionId = requireTaskValue(
          runningTask.orchestratorSessionId,
          "Scheduled orchestrator tasks require a session id."
        );
        const session =
          await this.requireSchedulableOrchestratorSession(sessionId);
        await this.options.runScheduledOrchestrator({
          sessionId: session.sessionId,
          prompt: runningTask.prompt,
        });
      } else {
        const agentId = requireTaskValue(
          runningTask.agentId,
          "Scheduled chats require an agent id."
        );
        const chatSessionId = requireTaskValue(
          runningTask.chatSessionId,
          "Scheduled chats require a backing chat session id."
        );
        const runtimeConfig = requireTaskValue(
          runningTask.runtimeConfig,
          "Scheduled chats require a runtime config."
        );
        const agent = await this.requireSchedulableAgent(agentId);
        await this.options.runScheduledChat({
          agentId: agent.id,
          sessionId: chatSessionId,
          title: runningTask.title,
          prompt: runningTask.prompt,
          config: runtimeConfig,
        });
      }
      return updateScheduleTask(this.workspace, task.scheduleId, {
        lastCompletedAt: new Date().toISOString(),
        lastRunStatus: "completed",
        nextRunAt: computeNextRunAt(runningTask),
        totalRuns: runningTask.totalRuns + 1,
      });
    } catch (error) {
      return updateScheduleTask(this.workspace, task.scheduleId, {
        lastCompletedAt: new Date().toISOString(),
        lastRunStatus: "failed",
        lastError:
          error instanceof Error ? error.message : "Unknown schedule error",
        nextRunAt: computeNextRunAt(runningTask),
        totalRuns: runningTask.totalRuns + 1,
        failedRuns: runningTask.failedRuns + 1,
      });
    }
  }

  private buildRuntimeConfig(
    agent: AgentSummary,
    overrideConfig?: Partial<ChatRuntimeConfig>
  ): ChatRuntimeConfig {
    return mergeChatRuntimeConfigs(
      agent.runtimeConfig ?? createDefaultChatRuntimeConfig(),
      overrideConfig
    );
  }

  private async requireSchedulableAgent(
    agentId: string
  ): Promise<AgentSummary> {
    const agent = await this.options.resolveAgent(agentId);
    if (!agent || agent.kind !== "chat") {
      throw new Error("Scheduled chats must target an existing chat agent.");
    }
    return agent;
  }

  private async requireSchedulableOrchestratorSession(
    sessionId: string
  ): Promise<OrchestratorSession> {
    const session = await this.options.resolveOrchestratorSession(sessionId);
    if (!session) {
      throw new Error(
        "Scheduled orchestrator tasks must target an existing orchestrator session."
      );
    }
    return session;
  }

  private async resolveTargetTitle(
    task: ScheduleTask
  ): Promise<string | undefined> {
    if (task.targetKind === "orchestrator") {
      const session = task.orchestratorSessionId
        ? await this.options.resolveOrchestratorSession(
            task.orchestratorSessionId
          )
        : undefined;
      return session?.title;
    }
    const agent = task.agentId
      ? await this.options.resolveAgent(task.agentId)
      : undefined;
    return agent?.title;
  }
}

function requireTaskValue<T>(value: T | undefined, message: string): T {
  if (value === undefined) {
    throw new Error(message);
  }
  return value;
}
