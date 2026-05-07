import { execFile as execFileCallback } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import {
  accumulatePremiumUsageTotals,
  buildOrchestratorWindowName,
  createOrchestratorJob,
  createOrchestratorSchedule,
  createOrchestratorSession,
  deleteOrchestratorJob,
  deleteOrchestratorSchedule,
  deleteOrchestratorSession,
  discoverCopilotCustomAgents,
  getDefaultOrchestratorCustomAgentId,
  getOrchestratorSchedule,
  getOrchestratorSession,
  getOrchestratorTerminalSize,
  listOrchestratorSchedules,
  listOrchestratorSessions,
  type MinKbWorkspace,
  ORCHESTRATOR_AGENT_ID,
  ORCHESTRATOR_TERMINAL_LINE_LIMIT,
  orchestratorHistoryRoot,
  pathExists,
  readOrchestratorTerminalChunk,
  readOrchestratorTerminalHistoryChunk,
  resetOrchestratorTerminalLog,
  toOrchestratorChatSummary,
  updateOrchestratorJob,
  updateOrchestratorSchedule,
  updateOrchestratorSession,
  writeOrchestratorJobCompletion,
} from "@min-kb-app/min-kb-store";
import {
  type AgentSummary,
  type AttachmentUpload,
  type ChatRuntimeConfig,
  type ChatSession,
  type ChatSessionSummary,
  DEFAULT_CHAT_MODEL,
  DEFAULT_CHAT_PROVIDER,
  DEFAULT_ORCHESTRATOR_CLI_PROVIDER,
  type ModelDescriptor,
  type OrchestratorCapabilities,
  type OrchestratorCliProviderDescriptor,
  type OrchestratorDelegateRequest,
  type OrchestratorExecutionMode,
  type OrchestratorJob,
  type OrchestratorSchedule,
  type OrchestratorScheduleCreateRequest,
  type OrchestratorScheduleUpdateRequest,
  type OrchestratorSession,
  type OrchestratorSessionCreateRequest,
  type OrchestratorSessionUpdateRequest,
  type OrchestratorStructuredDiff,
  type OrchestratorTerminalHistoryChunk,
  type OrchestratorWorkingTree,
  type OrchestratorWorkingTreeDiff,
  type OrchestratorWorkingTreeFile,
  type OrchestratorWorkingTreeFileStatus,
  orchestratorCapabilitiesSchema,
  orchestratorWorkingTreeDiffSchema,
  orchestratorWorkingTreeSchema,
  type StoredAttachment,
} from "@min-kb-app/shared";
import {
  isRuntimeSmtpConfigured,
  readOrchestratorTmuxSessionName,
  readRuntimeSmtpEnv,
} from "./env.js";

const execFile = promisify(execFileCallback);

export const DEFAULT_TMUX_SESSION_NAME = readOrchestratorTmuxSessionName();

const DIRECT_PROMPT_LIMIT = 800;
const DIRECT_PROMPT_LINE_LIMIT = 12;
const CANCELLED_JOB_EXIT_CODE = -1;
const ORCHESTRATOR_PROMPT_FILENAME = "prompt.txt";
const ORCHESTRATOR_SCRIPT_FILENAME = "run.sh";
export const DEFAULT_MEMORY_ANALYSIS_MODEL = "gpt-5-mini";
const DEFAULT_COPILOT_RATE_LIMIT_WAIT_SECONDS = 60;
const COPILOT_RATE_LIMIT_BUFFER_SECONDS = 5;
const MAX_COPILOT_RATE_LIMIT_RETRIES = 5;
const AUTO_RECOVERED_TMUX_NOTICE =
  "A new tmux session was created because the previous tmux session no longer existed.";
const COPILOT_RATE_LIMIT_SIGNAL_PATTERN =
  /\b429\b|too many requests|rate limit|usage limit|session limit|weekly limit|retry-after|x-ratelimit-reset|available again|try again/i;
const COPILOT_RATE_LIMIT_RETRY_AFTER_PATTERN =
  /retry-after[^0-9]{0,20}(\d{1,10})/gi;
const COPILOT_RATE_LIMIT_RESET_EPOCH_PATTERN =
  /x-ratelimit-reset[^0-9]{0,20}(\d{10,})/gi;
const COPILOT_RATE_LIMIT_RESET_ISO_PATTERN =
  /(?:available again at|try again at|reset(?:s| time)? at|retry at)[^\d]{0,20}(\d{4}-\d{2}-\d{2}t\d{2}:\d{2}(?::\d{2})?z)/gi;
const COPILOT_RATE_LIMIT_RELATIVE_WINDOW_PATTERN =
  /(?:wait|retry|available again|try again|reset(?:s)?)[^\n]{0,120}?\b(?:in|after)\s+([^\n]+)/gi;
const COPILOT_RATE_LIMIT_DURATION_PART_PATTERN =
  /(\d+)\s*(days?|d|hours?|hrs?|hr|h|minutes?|mins?|min|m|seconds?|secs?|sec|s)\b/gi;

const COPILOT_CLI_PROVIDER = {
  id: "copilot",
  displayName: "GitHub Copilot CLI",
  description:
    "Runs delegated jobs through the GitHub Copilot CLI inside the tmux workspace.",
  capabilities: {
    supportsCustomAgents: true,
    supportsExecutionMode: true,
  },
} satisfies OrchestratorCliProviderDescriptor;

const GEMINI_CLI_PROVIDER = {
  id: "gemini",
  displayName: "Gemini CLI",
  description:
    "Runs delegated jobs through the Gemini CLI inside the tmux workspace.",
  capabilities: {
    supportsCustomAgents: false,
    supportsExecutionMode: false,
  },
} satisfies OrchestratorCliProviderDescriptor;

const ORCHESTRATOR_CLI_PROVIDERS = [
  COPILOT_CLI_PROVIDER,
  GEMINI_CLI_PROVIDER,
] as const;

interface ReconciledStatus {
  status: OrchestratorSession["status"];
  activeJobId?: string;
  lastJobId?: string;
}

interface QueueDelegationResult {
  job: OrchestratorJob;
  systemNotice?: string;
}

export class TmuxOrchestratorService {
  constructor(
    private readonly workspace: MinKbWorkspace,
    private readonly defaultProjectPath: string,
    private readonly tmuxSessionName = DEFAULT_TMUX_SESSION_NAME,
    private readonly resolveModelDescriptor?: (
      modelId: string
    ) => Promise<ModelDescriptor | undefined>
  ) {}

  async getCapabilities(): Promise<OrchestratorCapabilities> {
    const smtp = readRuntimeSmtpEnv();
    const [tmuxInstalled, copilotInstalled, geminiInstalled, sessions] =
      await Promise.all([
        this.commandExists("tmux"),
        this.commandExists("copilot"),
        this.commandExists("gemini"),
        listOrchestratorSessions(this.workspace),
      ]);
    const recentProjectPaths = [
      ...new Set(sessions.map((session) => session.projectPath)),
    ]
      .filter((projectPath) => projectPath !== this.defaultProjectPath)
      .slice(0, 8);
    const cliProviders = ORCHESTRATOR_CLI_PROVIDERS.filter((provider) =>
      provider.id === "copilot" ? copilotInstalled : geminiInstalled
    );
    return orchestratorCapabilitiesSchema.parse({
      available: tmuxInstalled && cliProviders.length > 0,
      defaultProjectPath: this.defaultProjectPath,
      recentProjectPaths,
      tmuxInstalled,
      copilotInstalled,
      geminiInstalled,
      defaultCliProvider:
        cliProviders[0]?.id ?? DEFAULT_ORCHESTRATOR_CLI_PROVIDER,
      cliProviders,
      tmuxSessionName: this.tmuxSessionName,
      emailDeliveryAvailable: this.isEmailDeliveryConfigured(),
      emailFromAddress: smtp.from,
    });
  }

  async getAgentSummary(): Promise<AgentSummary> {
    const historyRoot = orchestratorHistoryRoot(this.workspace);
    const sessionCount = (await listOrchestratorSessions(this.workspace))
      .length;
    return {
      id: ORCHESTRATOR_AGENT_ID,
      kind: "orchestrator",
      title: "CLI Orchestrator",
      description:
        "Maximizes project context, then delegates implementation work to Copilot or Gemini CLI sessions inside tmux windows.",
      combinedPrompt:
        "You are the built-in Copilot orchestrator agent. Maximize the available project context, keep delegated session state current, and route implementation work through specialized Copilot custom agents instead of doing everything in one generic run.",
      agentPath: path.join(this.workspace.agentsRoot, ORCHESTRATOR_AGENT_ID),
      defaultSoulPath: path.join(
        this.workspace.agentsRoot,
        "default",
        "SOUL.md"
      ),
      historyRoot,
      workingMemoryRoot: path.join(
        this.workspace.agentsRoot,
        ORCHESTRATOR_AGENT_ID,
        "memory",
        "working"
      ),
      skillRoot: path.join(
        this.workspace.agentsRoot,
        ORCHESTRATOR_AGENT_ID,
        "skills"
      ),
      skillNames: [],
      sessionCount,
    };
  }

  async listChatSummaries(): Promise<ChatSessionSummary[]> {
    const sessions = await listOrchestratorSessions(this.workspace);
    return sessions.map((session) => toOrchestratorChatSummary(session));
  }

  async listSessions(): Promise<OrchestratorSession[]> {
    const sessions = await listOrchestratorSessions(this.workspace);
    return Promise.all(
      sessions.map((session) => this.getSession(session.sessionId))
    );
  }

  async getSession(sessionId: string): Promise<OrchestratorSession> {
    const session = await getOrchestratorSession(this.workspace, sessionId);
    const reconciled = await this.reconcileSession(session);
    return getOrchestratorSession(this.workspace, reconciled.sessionId);
  }

