import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import type {
  AttachmentUpload,
  ChatSessionSummary,
  CopilotCustomAgent,
  OrchestratorJob,
  OrchestratorSession,
  OrchestratorSessionStatus,
  OrchestratorSessionSummary,
  PremiumUsage,
  PremiumUsageTotals,
  StoredAttachment,
} from "@min-kb-app/shared";
import {
  attachmentUploadSchema,
  copilotCustomAgentSchema,
  DEFAULT_CHAT_MODEL,
  orchestratorJobSchema,
  orchestratorSessionSchema,
  orchestratorSessionSummarySchema,
  premiumUsageTotalsSchema,
  storedAttachmentSchema,
} from "@min-kb-app/shared";
import matter from "gray-matter";
import { sessionIdFromTitle } from "./sessions.js";
import {
  compactTimestamp,
  ensureTrailingNewline,
  normalizeAgentId,
  pathExists,
  readOptionalFile,
  slugify,
  toPosixRelative,
  walkFiles,
} from "./utils.js";
import type { MinKbWorkspace } from "./workspace.js";

export const ORCHESTRATOR_AGENT_ID = "copilot-orchestrator";

const ORCHESTRATOR_STATE_FILENAME = "ORCHESTRATOR.json";
const ORCHESTRATOR_JOB_FILENAME = "JOB.json";
const ORCHESTRATOR_JOB_DONE_FILENAME = "DONE.json";
const ORCHESTRATOR_TERMINAL_LOG = "terminal/pane.log";
const ORCHESTRATOR_JOBS_DIRECTORY = "delegations";
const ORCHESTRATOR_SESSION_HEADER = "# Orchestrator Session: ";

interface StoredOrchestratorJobCompletion {
  exitCode: number;
  completedAt: string;
}

const storedOrchestratorSessionStateSchema =
  orchestratorSessionSummarySchema.omit({
    sessionDirectory: true,
    manifestPath: true,
  });

type StoredOrchestratorSessionState = ReturnType<
  typeof storedOrchestratorSessionStateSchema.parse
>;

export interface CreateOrchestratorSessionInput {
  title?: string;
  sessionId?: string;
  startedAt?: string;
  projectPath: string;
  projectPurpose: string;
  model?: string;
  availableCustomAgents?: CopilotCustomAgent[];
  selectedCustomAgentId?: string;
  tmuxSessionName: string;
  tmuxWindowName: string;
  tmuxPaneId: string;
  status?: OrchestratorSession["status"];
}

export interface CreateOrchestratorJobInput {
  promptPreview: string;
  promptMode: OrchestratorJob["promptMode"];
  promptPath?: string;
  attachment?: AttachmentUpload;
  customAgentId?: string;
  premiumUsage?: PremiumUsage;
  submittedAt?: string;
}

export async function listOrchestratorSessions(
  workspace: MinKbWorkspace
): Promise<OrchestratorSessionSummary[]> {
  const historyRoot = orchestratorHistoryRoot(workspace);
  if (!(await pathExists(historyRoot))) {
    return [];
  }

  const stateFiles = (await walkFiles(historyRoot)).filter(
    (filePath) => path.basename(filePath) === ORCHESTRATOR_STATE_FILENAME
  );
  const sessions = await Promise.all(
    stateFiles.map((filePath) =>
      readOrchestratorSessionSummaryFromState(workspace, filePath)
    )
  );
  return sessions.sort((left, right) =>
    right.updatedAt.localeCompare(left.updatedAt)
  );
}

export async function getOrchestratorSession(
  workspace: MinKbWorkspace,
  sessionId: string
): Promise<OrchestratorSession> {
  const statePath = await findOrchestratorStatePath(workspace, sessionId);
  if (!statePath) {
    throw new Error(`Orchestrator session not found: ${sessionId}`);
  }

  const summary = await readOrchestratorSessionSummaryFromState(
    workspace,
    statePath
  );
  const sessionDirectory = path.dirname(statePath);
  const jobs = await listOrchestratorJobs(sessionDirectory);
  const { content, size } = await readTerminalTail(sessionDirectory);

  return orchestratorSessionSchema.parse({
    ...summary,
    jobs,
    terminalTail: content,
    logSize: size,
  });
}

