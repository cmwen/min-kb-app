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
  getOrchestratorSchedule,
  getOrchestratorSession,
  getOrchestratorTerminalSize,
  listOrchestratorSchedules,
  listOrchestratorSessions,
  type MinKbWorkspace,
  ORCHESTRATOR_AGENT_ID,
  orchestratorHistoryRoot,
  pathExists,
  readOrchestratorTerminalChunk,
  resetOrchestratorTerminalLog,
  toOrchestratorChatSummary,
  updateOrchestratorJob,
  updateOrchestratorSchedule,
  updateOrchestratorSession,
  writeOrchestratorJobCompletion,
} from "@min-kb-app/min-kb-store";
import {
  type AgentSummary,
  type ChatRuntimeConfig,
  type ChatSession,
  type ChatSessionSummary,
  DEFAULT_CHAT_MODEL,
  DEFAULT_CHAT_PROVIDER,
  type ModelDescriptor,
  type OrchestratorCapabilities,
  type OrchestratorDelegateRequest,
  type OrchestratorJob,
  type OrchestratorSchedule,
  type OrchestratorScheduleCreateRequest,
  type OrchestratorScheduleUpdateRequest,
  type OrchestratorSession,
  type OrchestratorSessionCreateRequest,
  type OrchestratorSessionUpdateRequest,
  orchestratorCapabilitiesSchema,
} from "@min-kb-app/shared";

const execFile = promisify(execFileCallback);

export const DEFAULT_TMUX_SESSION_NAME =
  process.env.MIN_KB_APP_ORCHESTRATOR_TMUX_SESSION ?? "min-kb-app-orchestrator";

const DIRECT_PROMPT_LIMIT = 800;
const DIRECT_PROMPT_LINE_LIMIT = 12;
const CANCELLED_JOB_EXIT_CODE = -1;
const ORCHESTRATOR_PROMPT_FILENAME = "prompt.txt";
const ORCHESTRATOR_SCRIPT_FILENAME = "run.sh";
export const DEFAULT_MEMORY_ANALYSIS_MODEL = "gpt-5-mini";