  async getSessionChanges(sessionId: string): Promise<OrchestratorWorkingTree> {
    const session = await getOrchestratorSession(this.workspace, sessionId);
    return this.readWorkingTree(session.projectPath);
  }

  async getSessionChangeDiff(
    sessionId: string,
    filePath: string
  ): Promise<OrchestratorWorkingTreeDiff> {
    const session = await getOrchestratorSession(this.workspace, sessionId);
    return this.readWorkingTreeDiff(session.projectPath, filePath);
  }

  async createSession(
    request: OrchestratorSessionCreateRequest
  ): Promise<OrchestratorSession> {
    const cliProvider = this.normalizeCliProvider(request.cliProvider);
    await this.assertCapabilities(cliProvider);
    const projectPath = path.resolve(request.projectPath);
    const model = request.model.trim() || DEFAULT_CHAT_MODEL;
    await this.assertProjectPath(projectPath);
    const availableCustomAgents =
      cliProvider === COPILOT_CLI_PROVIDER.id
        ? await discoverCopilotCustomAgents(projectPath)
        : [];
    const defaultCustomAgentId = getDefaultOrchestratorCustomAgentId(
      availableCustomAgents
    );
    const selectedCustomAgentId =
      cliProvider === COPILOT_CLI_PROVIDER.id
        ? this.resolveSelectedCustomAgentId(
            {
              availableCustomAgents,
              selectedCustomAgentId: defaultCustomAgentId,
            },
            request.selectedCustomAgentId
          )
        : undefined;
    const executionMode =
      cliProvider === COPILOT_CLI_PROVIDER.id
        ? (request.executionMode ?? "standard")
        : "standard";
    const title =
      request.title?.trim() ||
      request.projectPurpose.trim() ||
      path.basename(projectPath) ||
      "Orchestrator session";
    const startedAt = new Date().toISOString();
    const sessionId = `${startedAt.slice(0, 10)}-${slugify(title)}`;
    const tmuxWindowName = buildOrchestratorWindowName(
      title,
      projectPath,
      sessionId
    );
    const paneId = await this.createWindow({
      projectPath,
      tmuxWindowName,
      startedAt,
      title,
      sessionId,
    });
    await createOrchestratorSession(this.workspace, {
      title,
      sessionId,
      startedAt,
      projectPath,
      projectPurpose: request.projectPurpose,
      cliProvider,
      model,
      availableCustomAgents,
      selectedCustomAgentId,
      executionMode,
      tmuxSessionName: this.tmuxSessionName,
      tmuxWindowName,
      tmuxPaneId: paneId,
      status: "idle",
    });
    if (request.prompt) {
      await this.delegate(sessionId, request.prompt);
    }
    return this.getSession(sessionId);
  }

  async updateSession(
    sessionId: string,
    request: OrchestratorSessionUpdateRequest
  ): Promise<OrchestratorSession> {
    const session = await this.getSession(sessionId);
    const title = request.title;
    const cliProvider = this.normalizeCliProvider(request.cliProvider);
    const model = request.model;
    await this.assertCapabilities(cliProvider);
    const availableCustomAgents =
      cliProvider === COPILOT_CLI_PROVIDER.id
        ? session.availableCustomAgents
        : [];
    const selectedCustomAgentId =
      cliProvider === COPILOT_CLI_PROVIDER.id
        ? this.resolveSelectedCustomAgentId(
            session,
            request.selectedCustomAgentId
          )
        : undefined;
    const executionMode =
      cliProvider === COPILOT_CLI_PROVIDER.id
        ? (request.executionMode ?? session.executionMode ?? "standard")
        : "standard";
    const tmuxWindowName = buildOrchestratorWindowName(
      title,
      session.projectPath,
      session.sessionId
    );
    const hasChanges =
      title !== session.title ||
      cliProvider !==
        (session.cliProvider ?? DEFAULT_ORCHESTRATOR_CLI_PROVIDER) ||
      model !== session.model ||
      selectedCustomAgentId !== session.selectedCustomAgentId ||
      executionMode !== (session.executionMode ?? "standard") ||
      tmuxWindowName !== session.tmuxWindowName;
    if (!hasChanges) {
      return session;
    }

    if (
      tmuxWindowName !== session.tmuxWindowName &&
      (await this.commandExists("tmux")) &&
      (await this.tmuxPaneExists(session.tmuxPaneId))
    ) {
      const windowId = await this.readTmuxValue(
        session.tmuxPaneId,
        "#{window_id}"
      );
      await this.runTmux(["rename-window", "-t", windowId, tmuxWindowName]);
    }

    await updateOrchestratorSession(this.workspace, sessionId, {
      title,
      cliProvider,
      model,
      availableCustomAgents,
      selectedCustomAgentId,
      executionMode,
      tmuxWindowName,
    });
    return this.getSession(sessionId);
  }

  async listSchedules(sessionId?: string): Promise<OrchestratorSchedule[]> {
    return listOrchestratorSchedules(this.workspace, { sessionId });
  }

  async getSchedule(scheduleId: string): Promise<OrchestratorSchedule> {
    return getOrchestratorSchedule(this.workspace, scheduleId);
  }

  async createSchedule(
    request: OrchestratorScheduleCreateRequest,
    nextRunAt: string
  ): Promise<OrchestratorSchedule> {
    const session = await this.getSession(request.sessionId);
    if (request.emailTo && !this.isEmailDeliveryConfigured()) {
      throw new Error(
        "Email delivery is not configured for this runtime. Set the MIN_KB_APP_SMTP_* environment variables first."
      );
    }
    const customAgentId = this.resolveSelectedCustomAgentId(
      session,
      request.customAgentId
    );
    return createOrchestratorSchedule(this.workspace, {
      sessionId: request.sessionId,
      title: request.title,
      prompt: request.prompt,
      frequency: request.frequency,
      timeOfDay: request.timeOfDay,
      timezone: request.timezone,
      dayOfWeek: request.dayOfWeek,
      dayOfMonth: request.dayOfMonth,
      customAgentId,
      emailTo: request.emailTo?.trim() || undefined,
      enabled: request.enabled,
      nextRunAt,
    });
  }

  async updateSchedule(
    scheduleId: string,
    request: OrchestratorScheduleUpdateRequest,
    nextRunAt: string
  ): Promise<OrchestratorSchedule> {
    const schedule = await this.getSchedule(scheduleId);
    const session = await this.getSession(schedule.sessionId);
    if (request.emailTo && !this.isEmailDeliveryConfigured()) {
      throw new Error(
        "Email delivery is not configured for this runtime. Set the MIN_KB_APP_SMTP_* environment variables first."
      );
    }
    const customAgentId = this.resolveSelectedCustomAgentId(
      session,
      request.customAgentId
    );
    return updateOrchestratorSchedule(this.workspace, scheduleId, {
      title: request.title.trim(),
      prompt: request.prompt.trim(),
      frequency: request.frequency,
      timeOfDay: request.timeOfDay,
      timezone: request.timezone.trim(),
      dayOfWeek: request.dayOfWeek,
      dayOfMonth: request.dayOfMonth,
      customAgentId,
      emailTo: request.emailTo?.trim() || undefined,
      enabled: request.enabled,
      nextRunAt,
    });
  }

  async deleteSchedule(scheduleId: string): Promise<void> {
    await deleteOrchestratorSchedule(this.workspace, scheduleId);
  }

  async triggerSchedule(
    schedule: OrchestratorSchedule
  ): Promise<OrchestratorJob> {
    const session = await this.getSession(schedule.sessionId);
    const { job } = await this.queueDelegation(session, schedule.prompt, {
      customAgentId: schedule.customAgentId,
      scheduleId: schedule.scheduleId,
    });
    return job;
  }

  async delegate(
    sessionId: string,
    request: string | OrchestratorDelegateRequest
  ): Promise<OrchestratorSession> {
    const session = await this.getSession(sessionId);
    await this.assertCapabilities(
      session.cliProvider ?? DEFAULT_ORCHESTRATOR_CLI_PROVIDER
    );
    const delegatedPrompt =
      typeof request === "string" ? request : request.prompt;
    const attachment =
      typeof request === "string" ? undefined : request.attachment;
    if (!delegatedPrompt.trim() && !attachment) {
      throw new Error(
        "Provide a prompt or attach a file before delegating work."
      );
    }
    const customAgentId = this.resolveSelectedCustomAgentId(
      session,
      typeof request === "string" ? undefined : request.customAgentId
    );
    const { systemNotice } = await this.queueDelegation(
      session,
      delegatedPrompt,
      {
        attachment,
        customAgentId,
      }
    );
    return this.loadSession(sessionId, systemNotice);
  }

  async retryJob(
    sessionId: string,
    jobId: string
  ): Promise<OrchestratorSession> {
    const session = await this.getSession(sessionId);
    await this.assertCapabilities(
      session.cliProvider ?? DEFAULT_ORCHESTRATOR_CLI_PROVIDER
    );
    const job = session.jobs.find((candidate) => candidate.jobId === jobId);
    if (!job) {
      throw new Error(`Orchestrator session ${sessionId} has no job ${jobId}.`);
    }
    if (job.status !== "failed") {
      throw new Error(
        `Only failed jobs can be retried. Received ${job.status}.`
      );
    }

    const prompt = await this.resolveRetryPrompt(job);
    const attachment = await this.readRetryAttachment(job.attachment);
    if (!prompt.trim() && !attachment) {
      throw new Error(
        `Orchestrator job ${jobId} does not have enough persisted input to retry.`
      );
    }

    const customAgentId = this.resolveSelectedCustomAgentId(
      session,
      job.customAgentId
    );
    const { systemNotice } = await this.queueDelegation(session, prompt, {
      attachment,
      customAgentId,
    });
    return this.loadSession(sessionId, systemNotice);
  }