export async function createOrchestratorSession(
  workspace: MinKbWorkspace,
  input: CreateOrchestratorSessionInput
): Promise<OrchestratorSessionSummary> {
  const startedAt = input.startedAt ?? new Date().toISOString();
  const title =
    input.title?.trim() ||
    input.projectPurpose.trim() ||
    path.basename(input.projectPath) ||
    "Orchestrator session";
  const sessionId = input.sessionId ?? sessionIdFromTitle(title, startedAt);
  const existingState = await findOrchestratorStatePath(workspace, sessionId);
  if (existingState) {
    return readOrchestratorSessionSummaryFromState(workspace, existingState);
  }

  const sessionDirectory = resolveOrchestratorSessionDirectory(
    workspace,
    sessionId,
    startedAt
  );
  await fs.mkdir(path.join(sessionDirectory, "terminal"), { recursive: true });
  await fs.mkdir(path.join(sessionDirectory, ORCHESTRATOR_JOBS_DIRECTORY), {
    recursive: true,
  });

  const state: StoredOrchestratorSessionState = {
    sessionId,
    agentId: ORCHESTRATOR_AGENT_ID,
    title,
    startedAt,
    updatedAt: startedAt,
    summary: input.projectPurpose.trim(),
    projectPath: path.resolve(input.projectPath),
    projectPurpose: input.projectPurpose.trim(),
    model: input.model?.trim() || DEFAULT_CHAT_MODEL,
    availableCustomAgents: copilotCustomAgentSchema
      .array()
      .parse(input.availableCustomAgents ?? []),
    selectedCustomAgentId: input.selectedCustomAgentId,
    tmuxSessionName: input.tmuxSessionName,
    tmuxWindowName: input.tmuxWindowName,
    tmuxPaneId: input.tmuxPaneId,
    status: input.status ?? "idle",
    premiumUsage: premiumUsageTotalsSchema.parse({}),
  };

  await writeOrchestratorSessionManifest(sessionDirectory, state);
  await writeOrchestratorSessionState(sessionDirectory, state);
  return readOrchestratorSessionSummaryFromState(
    workspace,
    path.join(sessionDirectory, ORCHESTRATOR_STATE_FILENAME)
  );
}

export async function updateOrchestratorSession(
  workspace: MinKbWorkspace,
  sessionId: string,
  updates: Partial<
    Omit<StoredOrchestratorSessionState, "sessionId" | "agentId">
  >
): Promise<OrchestratorSessionSummary> {
  const statePath = await findOrchestratorStatePath(workspace, sessionId);
  if (!statePath) {
    throw new Error(`Cannot update missing orchestrator session: ${sessionId}`);
  }

  const sessionDirectory = path.dirname(statePath);
  const currentState = await readStoredOrchestratorSessionState(statePath);
  const nextState: StoredOrchestratorSessionState = {
    ...currentState,
    ...updates,
    updatedAt: updates.updatedAt ?? new Date().toISOString(),
  };
  await writeOrchestratorSessionManifest(sessionDirectory, nextState);
  await writeOrchestratorSessionState(sessionDirectory, nextState);
  return readOrchestratorSessionSummaryFromState(workspace, statePath);
}

export async function deleteOrchestratorSession(
  workspace: MinKbWorkspace,
  sessionId: string
): Promise<void> {
  const statePath = await findOrchestratorStatePath(workspace, sessionId);
  if (!statePath) {
    throw new Error(`Cannot delete missing orchestrator session: ${sessionId}`);
  }

  await fs.rm(path.dirname(statePath), { recursive: true, force: true });
}