interface ReconciledStatus {
  status: OrchestratorSession["status"];
  activeJobId?: string;
  lastJobId?: string;
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
    const [tmuxInstalled, copilotInstalled, sessions] = await Promise.all([
      this.commandExists("tmux"),
      this.commandExists("copilot"),
      listOrchestratorSessions(this.workspace),
    ]);
    const recentProjectPaths = [
      ...new Set(sessions.map((session) => session.projectPath)),
    ]
      .filter((projectPath) => projectPath !== this.defaultProjectPath)
      .slice(0, 8);
    return orchestratorCapabilitiesSchema.parse({
      available: tmuxInstalled && copilotInstalled,
      defaultProjectPath: this.defaultProjectPath,
      recentProjectPaths,
      tmuxInstalled,
      copilotInstalled,
      tmuxSessionName: this.tmuxSessionName,
      emailDeliveryAvailable: this.isEmailDeliveryConfigured(),
      emailFromAddress: process.env.MIN_KB_APP_SMTP_FROM,
    });
  }

  async getAgentSummary(): Promise<AgentSummary> {
    const historyRoot = orchestratorHistoryRoot(this.workspace);
    const sessionCount = (await listOrchestratorSessions(this.workspace))
      .length;
    return {
      id: ORCHESTRATOR_AGENT_ID,
      kind: "orchestrator",
      title: "Copilot Orchestrator",
      description:
        "Delegates async jobs to GitHub Copilot CLI running inside tmux windows.",
      combinedPrompt:
        "You are the built-in Copilot orchestrator agent. Queue work to tmux-managed Copilot CLI windows and keep track of project context, terminal output, and session status.",
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
    const sessions = await this.listSessions();
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

  async createSession(
    request: OrchestratorSessionCreateRequest
  ): Promise<OrchestratorSession> {
    await this.assertCapabilities();
    const projectPath = path.resolve(request.projectPath);
    const model = request.model.trim() || DEFAULT_CHAT_MODEL;
    await this.assertProjectPath(projectPath);
    const availableCustomAgents =
      await discoverCopilotCustomAgents(projectPath);
    const selectedCustomAgentId = this.resolveSelectedCustomAgentId(
      {
        availableCustomAgents,
        selectedCustomAgentId: undefined,
      },
      request.selectedCustomAgentId
    );
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
      model,
      availableCustomAgents,
      selectedCustomAgentId,
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
    const model = request.model;
    const selectedCustomAgentId = this.resolveSelectedCustomAgentId(
      session,
      request.selectedCustomAgentId
    );
    const tmuxWindowName = buildOrchestratorWindowName(
      title,
      session.projectPath,
      session.sessionId
    );
    const hasChanges =
      title !== session.title ||
      model !== session.model ||
      selectedCustomAgentId !== session.selectedCustomAgentId ||
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
      model,
      selectedCustomAgentId,
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
    return this.queueDelegation(session, schedule.prompt, {
      customAgentId: schedule.customAgentId,
      scheduleId: schedule.scheduleId,
    });
  }

  async delegate(
    sessionId: string,
    request: string | OrchestratorDelegateRequest
  ): Promise<OrchestratorSession> {
    await this.assertCapabilities();
    const session = await this.getSession(sessionId);
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
    await this.queueDelegation(session, delegatedPrompt, {
      attachment,
      customAgentId,
    });
    return this.getSession(sessionId);
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
    await this.assertCapabilities();
    const session = await getOrchestratorSession(this.workspace, sessionId);
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

  private async assertCapabilities(): Promise<void> {
    const capabilities = await this.getCapabilities();
    if (!capabilities.tmuxInstalled) {
      throw new Error("tmux is required for the Copilot orchestrator feature.");
    }
    if (!capabilities.copilotInstalled) {
      throw new Error(
        "The `copilot` CLI is required for the Copilot orchestrator feature."
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
  ): Promise<OrchestratorJob> {
    const attachment = options.attachment;
    const promptMode =
      attachment || shouldMaterializePrompt(delegatedPrompt)
        ? "file"
        : "inline";
    const premiumUsage = await this.estimatePremiumUsage(session.model);
    const job = await createOrchestratorJob(this.workspace, session.sessionId, {
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
    const preparedJob = await this.prepareJobArtifacts(
      {
        ...session,
        selectedCustomAgentId: options.customAgentId,
      },
      job,
      delegatedPrompt
    );
    if (session.status === "running" && session.activeJobId) {
      await updateOrchestratorSession(this.workspace, session.sessionId, {
        lastJobId: preparedJob.jobId,
        status: "running",
      });
      return preparedJob;
    }

    await this.startPreparedJob(session, preparedJob);
    return preparedJob;
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
      model: session.model,
      prompt: effectivePrompt,
      promptPath,
      promptMode: job.promptMode,
      projectPurpose: session.projectPurpose,
      customAgentId: job.customAgentId,
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
    return [
      process.env.MIN_KB_APP_SMTP_HOST,
      process.env.MIN_KB_APP_SMTP_PORT,
      process.env.MIN_KB_APP_SMTP_FROM,
    ].every((value) => typeof value === "string" && value.trim().length > 0);
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
  model: string;
  prompt: string;
  promptMode: "inline" | "file";
  promptPath?: string;
  projectPurpose: string;
  customAgentId?: string;
  tmuxTarget: string;
}): string {
  const command = buildCopilotCommand({
    model: input.model,
    prompt: input.prompt,
    promptMode: input.promptMode,
    promptPath: input.promptPath,
    projectPurpose: input.projectPurpose,
    customAgentId: input.customAgentId,
  });
  return [
    "#!/usr/bin/env bash",
    "set -u",
    "set -o pipefail",
    `job_id=${shellQuote(input.jobId)}`,
    `done_path=${shellQuote(input.donePath)}`,
    `output_path=${shellQuote(input.outputPath)}`,
    `tmux_target=${shellQuote(input.tmuxTarget)}`,
    `project_purpose=${shellQuote(input.projectPurpose)}`,
    'started_at=$(date -u +"%Y-%m-%dT%H:%M:%SZ")',
    'printf \'\\n[min-kb-app] Delegating job %s at %s\\n\' "$job_id" "$started_at"',
    'mkdir -p "$(dirname "$output_path")"',
    `printf '[min-kb-app] Job %s started at %s\\n' "$job_id" "$started_at" >> "$output_path"`,
    "{",
    `  ${command}`,
    '} 2>&1 | tee -a "$output_path"',
    "status=$" + "{PIPESTATUS[0]}",
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

export function buildCopilotCommand(input: {
  model: string;
  prompt: string;
  promptMode: "inline" | "file";
  promptPath?: string;
  projectPurpose: string;
  customAgentId?: string;
}): string {
  const agentFlag = input.customAgentId
    ? ` --agent ${shellQuote(input.customAgentId)}`
    : "";
  if (input.promptMode === "file") {
    if (!input.promptPath) {
      throw new Error("Prompt file mode requires a promptPath.");
    }
    const delegatedPrompt = [
      "Read the full task instructions from the referenced file and carry them out in the current working directory.",
      `Task file: ${input.promptPath}`,
      `Project purpose: ${input.projectPurpose}`,
    ].join("\n");
    return `copilot --model ${shellQuote(input.model)}${agentFlag} --yolo -p ${shellQuote(
      delegatedPrompt
    )}`;
  }
  return `copilot --model ${shellQuote(input.model)}${agentFlag} --yolo -p ${shellQuote(
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
      ? `Available memory-related skills:\n${memorySkillNames.map((name) => `- ${name}`).join("\n")}\n`
      : "No memory-specific skills were detected, so do not attempt memory writes. Instead, explain what should be stored and why.\n";
  return [
    "Review the following chat history and identify only the information worth remembering.",
    "Prefer durable facts, stable preferences, ongoing project context, active decisions, and any near-term context that should stay available.",
    "Use working memory for immediate context, short-term memory for near-future reusable context, and long-term memory for durable facts or preferences.",
    "If memory-related skills are available, invoke them during this analysis run to write or update the right items in the right memory tier instead of only recommending them.",
    "Reply in markdown with three sections: Working memory, Short-term memory, and Long-term memory. For each section, list what you stored or updated, note any remaining recommendations, and explain why.",
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
  const headingPattern = /^#{1,6}\s+(.+?)\s*$/gm;
  const matches = [...markdown.matchAll(headingPattern)];

  for (let index = 0; index < matches.length; index += 1) {
    const match = matches[index];
    if (!match) {
      continue;
    }
    const headingText = match[1];
    if (!headingText) {
      continue;
    }
    const heading = normalizeMemoryHeading(headingText);
    if (!heading) {
      continue;
    }

    const contentStart = (match.index ?? 0) + match[0].length;
    const nextMatch = matches[index + 1];
    const contentEnd =
      index + 1 < matches.length
        ? (nextMatch?.index ?? markdown.length)
        : markdown.length;
    const content = markdown.slice(contentStart, contentEnd).trim();
    sections[heading] = summarizeMemorySection(content);
  }

  return sections;
}

function normalizeMemoryHeading(
  heading: string
): "working" | "shortTerm" | "longTerm" | undefined {
  const normalized = heading.trim().toLowerCase();
  if (normalized === "working memory") {
    return "working";
  }
  if (
    normalized === "short-term memory" ||
    normalized === "short term memory"
  ) {
    return "shortTerm";
  }
  if (normalized === "long-term memory" || normalized === "long term memory") {
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
  const items = lines
    .filter((line) => /^[-*+]\s+/.test(line))
    .map((line) => line.replace(/^[-*+]\s+/, "").trim());
  const summary = lines
    .filter((line) => !/^[-*+]\s+/.test(line))
    .join(" ")
    .trim();

  return {
    summary,
    items,
  };
}

export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
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