  async sendInput(
    sessionId: string,
    input: string,
    submit = true
  ): Promise<OrchestratorSession> {
    const session = await this.getSession(sessionId);
    if (input.length > 0) {
      await this.runTmux([
        "send-keys",
        "-t",
        session.tmuxPaneId,
        "-l",
        "--",
        input,
      ]);
    }
    if (submit) {
      await this.runTmux(["send-keys", "-t", session.tmuxPaneId, "Enter"]);
    }
    return this.getSession(sessionId);
  }

  async cancelJob(sessionId: string): Promise<OrchestratorSession> {
    const session = await this.getSession(sessionId);
    if (session.status !== "running" || !session.activeJobId) {
      throw new Error(`Orchestrator session ${sessionId} has no running job.`);
    }

    const runningJob =
      session.jobs.find((job) => job.jobId === session.activeJobId) ??
      session.jobs.find((job) => job.status === "running");
    if (!runningJob) {
      throw new Error(
        `Orchestrator session ${sessionId} has no persisted running job.`
      );
    }

    const completedAt = new Date().toISOString();
    await this.killWindowForPane(session.tmuxPaneId);

    try {
      const nextPaneId = await this.createWindow({
        projectPath: session.projectPath,
        tmuxWindowName: session.tmuxWindowName,
        startedAt: session.startedAt,
        title: session.title,
        sessionId: session.sessionId,
      });
      await this.finalizeCancelledJob(
        session.sessionId,
        runningJob.jobId,
        completedAt,
        {
          tmuxPaneId: nextPaneId,
          status: "failed",
        }
      );
    } catch (error) {
      await this.finalizeCancelledJob(
        session.sessionId,
        runningJob.jobId,
        completedAt,
        {
          status: "missing",
        }
      );
      throw error;
    }

    return this.getSession(sessionId);
  }

  async deleteSession(sessionId: string): Promise<void> {
    const session = await this.getSession(sessionId);
    await this.killWindowForPane(session.tmuxPaneId);
    await deleteOrchestratorSession(this.workspace, sessionId);
  }

  async restartSession(sessionId: string): Promise<OrchestratorSession> {
    const session = await getOrchestratorSession(this.workspace, sessionId);
    await this.assertCapabilities(
      session.cliProvider ?? DEFAULT_ORCHESTRATOR_CLI_PROVIDER
    );
    const runningJob =
      session.jobs.find((job) => job.jobId === session.activeJobId) ??
      session.jobs.find((job) => job.status === "running");
    const completedAt = runningJob ? new Date().toISOString() : undefined;

    await this.killWindowForPane(session.tmuxPaneId);
    await resetOrchestratorTerminalLog(this.workspace, sessionId);

    try {
      const nextPaneId = await this.createWindow({
        projectPath: session.projectPath,
        tmuxWindowName: session.tmuxWindowName,
        startedAt: session.startedAt,
        title: session.title,
        sessionId: session.sessionId,
      });

      if (runningJob && completedAt) {
        await this.finalizeCancelledJob(
          session.sessionId,
          runningJob.jobId,
          completedAt,
          {
            tmuxPaneId: nextPaneId,
            status: "failed",
          }
        );
      } else {
        await updateOrchestratorSession(this.workspace, session.sessionId, {
          tmuxPaneId: nextPaneId,
          activeJobId: undefined,
          status: "idle",
        });
      }
    } catch (error) {
      if (runningJob && completedAt) {
        await this.finalizeCancelledJob(
          session.sessionId,
          runningJob.jobId,
          completedAt,
          {
            status: "missing",
          }
        );
      } else {
        await updateOrchestratorSession(this.workspace, session.sessionId, {
          activeJobId: undefined,
          status: "missing",
        });
      }
      throw error;
    }

    return this.getSession(sessionId);
  }

  async deleteQueuedJob(
    sessionId: string,
    jobId: string
  ): Promise<OrchestratorSession> {
    const session = await this.getSession(sessionId);
    const job = session.jobs.find((item) => item.jobId === jobId);
    if (!job) {
      throw new Error(`Orchestrator session ${sessionId} has no job ${jobId}.`);
    }
    if (job.status !== "queued") {
      throw new Error(
        `Only queued jobs can be deleted. Received ${job.status}.`
      );
    }

    await deleteOrchestratorJob(this.workspace, sessionId, jobId);
    return this.getSession(sessionId);
  }

  async readTerminalChunk(
    sessionId: string,
    offset: number
  ): Promise<{ chunk: string; nextOffset: number }> {
    return readOrchestratorTerminalChunk(this.workspace, sessionId, offset);
  }

  async readTerminalHistoryChunk(
    sessionId: string,
    beforeOffset: number,
    maxLines = ORCHESTRATOR_TERMINAL_LINE_LIMIT
  ): Promise<OrchestratorTerminalHistoryChunk> {
    return readOrchestratorTerminalHistoryChunk(
      this.workspace,
      sessionId,
      beforeOffset,
      maxLines
    );
  }

  async getTerminalSize(sessionId: string): Promise<number> {
    return getOrchestratorTerminalSize(this.workspace, sessionId);
  }

  private async createWindow(input: {
    projectPath: string;
    tmuxWindowName: string;
    startedAt: string;
    title: string;
    sessionId: string;
  }): Promise<string> {
    const historyRoot = path.join(
      orchestratorHistoryRoot(this.workspace),
      input.startedAt.slice(0, 7),
      input.sessionId
    );
    await fs.mkdir(path.join(historyRoot, "terminal"), { recursive: true });
    await this.ensureTmuxSession();
    await this.runTmux([
      "new-window",
      "-d",
      "-t",
      this.tmuxSessionName,
      "-n",
      input.tmuxWindowName,
      "-c",
      input.projectPath,
    ]);
    const paneId = await this.readTmuxValue(
      `${this.tmuxSessionName}:${input.tmuxWindowName}`,
      "#{pane_id}"
    );
    const logPath = path.join(historyRoot, "terminal", "pane.log");
    await this.runTmux([
      "pipe-pane",
      "-o",
      "-t",
      paneId,
      `cat >> ${shellQuote(logPath)}`,
    ]);
    await this.runTmux([
      "send-keys",
      "-t",
      paneId,
      `printf ${shellQuote(`[min-kb-app] Ready for ${input.title}\\n`)}`,
      "Enter",
    ]);
    return paneId;
  }

  private async ensureTmuxSession(): Promise<void> {
    if (await this.tmuxSessionExists()) {
      return;
    }
    await this.runTmux([
      "new-session",
      "-d",
      "-s",
      this.tmuxSessionName,
      "-n",
      "orchestrator-home",
      "-c",
      this.defaultProjectPath,
    ]);
  }

  private async tmuxSessionExists(): Promise<boolean> {
    try {
      await this.runTmux(["has-session", "-t", this.tmuxSessionName]);
      return true;
    } catch {
      return false;
    }
  }

  private async reconcileSession(
    session: OrchestratorSession
  ): Promise<OrchestratorSession> {
    const paneExists = await this.tmuxPaneExists(session.tmuxPaneId);
    if (paneExists) {
      const queuedJob = getNextQueuedJob(session.jobs);
      if (!session.jobs.some((job) => job.status === "running") && queuedJob) {
        await this.startPreparedJob(session, queuedJob);
        return getOrchestratorSession(this.workspace, session.sessionId);
      }
    }

    const next = deriveSessionStatus(session, paneExists);
    const statusChanged =
      next.status !== session.status ||
      next.activeJobId !== session.activeJobId ||
      next.lastJobId !== session.lastJobId;
    if (statusChanged) {
      await updateOrchestratorSession(this.workspace, session.sessionId, next);
    }
    return statusChanged
      ? getOrchestratorSession(this.workspace, session.sessionId)
      : session;
  }

  private async tmuxPaneExists(paneId: string): Promise<boolean> {
    try {
      await this.readTmuxValue(paneId, "#{pane_id}");
      return true;
    } catch {
      return false;
    }
  }

  private async readTmuxValue(target: string, format: string): Promise<string> {
    const { stdout } = await this.runTmux([
      "display-message",
      "-p",
      "-t",
      target,
      format,
    ]);
    const value = stdout.trim();
    if (!value) {
      throw new Error(`tmux target ${target} did not produce ${format}.`);
    }
    return value;
  }

  private async runTmux(args: string[]) {
    return execFile("tmux", args, { encoding: "utf8" });
  }

  private async killWindowForPane(paneId: string): Promise<void> {
    const paneExists = await this.tmuxPaneExists(paneId);
    if (!paneExists) {
      return;
    }
    const windowId = await this.readTmuxValue(paneId, "#{window_id}");
    await this.runTmux(["kill-window", "-t", windowId]);
  }

  private async assertCapabilities(
    cliProvider = DEFAULT_ORCHESTRATOR_CLI_PROVIDER
  ): Promise<void> {
    const capabilities = await this.getCapabilities();
    if (!capabilities.tmuxInstalled) {
      throw new Error(
        "tmux is required for the Copilot/Gemini orchestrator feature."
      );
    }
    if (
      cliProvider === COPILOT_CLI_PROVIDER.id &&
      !capabilities.copilotInstalled
    ) {
      throw new Error(
        "The `copilot` CLI is required for Copilot-backed orchestrator sessions."
      );
    }
    if (
      cliProvider === GEMINI_CLI_PROVIDER.id &&
      !capabilities.geminiInstalled
    ) {
      throw new Error(
        "The `gemini` CLI is required for Gemini-backed orchestrator sessions."
      );
    }
  }

  private async commandExists(command: string): Promise<boolean> {
    try {
      await execFile("which", [command], { encoding: "utf8" });
      return true;
    } catch {
      return false;
    }
  }

