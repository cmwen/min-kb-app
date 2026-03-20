import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import type {
  ChatSessionSummary,
  OrchestratorJob,
  OrchestratorSession,
  OrchestratorSessionStatus,
  OrchestratorSessionSummary,
} from "@min-kb-app/shared";
import {
  DEFAULT_CHAT_MODEL,
  orchestratorJobSchema,
  orchestratorSessionSchema,
  orchestratorSessionSummarySchema,
} from "@min-kb-app/shared";
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
  tmuxSessionName: string;
  tmuxWindowName: string;
  tmuxPaneId: string;
  status?: OrchestratorSession["status"];
}

export interface CreateOrchestratorJobInput {
  promptPreview: string;
  promptMode: OrchestratorJob["promptMode"];
  promptPath?: string;
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
    tmuxSessionName: input.tmuxSessionName,
    tmuxWindowName: input.tmuxWindowName,
    tmuxPaneId: input.tmuxPaneId,
    status: input.status ?? "idle",
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

  const job = orchestratorJobSchema.parse({
    jobId,
    sessionId,
    promptPreview: input.promptPreview,
    promptMode: input.promptMode,
    promptPath: input.promptPath,
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
  };
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
    `Tmux Session: ${state.tmuxSessionName}`,
    `Tmux Window: ${state.tmuxWindowName}`,
    `Tmux Pane: ${state.tmuxPaneId}`,
    "",
    "## Summary",
    "",
    state.summary || state.projectPurpose,
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