export async function createOrchestratorJob(
  workspace: MinKbWorkspace,
  sessionId: string,
  input: CreateOrchestratorJobInput
): Promise<OrchestratorJob> {
  const statePath = await findOrchestratorStatePath(workspace, sessionId);
  if (!statePath) {
    throw new Error(`Cannot add a job to missing session: ${sessionId}`);
  }

  const sessionDirectory = path.dirname(statePath);
  const submittedAt = input.submittedAt ?? new Date().toISOString();
  const jobId = `${compactTimestamp(submittedAt)}-${randomUUID().replace(/-/g, "").slice(0, 8)}`;
  const jobDirectory = path.join(
    sessionDirectory,
    ORCHESTRATOR_JOBS_DIRECTORY,
    jobId
  );
  await fs.mkdir(jobDirectory, { recursive: true });
  const attachment = input.attachment
    ? await writeOrchestratorJobAttachment(
        workspace,
        jobDirectory,
        input.attachment
      )
    : undefined;

  const job = orchestratorJobSchema.parse({
    jobId,
    sessionId,
    promptPreview: input.promptPreview,
    promptMode: input.promptMode,
    promptPath: input.promptPath,
    attachment,
    customAgentId: input.customAgentId,
    premiumUsage: input.premiumUsage,
    status: "queued",
    submittedAt,
    jobDirectory,
  });

  await writeOrchestratorJob(jobDirectory, job);
  return job;
}

export async function updateOrchestratorJob(
  workspace: MinKbWorkspace,
  sessionId: string,
  jobId: string,
  updates: Partial<OrchestratorJob>
): Promise<OrchestratorJob> {
  const jobPath = await findOrchestratorJobPath(workspace, sessionId, jobId);
  if (!jobPath) {
    throw new Error(`Cannot update missing job ${jobId} for ${sessionId}`);
  }

  const jobDirectory = path.dirname(jobPath);
  const current = await readStoredOrchestratorJob(jobPath);
  const next = orchestratorJobSchema.parse({
    ...current,
    ...updates,
    jobDirectory,
  });
  await writeOrchestratorJob(jobDirectory, next);
  return next;
}

export async function deleteOrchestratorJob(
  workspace: MinKbWorkspace,
  sessionId: string,
  jobId: string
): Promise<void> {
  const jobPath = await findOrchestratorJobPath(workspace, sessionId, jobId);
  if (!jobPath) {
    throw new Error(`Cannot delete missing job ${jobId} for ${sessionId}`);
  }

  await fs.rm(path.dirname(jobPath), { recursive: true, force: true });
}

export async function writeOrchestratorJobCompletion(
  workspace: MinKbWorkspace,
  sessionId: string,
  jobId: string,
  completion: StoredOrchestratorJobCompletion
): Promise<void> {
  const jobPath = await findOrchestratorJobPath(workspace, sessionId, jobId);
  if (!jobPath) {
    throw new Error(`Cannot finalize missing job ${jobId} for ${sessionId}`);
  }

  const jobDirectory = path.dirname(jobPath);
  await fs.writeFile(
    path.join(jobDirectory, ORCHESTRATOR_JOB_DONE_FILENAME),
    `${JSON.stringify(completion, null, 2)}\n`,
    "utf8"
  );
}

export async function readOrchestratorTerminalChunk(
  workspace: MinKbWorkspace,
  sessionId: string,
  offset: number
): Promise<{ chunk: string; nextOffset: number }> {
  const statePath = await findOrchestratorStatePath(workspace, sessionId);
  if (!statePath) {
    throw new Error(`Orchestrator session not found: ${sessionId}`);
  }

  const logPath = path.join(path.dirname(statePath), ORCHESTRATOR_TERMINAL_LOG);
  const raw = await fs
    .readFile(logPath)
    .catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") {
        return Buffer.alloc(0);
      }
      throw error;
    });
  const nextOffset = raw.length;
  if (offset >= nextOffset) {
    return { chunk: "", nextOffset };
  }

  return {
    chunk: raw.subarray(offset).toString("utf8"),
    nextOffset,
  };
}

export async function getOrchestratorTerminalSize(
  workspace: MinKbWorkspace,
  sessionId: string
): Promise<number> {
  const statePath = await findOrchestratorStatePath(workspace, sessionId);
  if (!statePath) {
    throw new Error(`Orchestrator session not found: ${sessionId}`);
  }

  const logPath = path.join(path.dirname(statePath), ORCHESTRATOR_TERMINAL_LOG);
  try {
    const stat = await fs.stat(logPath);
    return stat.size;
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return 0;
    }
    throw error;
  }
}