  private async assertProjectPath(projectPath: string): Promise<void> {
    const stat = await fs
      .stat(projectPath)
      .catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") {
          throw new Error(`Project path does not exist: ${projectPath}`);
        }
        throw error;
      });
    if (!stat.isDirectory()) {
      throw new Error(`Project path must be a directory: ${projectPath}`);
    }
    const historyRoot = path.join(
      this.workspace.agentsRoot,
      ORCHESTRATOR_AGENT_ID
    );
    if (!(await pathExists(historyRoot))) {
      await fs.mkdir(historyRoot, { recursive: true });
    }
  }

  private async readWorkingTree(
    projectPath: string
  ): Promise<OrchestratorWorkingTree> {
    const repository = await this.resolveGitRepository(projectPath);
    if ("message" in repository) {
      return orchestratorWorkingTreeSchema.parse({
        state: repository.state,
        projectPath,
        files: [],
        message: repository.message,
      });
    }

    const { stdout } = await this.runGitCommand(
      ["status", "--porcelain=v1", "--untracked-files=all"],
      repository.repositoryRoot
    );
    const files = await Promise.all(
      parseGitStatusPorcelain(stdout).map(async (file) => ({
        ...file,
        lineStats: await this.readWorkingTreeFileLineStats(
          repository.repositoryRoot,
          file
        ),
      }))
    );

    return orchestratorWorkingTreeSchema.parse({
      state: files.length > 0 ? "dirty" : "clean",
      projectPath,
      repositoryRoot: repository.repositoryRoot,
      files,
      message:
        files.length > 0
          ? undefined
          : "No uncommitted changes in this project.",
    });
  }

  private async readWorkingTreeDiff(
    projectPath: string,
    filePath: string
  ): Promise<OrchestratorWorkingTreeDiff> {
    const normalizedPath = normalizeRepositoryRelativePath(filePath);
    const workingTree = await this.readWorkingTree(projectPath);
    if (workingTree.state !== "dirty" && workingTree.state !== "clean") {
      return orchestratorWorkingTreeDiffSchema.parse({
        state: workingTree.state,
        projectPath,
        repositoryRoot: workingTree.repositoryRoot,
        path: normalizedPath,
        diff: "",
        message: workingTree.message,
      });
    }

    const change = workingTree.files.find(
      (candidate) => candidate.path === normalizedPath
    );
    if (!change) {
      return orchestratorWorkingTreeDiffSchema.parse({
        state: "not-found",
        projectPath,
        repositoryRoot: workingTree.repositoryRoot,
        path: normalizedPath,
        diff: "",
        message: "That file is no longer listed as an uncommitted change.",
      });
    }

    const diffArgs =
      change.statusCode === "??"
        ? ["diff", "--no-index", "--no-color", "--", "/dev/null", change.path]
        : ["diff", "--no-ext-diff", "--no-color", "HEAD", "--", change.path];
    const diffResult = await this.runGitCommand(
      diffArgs,
      workingTree.repositoryRoot ?? projectPath,
      [0, 1]
    );
    const diff = diffResult.stdout.trim().length > 0 ? diffResult.stdout : "";
    const structured = diff ? parseStructuredUnifiedDiff(diff) : undefined;

    return orchestratorWorkingTreeDiffSchema.parse({
      state: diff ? "ready" : "empty",
      projectPath,
      repositoryRoot: workingTree.repositoryRoot,
      path: change.path,
      diff,
      structured,
      message: diff
        ? structured && !structured.hasText
          ? structured.isBinary
            ? "This change contains binary or non-text content, so no text diff preview is available."
            : "No line-level text diff is available for this file."
          : undefined
        : "No text diff is available for this file yet.",
    });
  }

  private async readWorkingTreeFileLineStats(
    repositoryRoot: string,
    file: OrchestratorWorkingTreeFile
  ): Promise<
    | {
        added: number;
        removed: number;
        isBinary: boolean;
      }
    | undefined
  > {
    const diffArgs =
      file.statusCode === "??"
        ? [
            "diff",
            "--no-index",
            "--no-color",
            "--numstat",
            "--",
            "/dev/null",
            file.path,
          ]
        : [
            "diff",
            "--no-ext-diff",
            "--no-color",
            "--numstat",
            "HEAD",
            "--",
            file.path,
          ];
    const result = await this.runGitCommand(diffArgs, repositoryRoot, [0, 1]);
    const firstLine = result.stdout
      .split(/\r?\n/)
      .find((line) => line.trim().length > 0);
    if (!firstLine) {
      return {
        added: 0,
        removed: 0,
        isBinary: false,
      };
    }
    return parseNumstatLine(firstLine);
  }

  private async resolveGitRepository(projectPath: string): Promise<
    | {
        state: "clean" | "dirty";
        repositoryRoot: string;
      }
    | {
        state: "non-git" | "git-unavailable";
        message: string;
      }
  > {
    if (!(await this.commandExists("git"))) {
      return {
        state: "git-unavailable",
        message:
          "Git is not installed, so working tree changes cannot be shown.",
      };
    }

    try {
      const { stdout } = await this.runGitCommand(
        ["rev-parse", "--show-toplevel"],
        projectPath
      );
      return {
        state: "clean",
        repositoryRoot: stdout.trim(),
      };
    } catch (error) {
      if (isGitMissingRepositoryError(error)) {
        return {
          state: "non-git",
          message: "This project path is not inside a git repository.",
        };
      }
      throw error;
    }
  }

  private async runGitCommand(
    args: string[],
    cwd: string,
    allowedExitCodes = [0]
  ) {
    try {
      return await execFile("git", args, {
        cwd,
        encoding: "utf8",
      });
    } catch (error) {
      const exitCode =
        typeof error === "object" && error && "code" in error
          ? error.code
          : undefined;
      if (
        typeof exitCode === "number" &&
        allowedExitCodes.includes(exitCode) &&
        typeof error === "object" &&
        error &&
        "stdout" in error &&
        "stderr" in error
      ) {
        return {
          stdout: typeof error.stdout === "string" ? error.stdout : "",
          stderr: typeof error.stderr === "string" ? error.stderr : "",
        };
      }
      throw error;
    }
  }

  private normalizeCliProvider(cliProvider?: string): string {
    const normalized = cliProvider?.trim() || DEFAULT_ORCHESTRATOR_CLI_PROVIDER;
    return normalized === GEMINI_CLI_PROVIDER.id
      ? GEMINI_CLI_PROVIDER.id
      : COPILOT_CLI_PROVIDER.id;
  }

  private async finalizeCancelledJob(
    sessionId: string,
    jobId: string,
    completedAt: string,
    sessionUpdates: Partial<Pick<OrchestratorSession, "tmuxPaneId" | "status">>
  ): Promise<void> {
    await updateOrchestratorJob(this.workspace, sessionId, jobId, {
      status: "failed",
      completedAt,
      exitCode: CANCELLED_JOB_EXIT_CODE,
    });
    await writeOrchestratorJobCompletion(this.workspace, sessionId, jobId, {
      exitCode: CANCELLED_JOB_EXIT_CODE,
      completedAt,
    });
    await updateOrchestratorSession(this.workspace, sessionId, {
      ...sessionUpdates,
      activeJobId: undefined,
      lastJobId: jobId,
    });
  }

  private async queueDelegation(
    session: OrchestratorSession,
    delegatedPrompt: string,
    options: {
      attachment?: OrchestratorDelegateRequest["attachment"];
      customAgentId?: string;
      scheduleId?: string;
    } = {}
  ): Promise<QueueDelegationResult> {
    const attachment = options.attachment;
    const promptMode =
      attachment || shouldMaterializePrompt(delegatedPrompt)
        ? "file"
        : "inline";
    const premiumUsage = await this.estimatePremiumUsage(session.model);
    const job = await createOrchestratorJob(this.workspace, session.sessionId, {
      prompt: delegatedPrompt,
      promptPreview:
        delegatedPrompt.trim().slice(0, 160) ||
        attachment?.name ||
        "Delegated prompt",
      promptMode,
      attachment,
      customAgentId: options.customAgentId,
      scheduleId: options.scheduleId,
      premiumUsage,
    });
    if (options.customAgentId !== session.selectedCustomAgentId) {
      await updateOrchestratorSession(this.workspace, session.sessionId, {
        selectedCustomAgentId: options.customAgentId,
      });
    }
    const { session: executionSession, systemNotice } =
      await this.ensureSessionReadyForExecution({
        ...session,
        selectedCustomAgentId: options.customAgentId,
      });
    const preparedJob = await this.prepareJobArtifacts(
      executionSession,
      job,
      delegatedPrompt
    );
    if (executionSession.status === "running" && executionSession.activeJobId) {
      await updateOrchestratorSession(this.workspace, session.sessionId, {
        lastJobId: preparedJob.jobId,
        status: "running",
      });
      return { job: preparedJob, systemNotice };
    }

    await this.startPreparedJob(executionSession, preparedJob);
    return { job: preparedJob, systemNotice };
  }

  private async prepareJobArtifacts(
    session: OrchestratorSession,
    job: OrchestratorJob,
    prompt: string
  ): Promise<OrchestratorJob> {
    const effectivePrompt = buildPromptWithAttachmentContext(
      this.workspace.storeRoot,
      prompt,
      job.attachment
    );
    let promptPath = job.promptPath;
    if (job.promptMode === "file") {
      promptPath = path.join(job.jobDirectory, ORCHESTRATOR_PROMPT_FILENAME);
      await fs.writeFile(
        promptPath,
        ensureTrailingNewline(effectivePrompt),
        "utf8"
      );
      await updateOrchestratorJob(
        this.workspace,
        session.sessionId,
        job.jobId,
        {
          promptPath,
        }
      );
    }

    const donePath = path.join(job.jobDirectory, "DONE.json");
    const outputPath = path.join(job.jobDirectory, "output.log");
    const scriptPath = path.join(
      job.jobDirectory,
      ORCHESTRATOR_SCRIPT_FILENAME
    );
    await updateOrchestratorJob(this.workspace, session.sessionId, job.jobId, {
      outputPath,
    });
    const script = buildDelegationShellScript({
      jobId: job.jobId,
      donePath,
      outputPath,
      cliProvider: session.cliProvider ?? DEFAULT_ORCHESTRATOR_CLI_PROVIDER,
      model: session.model,
      prompt: effectivePrompt,
      promptPath,
      promptMode: job.promptMode,
      projectPurpose: session.projectPurpose,
      customAgentId: job.customAgentId,
      executionMode: session.executionMode,
      tmuxTarget: session.tmuxPaneId,
    });
    await fs.writeFile(scriptPath, script, "utf8");
    await fs.chmod(scriptPath, 0o755);

    return {
      ...job,
      promptPath,
      outputPath,
    };
  }

  private async startPreparedJob(
    session: Pick<
      OrchestratorSession,
      "sessionId" | "tmuxPaneId" | "premiumUsage"
    >,
    job: Pick<OrchestratorJob, "jobId" | "jobDirectory" | "premiumUsage">
  ): Promise<void> {
    const scriptPath = path.join(
      job.jobDirectory,
      ORCHESTRATOR_SCRIPT_FILENAME
    );
    await this.runTmux([
      "send-keys",
      "-t",
      session.tmuxPaneId,
      `bash ${shellQuote(scriptPath)}`,
      "Enter",
    ]);
    await updateOrchestratorJob(this.workspace, session.sessionId, job.jobId, {
      status: "running",
      startedAt: new Date().toISOString(),
    });
    await updateOrchestratorSession(this.workspace, session.sessionId, {
      activeJobId: job.jobId,
      lastJobId: job.jobId,
      premiumUsage: accumulatePremiumUsageTotals(
        session.premiumUsage,
        job.premiumUsage
      ),
      status: "running",
    });
  }

  private async ensureSessionReadyForExecution(
    session: OrchestratorSession
  ): Promise<{
    session: OrchestratorSession;
    systemNotice?: string;
  }> {
    if (await this.tmuxPaneExists(session.tmuxPaneId)) {
      return { session };
    }

    const nextPaneId = await this.createWindow({
      projectPath: session.projectPath,
      tmuxWindowName: session.tmuxWindowName,
      startedAt: session.startedAt,
      title: session.title,
      sessionId: session.sessionId,
    });
    await this.writePaneNotice(nextPaneId, AUTO_RECOVERED_TMUX_NOTICE);

    const runningJob =
      session.jobs.find((job) => job.jobId === session.activeJobId) ??
      session.jobs.find((job) => job.status === "running");
    if (runningJob) {
      await this.finalizeCancelledJob(
        session.sessionId,
        runningJob.jobId,
        new Date().toISOString(),
        {
          tmuxPaneId: nextPaneId,
          status: "idle",
        }
      );
    } else {
      await updateOrchestratorSession(this.workspace, session.sessionId, {
        tmuxPaneId: nextPaneId,
        activeJobId: undefined,
        status: "idle",
      });
    }

    return {
      session: {
        ...session,
        tmuxPaneId: nextPaneId,
        activeJobId: undefined,
        status: "idle",
      },
      systemNotice: AUTO_RECOVERED_TMUX_NOTICE,
    };
  }

  private async estimatePremiumUsage(model: string) {
    if (!this.resolveModelDescriptor) {
      return undefined;
    }

    const descriptor = await this.resolveModelDescriptor(model);
    if (!descriptor) {
      return undefined;
    }

    return {
      source: "tmux-estimate" as const,
      model,
      premiumRequestUnits: descriptor.premiumRequestMultiplier ?? 0,
      billingMultiplier: descriptor.premiumRequestMultiplier,
      recordedAt: new Date().toISOString(),
    };
  }

  private async resolveRetryPrompt(
    job: Pick<OrchestratorJob, "prompt" | "promptPath">
  ) {
    if (job.prompt?.trim().length) {
      return job.prompt;
    }
    if (!job.promptPath) {
      return "";
    }
    return fs.readFile(job.promptPath, "utf8");
  }

  private async readRetryAttachment(
    attachment?: StoredAttachment
  ): Promise<AttachmentUpload | undefined> {
    if (!attachment) {
      return undefined;
    }
    const filePath = path.join(
      this.workspace.storeRoot,
      attachment.relativePath
    );
    const content = await fs.readFile(filePath);
    return {
      name: attachment.name,
      contentType: attachment.contentType,
      size: attachment.size,
      base64Data: content.toString("base64"),
    };
  }

  private resolveSelectedCustomAgentId(
    session: Pick<
      OrchestratorSession,
      "availableCustomAgents" | "selectedCustomAgentId"
    >,
    requestedCustomAgentId: string | null | undefined
  ): string | undefined {
    if (requestedCustomAgentId === undefined) {
      return session.selectedCustomAgentId;
    }
    if (requestedCustomAgentId === null) {
      return undefined;
    }
    const selected = requestedCustomAgentId.trim();
    if (!selected) {
      return undefined;
    }
    const exists = session.availableCustomAgents.some(
      (agent) => agent.id === selected
    );
    if (!exists) {
      throw new Error(
        `Unknown Copilot custom agent for this session: ${requestedCustomAgentId}`
      );
    }
    return selected;
  }

  private isEmailDeliveryConfigured(): boolean {
    return isRuntimeSmtpConfigured();
  }

  private async loadSession(
    sessionId: string,
    systemNotice?: string
  ): Promise<OrchestratorSession> {
    const session = await this.getSession(sessionId);
    return systemNotice ? { ...session, systemNotice } : session;
  }

  private async writePaneNotice(
    paneId: string,
    message: string
  ): Promise<void> {
    await this.runTmux([
      "send-keys",
      "-t",
      paneId,
      `printf ${shellQuote(`[min-kb-app] ${message}\\n`)}`,
      "Enter",
    ]);
  }
}

