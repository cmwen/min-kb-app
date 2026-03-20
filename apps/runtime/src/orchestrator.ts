import { execFile as execFileCallback } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import {
  buildOrchestratorWindowName,
  createOrchestratorJob,
  createOrchestratorSession,
  getOrchestratorSession,
  getOrchestratorTerminalSize,
  listOrchestratorSessions,
  type MinKbWorkspace,
  ORCHESTRATOR_AGENT_ID,
  orchestratorHistoryRoot,
  pathExists,
  readOrchestratorTerminalChunk,
  toOrchestratorChatSummary,
  updateOrchestratorJob,
  updateOrchestratorSession,
  writeOrchestratorJobCompletion,
} from "@min-kb-app/min-kb-store";
import {
  type AgentSummary,
  type ChatSession,
  type ChatSessionSummary,
  DEFAULT_CHAT_MODEL,
  type OrchestratorCapabilities,
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

interface ReconciledStatus {
  status: OrchestratorSession["status"];
  activeJobId?: string;
  lastJobId?: string;
}

export class TmuxOrchestratorService {
  constructor(
    private readonly workspace: MinKbWorkspace,
    private readonly defaultProjectPath: string,
    private readonly tmuxSessionName = DEFAULT_TMUX_SESSION_NAME
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
    const tmuxWindowName = buildOrchestratorWindowName(
      title,
      session.projectPath,
      session.sessionId
    );
    const hasChanges =
      title !== session.title ||
      model !== session.model ||
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
      tmuxWindowName,
    });
    return this.getSession(sessionId);
  }

  async delegate(
    sessionId: string,
    prompt: string
  ): Promise<OrchestratorSession> {
    await this.assertCapabilities();
    const session = await this.getSession(sessionId);
    if (session.status === "running" && session.activeJobId) {
      throw new Error(
        `Orchestrator session ${sessionId} is already running job ${session.activeJobId}.`
      );
    }
    const promptMode = shouldMaterializePrompt(prompt) ? "file" : "inline";
    const job = await createOrchestratorJob(this.workspace, sessionId, {
      promptPreview: prompt.trim().slice(0, 160) || "Delegated prompt",
      promptMode,
    });

    let promptPath: string | undefined;
    if (promptMode === "file") {
      promptPath = path.join(job.jobDirectory, "prompt.txt");
      await fs.writeFile(promptPath, ensureTrailingNewline(prompt), "utf8");
      await updateOrchestratorJob(this.workspace, sessionId, job.jobId, {
        promptPath,
      });
    }

    const donePath = path.join(job.jobDirectory, "DONE.json");
    const scriptPath = path.join(job.jobDirectory, "run.sh");
    const script = buildDelegationShellScript({
      jobId: job.jobId,
      donePath,
      model: session.model,
      prompt,
      promptPath,
      promptMode,
      projectPurpose: session.projectPurpose,
      tmuxTarget: session.tmuxPaneId,
    });
    await fs.writeFile(scriptPath, script, "utf8");
    await fs.chmod(scriptPath, 0o755);
    await this.runTmux([
      "send-keys",
      "-t",
      session.tmuxPaneId,
      `bash ${shellQuote(scriptPath)}`,
      "Enter",
    ]);
    await updateOrchestratorJob(this.workspace, sessionId, job.jobId, {
      promptPath,
      status: "running",
      startedAt: new Date().toISOString(),
    });
    await updateOrchestratorSession(this.workspace, sessionId, {
      activeJobId: job.jobId,
      lastJobId: job.jobId,
      status: "running",
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
    const paneExists = await this.tmuxPaneExists(session.tmuxPaneId);
    if (paneExists) {
      const windowId = await this.readTmuxValue(
        session.tmuxPaneId,
        "#{window_id}"
      );
      await this.runTmux(["kill-window", "-t", windowId]);
    }

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

export function shouldMaterializePrompt(prompt: string): boolean {
  const lineCount = prompt.split("\n").length;
  return (
    prompt.length > DIRECT_PROMPT_LIMIT || lineCount > DIRECT_PROMPT_LINE_LIMIT
  );
}

export function buildDelegationShellScript(input: {
  jobId: string;
  donePath: string;
  model: string;
  prompt: string;
  promptMode: "inline" | "file";
  promptPath?: string;
  projectPurpose: string;
  tmuxTarget: string;
}): string {
  const command = buildCopilotCommand({
    model: input.model,
    prompt: input.prompt,
    promptMode: input.promptMode,
    promptPath: input.promptPath,
    projectPurpose: input.projectPurpose,
  });
  return [
    "#!/usr/bin/env bash",
    "set -u",
    `job_id=${shellQuote(input.jobId)}`,
    `done_path=${shellQuote(input.donePath)}`,
    `tmux_target=${shellQuote(input.tmuxTarget)}`,
    `project_purpose=${shellQuote(input.projectPurpose)}`,
    'started_at=$(date -u +"%Y-%m-%dT%H:%M:%SZ")',
    'printf \'\\n[min-kb-app] Delegating job %s at %s\\n\' "$job_id" "$started_at"',
    command,
    "status=$?",
    'completed_at=$(date -u +"%Y-%m-%dT%H:%M:%SZ")',
    'printf \'\\n[min-kb-app] Job %s finished with exit code %s at %s\\n\' "$job_id" "$status" "$completed_at"',
    'cat > "$done_path" <<EOF',
    "{",
    '  "exitCode": $status,',
    '  "completedAt": "$completed_at"',
    "}",
    "EOF",
    'tmux display-message -t "$tmux_target" "min-kb-app: job $job_id finished (exit $status)"',
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
}): string {
  if (input.promptMode === "file") {
    if (!input.promptPath) {
      throw new Error("Prompt file mode requires a promptPath.");
    }
    const delegatedPrompt = [
      "Read the full task instructions from the referenced file and carry them out in the current working directory.",
      `Task file: ${input.promptPath}`,
      `Project purpose: ${input.projectPurpose}`,
    ].join("\n");
    return `copilot --model ${shellQuote(input.model)} --yolo -p ${shellQuote(
      delegatedPrompt
    )}`;
  }
  return `copilot --model ${shellQuote(input.model)} --yolo -p ${shellQuote(
    input.prompt
  )}`;
}

export function isMemorySkillName(name: string): boolean {
  return /memory|working-memory|short-term|long-term/i.test(name);
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
      : "No memory-specific skills were detected, so provide recommendations without writing memory.\n";
  return [
    "Review the following chat history and identify only the information worth remembering.",
    "Prefer durable facts, stable preferences, ongoing project context, active decisions, and any near-term context that should stay available.",
    "Use working memory for immediate context, short-term memory for near-future reusable context, and long-term memory for durable facts or preferences.",
    "If memory-related skills are available, use them to store the right items in the right memory tier.",
    "Reply in markdown with three sections: Working memory, Short-term memory, and Long-term memory. For each section, list what you captured or recommended and why.",
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