export async function resetOrchestratorTerminalLog(
  workspace: MinKbWorkspace,
  sessionId: string
): Promise<void> {
  const statePath = await findOrchestratorStatePath(workspace, sessionId);
  if (!statePath) {
    throw new Error(`Orchestrator session not found: ${sessionId}`);
  }

  const logPath = path.join(path.dirname(statePath), ORCHESTRATOR_TERMINAL_LOG);
  await fs.mkdir(path.dirname(logPath), { recursive: true });
  await fs.writeFile(logPath, "", "utf8");
}

export function toOrchestratorChatSummary(
  session: OrchestratorSessionSummary
): ChatSessionSummary {
  return {
    sessionId: session.sessionId,
    agentId: session.agentId,
    title: session.title,
    startedAt: session.startedAt,
    summary: `${session.projectPurpose} • ${humanizeStatus(session.status)}`,
    manifestPath: session.manifestPath,
    turnCount: 0,
    lastTurnAt: session.updatedAt,
    premiumUsage: session.premiumUsage,
    completionStatus:
      session.status === "completed" || session.status === "failed"
        ? session.status
        : undefined,
  };
}

export function accumulatePremiumUsageTotals(
  current: PremiumUsageTotals | undefined,
  usage: PremiumUsage | undefined
): PremiumUsageTotals | undefined {
  if (!usage) {
    return current;
  }

  const normalizedCurrent = premiumUsageTotalsSchema.parse(current ?? {});
  return premiumUsageTotalsSchema.parse({
    chargedRequestCount: normalizedCurrent.chargedRequestCount + 1,
    premiumRequestUnits:
      normalizedCurrent.premiumRequestUnits + usage.premiumRequestUnits,
    lastRecordedAt: usage.recordedAt,
    lastModel: usage.model,
  });
}

export function orchestratorHistoryRoot(workspace: MinKbWorkspace): string {
  return path.join(
    workspace.agentsRoot,
    normalizeAgentId(ORCHESTRATOR_AGENT_ID),
    "history"
  );
}

export function buildOrchestratorWindowName(
  title: string,
  projectPath: string,
  sessionId: string
): string {
  const baseName = path.basename(projectPath) || "project";
  const suffix = sessionId.slice(-4);
  const label = `${slugify(baseName)}-${slugify(title)}-${suffix}`;
  return label.slice(0, 28);
}

export async function discoverCopilotCustomAgents(
  projectPath: string
): Promise<CopilotCustomAgent[]> {
  const roots = [
    path.join(projectPath, ".github", "agents"),
    path.join(projectPath, "agents"),
  ];
  const agentsById = new Map<string, CopilotCustomAgent>();

  for (const root of roots) {
    const files = (await walkFiles(root)).filter((filePath) =>
      filePath.endsWith(".agent.md")
    );

    for (const filePath of files) {
      const relativePath = toPosixRelative(projectPath, filePath);
      const id = path.basename(filePath, ".agent.md");
      const raw = await fs.readFile(filePath, "utf8");
      const parsed = matter(raw);
      const target = parsed.data.target;
      if (
        typeof target === "string" &&
        target.trim().length > 0 &&
        target !== "github-copilot"
      ) {
        continue;
      }

      const name =
        typeof parsed.data.name === "string" &&
        parsed.data.name.trim().length > 0
          ? parsed.data.name.trim()
          : id;
      const description =
        typeof parsed.data.description === "string"
          ? parsed.data.description.trim()
          : "";
      agentsById.set(
        id,
        copilotCustomAgentSchema.parse({
          id,
          name,
          description,
          path: relativePath,
        })
      );
    }
  }

  return [...agentsById.values()].sort((left, right) =>
    left.name.localeCompare(right.name)
  );
}

async function writeOrchestratorJobAttachment(
  workspace: MinKbWorkspace,
  jobDirectory: string,
  attachment: AttachmentUpload
) {
  const normalized = attachmentUploadSchema.parse(attachment);
  const attachmentDirectory = path.join(jobDirectory, "attachments");
  await fs.mkdir(attachmentDirectory, { recursive: true });

  const normalizedFilename = buildAttachmentFilename(normalized.name);
  const attachmentPath = path.join(attachmentDirectory, normalizedFilename);
  const buffer = Buffer.from(normalized.base64Data, "base64");
  await fs.writeFile(attachmentPath, buffer);

  return storedAttachmentSchema.parse({
    attachmentId: randomUUID().replace(/-/g, ""),
    name: normalized.name,
    contentType: normalized.contentType,
    size: buffer.length,
    mediaType: classifyAttachmentMediaType(normalized.contentType),
    relativePath: toPosixRelative(workspace.storeRoot, attachmentPath),
  });
}