export function deriveSessionStatus(
  session: Pick<
    OrchestratorSession,
    "status" | "activeJobId" | "lastJobId" | "jobs"
  >,
  paneExists: boolean
): ReconciledStatus {
  if (!paneExists) {
    return {
      status: "missing",
      activeJobId: undefined,
      lastJobId: session.lastJobId,
    };
  }

  const runningJob = session.jobs.find((job) => job.status === "running");
  if (runningJob) {
    return {
      status: "running",
      activeJobId: runningJob.jobId,
      lastJobId: runningJob.jobId,
    };
  }

  const queuedJob = getNextQueuedJob(session.jobs);
  if (queuedJob) {
    return {
      status: "running",
      activeJobId: undefined,
      lastJobId: queuedJob.jobId,
    };
  }

  const latestJob = session.jobs[0];
  if (!latestJob) {
    return {
      status: "idle",
      activeJobId: undefined,
      lastJobId: undefined,
    };
  }

  return {
    status: latestJob.status === "failed" ? "failed" : "completed",
    activeJobId: undefined,
    lastJobId: latestJob.jobId,
  };
}

function getNextQueuedJob(
  jobs: readonly OrchestratorJob[]
): OrchestratorJob | undefined {
  return [...jobs]
    .filter((job) => job.status === "queued")
    .sort((left, right) =>
      left.submittedAt.localeCompare(right.submittedAt)
    )[0];
}

export function shouldMaterializePrompt(prompt: string): boolean {
  const lineCount = prompt.split("\n").length;
  return (
    prompt.length > DIRECT_PROMPT_LIMIT || lineCount > DIRECT_PROMPT_LINE_LIMIT
  );
}

export function buildDelegationShellScript(input: {
  jobId: string;
  donePath: string;
  outputPath: string;
  cliProvider?: string;
  model: string;
  prompt: string;
  promptMode: "inline" | "file";
  promptPath?: string;
  projectPurpose: string;
  customAgentId?: string;
  executionMode?: OrchestratorExecutionMode;
  tmuxTarget: string;
}): string {
  const cliProvider = input.cliProvider ?? DEFAULT_ORCHESTRATOR_CLI_PROVIDER;
  const command =
    cliProvider === GEMINI_CLI_PROVIDER.id
      ? buildGeminiCommand({
          model: input.model,
          prompt: input.prompt,
          promptMode: input.promptMode,
          promptPath: input.promptPath,
        })
      : buildCopilotCommand({
          model: input.model,
          prompt: input.prompt,
          promptMode: input.promptMode,
          promptPath: input.promptPath,
          projectPurpose: input.projectPurpose,
          customAgentId: input.customAgentId,
          executionMode: input.executionMode ?? "standard",
        });
  return [
    "#!/usr/bin/env bash",
    "set -u",
    "set -o pipefail",
    `job_id=${shellQuote(input.jobId)}`,
    `done_path=${shellQuote(input.donePath)}`,
    `output_path=${shellQuote(input.outputPath)}`,
    `tmux_target=${shellQuote(input.tmuxTarget)}`,
    `cli_provider=${shellQuote(cliProvider)}`,
    `max_rate_limit_retries=${MAX_COPILOT_RATE_LIMIT_RETRIES}`,
    `rate_limit_buffer_seconds=${COPILOT_RATE_LIMIT_BUFFER_SECONDS}`,
    `project_purpose=${shellQuote(input.projectPurpose)}`,
    "extract_rate_limit_wait_seconds() {",
    '  local output_file="$1"',
    "  node - \"$output_file\" <<'NODE' 2>/dev/null || true",
    ...buildCopilotRateLimitParserNodeScript(),
    "NODE",
    "}",
    'started_at=$(date -u +"%Y-%m-%dT%H:%M:%SZ")',
    'printf \'\\n[min-kb-app] Delegating job %s at %s\\n\' "$job_id" "$started_at"',
    'mkdir -p "$(dirname "$output_path")"',
    `printf '[min-kb-app] Job %s started at %s\\n' "$job_id" "$started_at" >> "$output_path"`,
    "attempt=1",
    "rate_limit_retry_count=0",
    "while true; do",
    `  attempt_output=$(mktemp "\${TMPDIR:-/tmp}/min-kb-app-rate-limit.XXXXXX")`,
    '  if [ "$attempt" -gt 1 ]; then',
    `    printf '[min-kb-app] Job %s retry attempt %s of %s\\n' "$job_id" "$rate_limit_retry_count" "$max_rate_limit_retries" | tee -a "$output_path"`,
    "  fi",
    "  {",
    `    ${command}`,
    '  } 2>&1 | tee -a "$output_path" "$attempt_output"',
    "  status=$" + "{PIPESTATUS[0]}",
    '  if [ "$status" -eq 0 ]; then',
    '    rm -f "$attempt_output"',
    "    break",
    "  fi",
    '  wait_seconds=""',
    '  if [ "$cli_provider" = "copilot" ]; then',
    '    wait_seconds=$(extract_rate_limit_wait_seconds "$attempt_output")',
    "  fi",
    '  if [ -n "$wait_seconds" ]; then',
    '    if [ "$rate_limit_retry_count" -ge "$max_rate_limit_retries" ]; then',
    `      printf '[min-kb-app] Copilot rate limit retry budget exhausted for job %s after %s retries.\\n' "$job_id" "$rate_limit_retry_count" | tee -a "$output_path"`,
    '      rm -f "$attempt_output"',
    "      break",
    "    fi",
    "    rate_limit_retry_count=$((rate_limit_retry_count + 1))",
    "    sleep_seconds=$((wait_seconds + rate_limit_buffer_seconds))",
    '    if [ "$sleep_seconds" -lt 1 ]; then',
    "      sleep_seconds=1",
    "    fi",
    '    retry_at=$(date -u -d "@$(( $(date -u +%s) + sleep_seconds ))" +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null || true)',
    '    if [ -n "$retry_at" ]; then',
    `      printf '[min-kb-app] Copilot rate limit detected for job %s. Waiting %s seconds until %s before retry %s of %s.\\n' "$job_id" "$sleep_seconds" "$retry_at" "$rate_limit_retry_count" "$max_rate_limit_retries" | tee -a "$output_path"`,
    "    else",
    `      printf '[min-kb-app] Copilot rate limit detected for job %s. Waiting %s seconds before retry %s of %s.\\n' "$job_id" "$sleep_seconds" "$rate_limit_retry_count" "$max_rate_limit_retries" | tee -a "$output_path"`,
    "    fi",
    '    rm -f "$attempt_output"',
    '    sleep "$sleep_seconds"',
    "    attempt=$((attempt + 1))",
    "    continue",
    "  fi",
    '  rm -f "$attempt_output"',
    "  break",
    "done",
    'completed_at=$(date -u +"%Y-%m-%dT%H:%M:%SZ")',
    'printf \'\\n[min-kb-app] Job %s finished with exit code %s at %s\\n\' "$job_id" "$status" "$completed_at"',
    `printf '[min-kb-app] Job %s finished with exit code %s at %s\\n' "$job_id" "$status" "$completed_at" >> "$output_path"`,
    'if [ "$status" -eq 0 ]; then',
    '  completion_message="min-kb-app: job $job_id completed successfully"',
    "else",
    '  completion_message="min-kb-app: job $job_id failed (exit $status)"',
    "fi",
    'printf \'[min-kb-app] Notification: %s at %s\\n\' "$completion_message" "$completed_at"',
    'cat > "$done_path" <<EOF',
    "{",
    '  "exitCode": $status,',
    '  "completedAt": "$completed_at"',
    "}",
    "EOF",
    'tmux display-message -d 15000 -t "$tmux_target" "$completion_message"',
    "printf '\\a'",
    "exit 0",
    "",
  ].join("\n");
}

export function extractCopilotRateLimitWaitSeconds(
  output: string,
  nowMs = Date.now()
): number | undefined {
  if (!COPILOT_RATE_LIMIT_SIGNAL_PATTERN.test(output)) {
    return undefined;
  }

  const candidates = [
    ...collectRateLimitRetryAfterMatches(output),
    ...collectRateLimitResetEpochMatches(output, nowMs),
    ...collectRateLimitResetIsoMatches(output, nowMs),
    ...collectRateLimitRelativeMatches(output),
  ].filter((value) => Number.isFinite(value) && value > 0);

  if (candidates.length === 0) {
    return DEFAULT_COPILOT_RATE_LIMIT_WAIT_SECONDS;
  }

  return Math.max(1, Math.ceil(Math.min(...candidates)));
}

export function buildCopilotCommand(input: {
  model: string;
  prompt: string;
  promptMode: "inline" | "file";
  promptPath?: string;
  projectPurpose: string;
  customAgentId?: string;
  executionMode: OrchestratorExecutionMode;
}): string {
  const agentFlag = input.customAgentId
    ? ` --agent ${shellQuote(input.customAgentId)}`
    : "";
  const promptFlag = "-p";
  const normalizePrompt = (value: string) =>
    input.executionMode === "fleet" ? `/fleet ${value}` : value;
  if (input.promptMode === "file") {
    if (!input.promptPath) {
      throw new Error("Prompt file mode requires a promptPath.");
    }
    const delegatedPrompt = [
      "Read the full task instructions from the referenced file and carry them out in the current working directory.",
      `Task file: ${input.promptPath}`,
      `Project purpose: ${input.projectPurpose}`,
    ].join("\n");
    return `copilot --model ${shellQuote(input.model)}${agentFlag} --yolo ${promptFlag} ${shellQuote(
      normalizePrompt(delegatedPrompt)
    )}`;
  }
  return `copilot --model ${shellQuote(input.model)}${agentFlag} --yolo ${promptFlag} ${shellQuote(
    normalizePrompt(input.prompt)
  )}`;
}

export function buildGeminiCommand(input: {
  model: string;
  prompt: string;
  promptMode: "inline" | "file";
  promptPath?: string;
}): string {
  if (input.promptMode === "file") {
    if (!input.promptPath) {
      throw new Error("Prompt file mode requires a promptPath.");
    }
    return `gemini --model ${shellQuote(input.model)} --yolo < ${shellQuote(
      input.promptPath
    )}`;
  }

  return `gemini --model ${shellQuote(input.model)} --yolo --prompt ${shellQuote(
    input.prompt
  )}`;
}

function buildPromptWithAttachmentContext(
  storeRoot: string,
  prompt: string,
  attachment?: {
    name: string;
    contentType: string;
    size: number;
    relativePath: string;
  }
): string {
  const trimmedPrompt = prompt.trim();
  if (!attachment) {
    return trimmedPrompt;
  }

  const attachmentPath = path.join(storeRoot, attachment.relativePath);
  return [
    "A file is attached to this delegated task.",
    `Attachment name: ${attachment.name}`,
    `Attachment type: ${attachment.contentType}`,
    `Attachment size: ${attachment.size} bytes`,
    `Attachment path: ${attachmentPath}`,
    "Inspect the attachment from disk as part of the work if it is relevant.",
    "",
    "Task:",
    trimmedPrompt ||
      "Inspect the attached file and complete the most relevant next step in the current project.",
  ].join("\n");
}

function buildCopilotRateLimitParserNodeScript(): string[] {
  return [
    "const fs = require('node:fs');",
    `const COPILOT_RATE_LIMIT_SIGNAL_PATTERN = ${COPILOT_RATE_LIMIT_SIGNAL_PATTERN.toString()};`,
    `const COPILOT_RATE_LIMIT_RETRY_AFTER_PATTERN = ${COPILOT_RATE_LIMIT_RETRY_AFTER_PATTERN.toString()};`,
    `const COPILOT_RATE_LIMIT_RESET_EPOCH_PATTERN = ${COPILOT_RATE_LIMIT_RESET_EPOCH_PATTERN.toString()};`,
    `const COPILOT_RATE_LIMIT_RESET_ISO_PATTERN = ${COPILOT_RATE_LIMIT_RESET_ISO_PATTERN.toString()};`,
    `const COPILOT_RATE_LIMIT_RELATIVE_WINDOW_PATTERN = ${COPILOT_RATE_LIMIT_RELATIVE_WINDOW_PATTERN.toString()};`,
    `const COPILOT_RATE_LIMIT_DURATION_PART_PATTERN = ${COPILOT_RATE_LIMIT_DURATION_PART_PATTERN.toString()};`,
    `const DEFAULT_COPILOT_RATE_LIMIT_WAIT_SECONDS = ${DEFAULT_COPILOT_RATE_LIMIT_WAIT_SECONDS};`,
    collectRateLimitHelpersSource(),
    "const outputPath = process.argv[2];",
    "if (!outputPath) {",
    "  process.exit(0);",
    "}",
    "const output = fs.readFileSync(outputPath, 'utf8');",
    "const waitSeconds = extractCopilotRateLimitWaitSeconds(output);",
    "if (Number.isFinite(waitSeconds) && waitSeconds > 0) {",
    "  process.stdout.write(String(waitSeconds));",
    "}",
  ];
}