function buildAttachmentFilename(name: string): string {
  const extension = path.extname(name).toLowerCase();
  const stem = path.basename(name, extension);
  const normalizedStem = slugify(stem) || "attachment";
  return `${normalizedStem}${extension}`;
}

function classifyAttachmentMediaType(
  contentType: string
): StoredAttachment["mediaType"] {
  if (contentType.startsWith("image/")) {
    return "image";
  }
  if (
    contentType.startsWith("text/") ||
    contentType.includes("json") ||
    contentType.includes("xml")
  ) {
    return "text";
  }
  return "binary";
}

function resolveOrchestratorSessionDirectory(
  workspace: MinKbWorkspace,
  sessionId: string,
  startedAt: string
): string {
  return path.join(
    orchestratorHistoryRoot(workspace),
    startedAt.slice(0, 7),
    sessionId
  );
}

async function readOrchestratorSessionSummaryFromState(
  workspace: MinKbWorkspace,
  statePath: string
): Promise<OrchestratorSessionSummary> {
  const state = await readStoredOrchestratorSessionState(statePath);
  const sessionDirectory = path.dirname(statePath);
  return orchestratorSessionSummarySchema.parse({
    ...state,
    sessionDirectory,
    manifestPath: toPosixRelative(
      workspace.storeRoot,
      path.join(sessionDirectory, "SESSION.md")
    ),
  });
}

async function readStoredOrchestratorSessionState(
  statePath: string
): Promise<StoredOrchestratorSessionState> {
  const raw = await fs.readFile(statePath, "utf8");
  return storedOrchestratorSessionStateSchema.parse(JSON.parse(raw));
}

async function writeOrchestratorSessionState(
  sessionDirectory: string,
  state: StoredOrchestratorSessionState
): Promise<void> {
  await fs.writeFile(
    path.join(sessionDirectory, ORCHESTRATOR_STATE_FILENAME),
    `${JSON.stringify(state, null, 2)}\n`,
    "utf8"
  );
}

async function writeOrchestratorSessionManifest(
  sessionDirectory: string,
  state: StoredOrchestratorSessionState
): Promise<void> {
  const manifest = [
    `${ORCHESTRATOR_SESSION_HEADER}${state.title}`,
    `Session ID: ${state.sessionId}`,
    `Agent: ${state.agentId}`,
    `Started: ${state.startedAt}`,
    `Project Path: ${state.projectPath}`,
    `Project Purpose: ${state.projectPurpose}`,
    `Model: ${state.model}`,
    `Selected Custom Agent: ${state.selectedCustomAgentId ?? "none"}`,
    `Available Custom Agents: ${state.availableCustomAgents.length}`,
    `Tmux Session: ${state.tmuxSessionName}`,
    `Tmux Window: ${state.tmuxWindowName}`,
    `Tmux Pane: ${state.tmuxPaneId}`,
    "",
    "## Summary",
    "",
    state.summary || state.projectPurpose,
    "",
    "## Copilot Custom Agents",
    "",
    state.availableCustomAgents.length > 0
      ? state.availableCustomAgents
          .map((agent) => {
            const selected =
              agent.id === state.selectedCustomAgentId ? " (selected)" : "";
            const description = agent.description
              ? ` - ${agent.description}`
              : "";
            return `- ${agent.id}${selected} — ${agent.path}${description}`;
          })
          .join("\n")
      : "No Copilot custom agents were discovered in the project path.",
  ].join("\n");
  await fs.writeFile(
    path.join(sessionDirectory, "SESSION.md"),
    ensureTrailingNewline(manifest),
    "utf8"
  );
}