function collectRateLimitHelpersSource(): string {
  return [
    "function collectMatches(pattern, output, mapper) {",
    "  return Array.from(output.matchAll(pattern), mapper);",
    "}",
    "function unitToSeconds(unit) {",
    "  switch (unit.toLowerCase()) {",
    "    case 'second':",
    "    case 'seconds':",
    "    case 'sec':",
    "    case 'secs':",
    "    case 's':",
    "      return 1;",
    "    case 'minute':",
    "    case 'minutes':",
    "    case 'min':",
    "    case 'mins':",
    "    case 'm':",
    "      return 60;",
    "    case 'hour':",
    "    case 'hours':",
    "    case 'hr':",
    "    case 'hrs':",
    "    case 'h':",
    "      return 3600;",
    "    case 'day':",
    "    case 'days':",
    "    case 'd':",
    "      return 86400;",
    "    default:",
    "      return undefined;",
    "  }",
    "}",
    "function collectRateLimitRetryAfterMatches(output) {",
    "  return collectMatches(",
    "    COPILOT_RATE_LIMIT_RETRY_AFTER_PATTERN,",
    "    output,",
    "    (match) => Number.parseInt(match[1] ?? '', 10)",
    "  ).filter(Number.isFinite);",
    "}",
    "function collectRateLimitResetEpochMatches(output, nowMs) {",
    "  return collectMatches(",
    "    COPILOT_RATE_LIMIT_RESET_EPOCH_PATTERN,",
    "    output,",
    "    (match) => {",
    "      const resetAtSeconds = Number.parseInt(match[1] ?? '', 10);",
    "      if (!Number.isFinite(resetAtSeconds)) {",
    "        return Number.NaN;",
    "      }",
    "      return resetAtSeconds - nowMs / 1000;",
    "    }",
    "  ).filter(Number.isFinite);",
    "}",
    "function collectRateLimitResetIsoMatches(output, nowMs) {",
    "  return collectMatches(",
    "    COPILOT_RATE_LIMIT_RESET_ISO_PATTERN,",
    "    output,",
    "    (match) => {",
    "      const resetAtMs = Date.parse(match[1] ?? '');",
    "      if (!Number.isFinite(resetAtMs)) {",
    "        return Number.NaN;",
    "      }",
    "      return (resetAtMs - nowMs) / 1000;",
    "    }",
    "  ).filter(Number.isFinite);",
    "}",
    "function collectRateLimitRelativeMatches(output) {",
    "  return collectMatches(COPILOT_RATE_LIMIT_RELATIVE_WINDOW_PATTERN, output, (match) => {",
    "    const window = match[1] ?? '';",
    "    const durationParts = Array.from(window.matchAll(COPILOT_RATE_LIMIT_DURATION_PART_PATTERN));",
    "    if (durationParts.length === 0) {",
    "      return Number.NaN;",
    "    }",
    "    const totalSeconds = durationParts.reduce((sum, durationMatch) => {",
    "      const amount = Number.parseInt(durationMatch[1] ?? '', 10);",
    "      const unitSeconds = unitToSeconds(durationMatch[2] ?? '');",
    "      if (!Number.isFinite(amount) || unitSeconds === undefined) {",
    "        return Number.NaN;",
    "      }",
    "      return sum + amount * unitSeconds;",
    "    }, 0);",
    "    return Number.isFinite(totalSeconds) && totalSeconds > 0 ? totalSeconds : Number.NaN;",
    "  }).filter(Number.isFinite);",
    "}",
    "function extractCopilotRateLimitWaitSeconds(output, nowMs = Date.now()) {",
    "  if (!COPILOT_RATE_LIMIT_SIGNAL_PATTERN.test(output)) {",
    "    return undefined;",
    "  }",
    "  const candidates = [",
    "    ...collectRateLimitRetryAfterMatches(output),",
    "    ...collectRateLimitResetEpochMatches(output, nowMs),",
    "    ...collectRateLimitResetIsoMatches(output, nowMs),",
    "    ...collectRateLimitRelativeMatches(output),",
    "  ].filter((value) => Number.isFinite(value) && value > 0);",
    "  if (candidates.length === 0) {",
    "    return DEFAULT_COPILOT_RATE_LIMIT_WAIT_SECONDS;",
    "  }",
    "  return Math.max(1, Math.ceil(Math.min(...candidates)));",
    "}",
  ].join("\n");
}

function collectRateLimitRetryAfterMatches(output: string): number[] {
  return Array.from(output.matchAll(COPILOT_RATE_LIMIT_RETRY_AFTER_PATTERN))
    .map((match) => Number.parseInt(match[1] ?? "", 10))
    .filter(Number.isFinite);
}

function collectRateLimitResetEpochMatches(
  output: string,
  nowMs: number
): number[] {
  return Array.from(output.matchAll(COPILOT_RATE_LIMIT_RESET_EPOCH_PATTERN))
    .map((match) => {
      const resetAtSeconds = Number.parseInt(match[1] ?? "", 10);
      if (!Number.isFinite(resetAtSeconds)) {
        return Number.NaN;
      }
      return resetAtSeconds - nowMs / 1000;
    })
    .filter(Number.isFinite);
}

function collectRateLimitResetIsoMatches(
  output: string,
  nowMs: number
): number[] {
  return Array.from(output.matchAll(COPILOT_RATE_LIMIT_RESET_ISO_PATTERN))
    .map((match) => {
      const resetAtMs = Date.parse(match[1] ?? "");
      if (!Number.isFinite(resetAtMs)) {
        return Number.NaN;
      }
      return (resetAtMs - nowMs) / 1000;
    })
    .filter(Number.isFinite);
}

function collectRateLimitRelativeMatches(output: string): number[] {
  return Array.from(output.matchAll(COPILOT_RATE_LIMIT_RELATIVE_WINDOW_PATTERN))
    .map((match) => {
      const window = match[1] ?? "";
      const durationParts = Array.from(
        window.matchAll(COPILOT_RATE_LIMIT_DURATION_PART_PATTERN)
      );
      if (durationParts.length === 0) {
        return Number.NaN;
      }
      const totalSeconds = durationParts.reduce((sum, durationMatch) => {
        const amount = Number.parseInt(durationMatch[1] ?? "", 10);
        const unitSeconds = rateLimitUnitToSeconds(durationMatch[2] ?? "");
        if (!Number.isFinite(amount) || unitSeconds === undefined) {
          return Number.NaN;
        }
        return sum + amount * unitSeconds;
      }, 0);
      return Number.isFinite(totalSeconds) && totalSeconds > 0
        ? totalSeconds
        : Number.NaN;
    })
    .filter(Number.isFinite);
}

function rateLimitUnitToSeconds(unit: string): number | undefined {
  switch (unit.toLowerCase()) {
    case "second":
    case "seconds":
    case "sec":
    case "secs":
    case "s":
      return 1;
    case "minute":
    case "minutes":
    case "min":
    case "mins":
    case "m":
      return 60;
    case "hour":
    case "hours":
    case "hr":
    case "hrs":
    case "h":
      return 3600;
    case "day":
    case "days":
    case "d":
      return 86_400;
    default:
      return undefined;
  }
}

export function isMemorySkillName(name: string): boolean {
  return /memory|working[- ]memory|short[- ]term|long[- ]term/i.test(name);
}

export function resolveMemoryAnalysisModel(model?: string): string {
  return model?.trim() || DEFAULT_MEMORY_ANALYSIS_MODEL;
}

export function buildMemoryAnalysisRuntimeConfig(input: {
  availableSkillNames: string[];
  baseConfig?: Partial<ChatRuntimeConfig>;
  model?: string;
}): ChatRuntimeConfig {
  const enabledMemorySkillNames =
    input.availableSkillNames.filter(isMemorySkillName);

  return {
    provider: input.baseConfig?.provider ?? DEFAULT_CHAT_PROVIDER,
    model: resolveMemoryAnalysisModel(input.model),
    reasoningEffort: input.baseConfig?.reasoningEffort,
    mcpServers: input.baseConfig?.mcpServers ?? {},
    disabledSkills: input.availableSkillNames.filter(
      (skillName) => !enabledMemorySkillNames.includes(skillName)
    ),
  };
}

export function buildMemoryAnalysisPrompt(
  thread: ChatSession,
  memorySkillNames: string[]
): string {
  const transcript = thread.turns
    .map(
      (turn) =>
        `## ${turn.sender} @ ${turn.createdAt}\n\n${turn.bodyMarkdown.trim()}`
    )
    .join("\n\n");
  const skillSection =
    memorySkillNames.length > 0
      ? [
          "Memory-related skills are available for this run:",
          ...memorySkillNames.map((name) => `- ${name}`),
          "You may use them, but the structured sections below are still required.",
        ].join("\n")
      : "Memory-related skills may be unavailable for this run. Structured sections are still required because the runtime can persist the memory you identify.\n";
  return [
    "Review the following chat history and identify only the information worth remembering.",
    "Prefer durable facts, stable preferences, ongoing project context, active decisions, and any near-term context that should stay available.",
    "Use working memory for immediate context, short-term memory for near-future reusable context, and long-term memory for durable facts or preferences.",
    "Always reply in markdown with exactly three sections named Working memory, Short-term memory, and Long-term memory.",
    "For each section, write a short summary sentence and then a '-' bullet list of memory items. If a section has nothing worth keeping, write 'None.'",
    "If you are unsure which tier applies, place the item in Working memory instead of omitting it.",
    "",
    skillSection.trim(),
    "",
    `Session title: ${thread.title}`,
    `Session summary: ${thread.summary}`,
    "",
    "# Chat history",
    "",
    transcript,
  ].join("\n");
}

export function parseMemoryAnalysisMarkdown(markdown: string): {
  working: { summary: string; items: string[] };
  shortTerm: { summary: string; items: string[] };
  longTerm: { summary: string; items: string[] };
} {
  const sections = {
    working: { summary: "", items: [] as string[] },
    shortTerm: { summary: "", items: [] as string[] },
    longTerm: { summary: "", items: [] as string[] },
  };
  const contentBySection = {
    working: [] as string[],
    shortTerm: [] as string[],
    longTerm: [] as string[],
  };
  let currentSection: keyof typeof sections | undefined;

  for (const rawLine of markdown.split("\n")) {
    const heading = parseMemoryHeadingLine(rawLine);
    if (heading) {
      currentSection = heading.section;
      if (heading.remainder) {
        contentBySection[currentSection].push(heading.remainder);
      }
      continue;
    }

    if (currentSection) {
      contentBySection[currentSection].push(rawLine);
    }
  }

  for (const section of Object.keys(contentBySection) as Array<
    keyof typeof contentBySection
  >) {
    sections[section] = summarizeMemorySection(
      contentBySection[section].join("\n").trim()
    );
  }

  if (!hasParsedMemoryContent(sections) && markdown.trim()) {
    sections.working = summarizeMemorySection(markdown);
  }

  return sections;
}

function normalizeMemoryHeading(
  heading: string
): "working" | "shortTerm" | "longTerm" | undefined {
  const normalized = heading
    .trim()
    .toLowerCase()
    .replace(/[*_`]/g, "")
    .replace(/\([^)]*\)/g, "")
    .replace(/[.:]+$/g, "")
    .replace(/\s+/g, " ");
  if (/^working(?: memory)?(?: items| notes| updates)?$/.test(normalized)) {
    return "working";
  }
  if (
    /^(?:short|near)(?:[- ]term)?(?: memory)?(?: items| notes| updates)?$/.test(
      normalized
    )
  ) {
    return "shortTerm";
  }
  if (
    /^(?:long|durable)(?:[- ]term)?(?: memory)?(?: items| notes| updates)?$/.test(
      normalized
    )
  ) {
    return "longTerm";
  }
  return undefined;
}

function summarizeMemorySection(content: string): {
  summary: string;
  items: string[];
} {
  if (!content) {
    return {
      summary: "",
      items: [],
    };
  }

  const lines = content
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const itemPattern = /^(?:[-*+•●◆◦▪‣]|\d+[.)])\s+/u;
  const items = lines
    .filter((line) => itemPattern.test(line))
    .map((line) => line.replace(itemPattern, "").trim())
    .filter(Boolean);
  const summary = lines
    .filter((line) => !itemPattern.test(line))
    .filter((line) => line.toLowerCase() !== "none.")
    .join(" ")
    .trim();

  return {
    summary,
    items,
  };
}

function parseMemoryHeadingLine(line: string):
  | {
      section: "working" | "shortTerm" | "longTerm";
      remainder: string;
    }
  | undefined {
  const normalizedLine = line
    .trim()
    .replace(/^#{1,6}\s*/, "")
    .replace(/^[-*+•●◆◦▪‣]\s*/u, "")
    .replace(/^\d+[.)]\s*/, "")
    .trim();

  for (const separator of [":", " - ", " – ", " — "]) {
    const separatorIndex = normalizedLine.indexOf(separator);
    if (separatorIndex < 0) {
      continue;
    }
    const section = normalizeMemoryHeading(
      normalizedLine.slice(0, separatorIndex)
    );
    if (section) {
      return {
        section,
        remainder: normalizedLine
          .slice(separatorIndex + separator.length)
          .trim(),
      };
    }
  }

  const section = normalizeMemoryHeading(normalizedLine);
  if (!section) {
    return undefined;
  }

  return {
    section,
    remainder: "",
  };
}

function hasParsedMemoryContent(sections: {
  working: { summary: string; items: string[] };
  shortTerm: { summary: string; items: string[] };
  longTerm: { summary: string; items: string[] };
}): boolean {
  return Object.values(sections).some(
    (section) => section.summary.length > 0 || section.items.length > 0
  );
}

export function parseGitStatusPorcelain(
  stdout: string
): OrchestratorWorkingTreeFile[] {
  return stdout
    .split(/\r?\n/)
    .flatMap((line): OrchestratorWorkingTreeFile[] => {
      if (line.length < 3) {
        return [];
      }

      const statusCode = line.slice(0, 2);
      if (statusCode === "!!") {
        return [];
      }
      const rawPath = line.slice(3).trim();
      if (!rawPath) {
        return [];
      }

      const renameLike =
        statusCode[0] === "R" ||
        statusCode[0] === "C" ||
        statusCode[1] === "R" ||
        statusCode[1] === "C";
      const [previousPath, nextPath] =
        renameLike && rawPath.includes(" -> ")
          ? rawPath.split(/\s->\s/, 2)
          : [undefined, rawPath];
      const nextFilePath = nextPath?.trim();
      if (!nextFilePath) {
        return [];
      }

      const stagedStatus =
        statusCode === "??"
          ? undefined
          : decodeGitStatusCharacter(statusCode[0] ?? " ");
      const unstagedStatus =
        statusCode === "??"
          ? "untracked"
          : decodeGitStatusCharacter(statusCode[1] ?? " ");

      return [
        {
          path: nextFilePath,
          previousPath: previousPath?.trim() || undefined,
          statusCode,
          stagedStatus,
          unstagedStatus,
          displayStatus: formatGitChangeDisplayStatus({
            stagedStatus,
            unstagedStatus,
          }),
        },
      ];
    });
}

function parseNumstatLine(line: string): {
  added: number;
  removed: number;
  isBinary: boolean;
} {
  const [addedRaw = "0", removedRaw = "0"] = line.split("\t");
  if (addedRaw === "-" || removedRaw === "-") {
    return {
      added: 0,
      removed: 0,
      isBinary: true,
    };
  }
  const added = Number.parseInt(addedRaw, 10);
  const removed = Number.parseInt(removedRaw, 10);
  return {
    added: Number.isFinite(added) ? added : 0,
    removed: Number.isFinite(removed) ? removed : 0,
    isBinary: false,
  };
}

function parseStructuredUnifiedDiff(diff: string): OrchestratorStructuredDiff {
  const lines = diff.replace(/\r?\n$/, "").split(/\r?\n/);
  const headerLines: string[] = [];
  const hunks: OrchestratorStructuredDiff["hunks"] = [];
  let oldPath: string | undefined;
  let newPath: string | undefined;
  let isBinary = false;
  let currentHunk: OrchestratorStructuredDiff["hunks"][number] | undefined;
  let oldLineNumber = 0;
  let newLineNumber = 0;

  for (const line of lines) {
    const hunkMatch = line.match(
      /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(?:\s(.*))?$/
    );
    if (hunkMatch) {
      oldLineNumber = Number.parseInt(hunkMatch[1] ?? "0", 10);
      newLineNumber = Number.parseInt(hunkMatch[3] ?? "0", 10);
      currentHunk = {
        header: line,
        lines: [],
      };
      hunks.push(currentHunk);
      continue;
    }

    if (!currentHunk) {
      headerLines.push(line);
      if (line.startsWith("--- ")) {
        oldPath = parseDiffHeaderPath(line.slice(4).trim()) ?? oldPath;
      } else if (line.startsWith("+++ ")) {
        newPath = parseDiffHeaderPath(line.slice(4).trim()) ?? newPath;
      } else if (line.startsWith("rename from ")) {
        oldPath = line.slice("rename from ".length).trim() || oldPath;
      } else if (line.startsWith("rename to ")) {
        newPath = line.slice("rename to ".length).trim() || newPath;
      } else if (
        line.startsWith("Binary files ") ||
        line === "GIT binary patch"
      ) {
        isBinary = true;
      }
      continue;
    }

    if (line.startsWith("+")) {
      currentHunk.lines.push({
        kind: "add",
        content: line.slice(1),
        newLineNumber,
      });
      newLineNumber += 1;
      continue;
    }

    if (line.startsWith("-")) {
      currentHunk.lines.push({
        kind: "remove",
        content: line.slice(1),
        oldLineNumber,
      });
      oldLineNumber += 1;
      continue;
    }

    if (line.startsWith(" ")) {
      currentHunk.lines.push({
        kind: "context",
        content: line.slice(1),
        oldLineNumber,
        newLineNumber,
      });
      oldLineNumber += 1;
      newLineNumber += 1;
      continue;
    }

    currentHunk.lines.push({
      kind: "meta",
      content: line,
    });
  }

  return {
    oldPath,
    newPath,
    headerLines,
    hunks,
    isBinary,
    hasText: hunks.length > 0,
  };
}

function parseDiffHeaderPath(value: string): string | undefined {
  if (!value || value === "/dev/null") {
    return undefined;
  }
  if (value.startsWith("a/") || value.startsWith("b/")) {
    return value.slice(2);
  }
  return value;
}

export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

function decodeGitStatusCharacter(
  value: string
): OrchestratorWorkingTreeFileStatus | undefined {
  switch (value) {
    case "M":
      return "modified";
    case "A":
      return "added";
    case "D":
      return "deleted";
    case "R":
      return "renamed";
    case "C":
      return "copied";
    case "U":
      return "unmerged";
    default:
      return undefined;
  }
}

function formatGitChangeDisplayStatus(input: {
  stagedStatus?: OrchestratorWorkingTreeFileStatus;
  unstagedStatus?: OrchestratorWorkingTreeFileStatus;
}): string {
  const staged = input.stagedStatus
    ? `${formatGitStatusLabel(input.stagedStatus)} staged`
    : undefined;
  const unstaged = input.unstagedStatus
    ? input.unstagedStatus === "untracked"
      ? "Untracked"
      : `${formatGitStatusLabel(input.unstagedStatus)} unstaged`
    : undefined;
  return [staged, unstaged].filter(Boolean).join(" · ") || "Changed";
}

function formatGitStatusLabel(
  status: OrchestratorWorkingTreeFileStatus
): string {
  switch (status) {
    case "added":
      return "Added";
    case "copied":
      return "Copied";
    case "deleted":
      return "Deleted";
    case "modified":
      return "Modified";
    case "renamed":
      return "Renamed";
    case "unmerged":
      return "Unmerged";
    case "untracked":
      return "Untracked";
  }
}

function normalizeRepositoryRelativePath(filePath: string): string {
  const normalized = path.posix.normalize(
    filePath.trim().replaceAll("\\", "/")
  );
  if (
    normalized.length === 0 ||
    normalized === "." ||
    normalized === ".." ||
    normalized.startsWith("../") ||
    path.posix.isAbsolute(normalized)
  ) {
    throw new Error("Change paths must stay inside the session repository.");
  }
  return normalized;
}

function isGitMissingRepositoryError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }
  const stderr =
    "stderr" in error && typeof error.stderr === "string" ? error.stderr : "";
  return /not a git repository/i.test(stderr);
}

function ensureTrailingNewline(value: string): string {
  return value.endsWith("\n") ? value : `${value}\n`;
}

function slugify(value: string): string {
  return (
    value
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "session"
  );
}