async function listOrchestratorJobs(
  sessionDirectory: string
): Promise<OrchestratorJob[]> {
  const jobsRoot = path.join(sessionDirectory, ORCHESTRATOR_JOBS_DIRECTORY);
  if (!(await pathExists(jobsRoot))) {
    return [];
  }

  const jobFiles = (await walkFiles(jobsRoot)).filter(
    (filePath) => path.basename(filePath) === ORCHESTRATOR_JOB_FILENAME
  );
  const jobs = await Promise.all(
    jobFiles.map((filePath) => readOrchestratorJob(filePath))
  );
  return jobs.sort((left, right) =>
    right.submittedAt.localeCompare(left.submittedAt)
  );
}

async function readOrchestratorJob(jobPath: string): Promise<OrchestratorJob> {
  const jobDirectory = path.dirname(jobPath);
  const stored = await readStoredOrchestratorJob(jobPath);
  const completion = await readOrchestratorJobCompletion(jobDirectory);
  if (!completion) {
    return orchestratorJobSchema.parse({
      ...stored,
      jobDirectory,
    });
  }

  return orchestratorJobSchema.parse({
    ...stored,
    jobDirectory,
    status: completion.exitCode === 0 ? "completed" : "failed",
    completedAt: completion.completedAt,
    exitCode: completion.exitCode,
  });
}

async function readStoredOrchestratorJob(
  jobPath: string
): Promise<OrchestratorJob> {
  const raw = await fs.readFile(jobPath, "utf8");
  return JSON.parse(raw) as OrchestratorJob;
}

async function writeOrchestratorJob(
  jobDirectory: string,
  job: OrchestratorJob
): Promise<void> {
  await fs.writeFile(
    path.join(jobDirectory, ORCHESTRATOR_JOB_FILENAME),
    `${JSON.stringify(job, null, 2)}\n`,
    "utf8"
  );
}

async function readOrchestratorJobCompletion(
  jobDirectory: string
): Promise<StoredOrchestratorJobCompletion | undefined> {
  const raw = await readOptionalFile(
    path.join(jobDirectory, ORCHESTRATOR_JOB_DONE_FILENAME)
  );
  if (!raw) {
    return undefined;
  }
  return JSON.parse(raw) as StoredOrchestratorJobCompletion;
}

async function readTerminalTail(
  sessionDirectory: string,
  maxBytes = 64_000
): Promise<{ content: string; size: number }> {
  const logPath = path.join(sessionDirectory, ORCHESTRATOR_TERMINAL_LOG);
  try {
    const raw = await fs.readFile(logPath);
    return {
      content: raw
        .subarray(Math.max(0, raw.length - maxBytes))
        .toString("utf8"),
      size: raw.length,
    };
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return { content: "", size: 0 };
    }
    throw error;
  }
}

async function findOrchestratorStatePath(
  workspace: MinKbWorkspace,
  sessionId: string
): Promise<string | undefined> {
  const historyRoot = orchestratorHistoryRoot(workspace);
  if (!(await pathExists(historyRoot))) {
    return undefined;
  }

  const stateFiles = (await walkFiles(historyRoot)).filter((filePath) =>
    filePath.endsWith(
      `${path.sep}${sessionId}${path.sep}${ORCHESTRATOR_STATE_FILENAME}`
    )
  );
  if (stateFiles.length > 1) {
    throw new Error(`Multiple orchestrator sessions matched ${sessionId}.`);
  }
  return stateFiles[0];
}

async function findOrchestratorJobPath(
  workspace: MinKbWorkspace,
  sessionId: string,
  jobId: string
): Promise<string | undefined> {
  const statePath = await findOrchestratorStatePath(workspace, sessionId);
  if (!statePath) {
    return undefined;
  }

  const jobPath = path.join(
    path.dirname(statePath),
    ORCHESTRATOR_JOBS_DIRECTORY,
    jobId,
    ORCHESTRATOR_JOB_FILENAME
  );
  return (await pathExists(jobPath)) ? jobPath : undefined;
}

function humanizeStatus(status: OrchestratorSessionStatus): string {
  switch (status) {
    case "idle":
      return "Idle";
    case "running":
      return "Running";
    case "completed":
      return "Completed";
    case "failed":
      return "Failed";
    case "missing":
      return "Missing";
  }

  const unreachableStatus: never = status;
  return unreachableStatus;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error;
}
