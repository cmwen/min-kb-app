import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { type HttpBindings, serve } from "@hono/node-server";
import { RESPONSE_ALREADY_SENT } from "@hono/node-server/utils/response";
import { ChatRuntimeService } from "@min-kb-app/copilot-runtime";
import {
  deleteSession as deleteChatSession,
  getAgentById,
  getSession,
  listAgents,
  listMemoryEntries,
  listSessions,
  listSkillsForAgent,
  ORCHESTRATOR_AGENT_ID,
  recordSessionLlmUsage,
  resolveWorkspace,
  saveChatTurn,
  sessionIdFromTitle,
  summarizeWorkspace,
} from "@min-kb-app/min-kb-store";
import type {
  ChatRequest,
  ChatResponse,
  MemoryAnalysisEntryChange,
  MemoryAnalysisRequest,
  MemoryEntry,
  MemoryTier,
  OrchestratorDelegateRequest,
  OrchestratorScheduleCreateRequest,
  OrchestratorScheduleUpdateRequest,
  OrchestratorSession,
  OrchestratorSessionCreateRequest,
  OrchestratorSessionUpdateRequest,
  OrchestratorTerminalInputRequest,
  WorkspaceSummary,
} from "@min-kb-app/shared";
import {
  chatRequestSchema,
  createDefaultChatRuntimeConfig,
  memoryAnalysisRequestSchema,
  mergeChatRuntimeConfigs,
  orchestratorDelegateRequestSchema,
  orchestratorScheduleCreateSchema,
  orchestratorScheduleUpdateSchema,
  orchestratorSessionCreateSchema,
  orchestratorSessionUpdateSchema,
  orchestratorTerminalInputSchema,
} from "@min-kb-app/shared";
import { type Context, Hono } from "hono";
import { getHttpErrorMessage, getHttpErrorStatus } from "./http-errors.js";
import {
  buildMemoryAnalysisPrompt,
  buildMemoryAnalysisRuntimeConfig,
  isMemorySkillName,
  parseMemoryAnalysisMarkdown,
  resolveMemoryAnalysisModel,
  TmuxOrchestratorService,
} from "./orchestrator.js";
import { computeNextRunAt, OrchestratorScheduleService } from "./scheduler.js";

const workspace = await resolveWorkspace();
const defaultProjectPath = process.cwd();
const collidingAgent = await getAgentById(workspace, ORCHESTRATOR_AGENT_ID);
if (collidingAgent) {
  throw new Error(
    `Reserved built-in agent id ${ORCHESTRATOR_AGENT_ID} already exists in min-kb-store.`
  );
}

const runtime = new ChatRuntimeService(workspace);
const orchestrator = new TmuxOrchestratorService(
  workspace,
  defaultProjectPath,
  undefined,
  async (modelId) => {
    const models = await runtime.listModels();
    return models.find((model) => model.id === modelId);
  }
);
const scheduleService = new OrchestratorScheduleService(
  workspace,
  orchestrator
);
const app = new Hono<{ Bindings: HttpBindings }>();
const port = Number(process.env.MIN_KB_APP_PORT ?? 8787);
const runtimeDir = path.dirname(fileURLToPath(import.meta.url));
const webDistRoot = path.resolve(runtimeDir, "../../web/dist");
const webDistIndex = path.join(webDistRoot, "index.html");
const ORCHESTRATOR_TERMINAL_PAGE_LINE_LIMIT = 2_000;

app.onError((error, context) => {
  const status = getHttpErrorStatus(error);
  const log = status >= 500 ? console.error : console.warn;
  log(error);
  return context.json({ error: getHttpErrorMessage(error) }, status);
});

app.get("/api/health", async (context) => {
  const summary: WorkspaceSummary = await summarizeWorkspace(workspace);
  return context.json({ ok: true, workspace: summary });
});

app.get("/api/workspace", async (context) => {
  return context.json(await summarizeWorkspace(workspace));
});

app.get("/api/models", async (context) => {
  return context.json(await runtime.listModelCatalog());
});

app.get("/api/agents", async (context) => {
  return context.json([
    await orchestrator.getAgentSummary(),
    ...(await listAgents(workspace)),
  ]);
});

app.get("/api/agents/:agentId", async (context) => {
  const agentId = context.req.param("agentId");
  if (agentId === ORCHESTRATOR_AGENT_ID) {
    return context.json(await orchestrator.getAgentSummary());
  }

  const agent = await getAgentById(workspace, agentId);
  if (!agent) {
    return context.json({ error: "Agent not found." }, 404);
  }
  return context.json(agent);
});

app.get("/api/agents/:agentId/skills", async (context) => {
  const agentId = context.req.param("agentId");
  if (agentId === ORCHESTRATOR_AGENT_ID) {
    return context.json([]);
  }

  return context.json(await listSkillsForAgent(workspace, agentId));
});

app.get("/api/agents/:agentId/sessions", async (context) => {
  const agentId = context.req.param("agentId");
  if (agentId === ORCHESTRATOR_AGENT_ID) {
    return context.json(await orchestrator.listChatSummaries());
  }

  return context.json(await listSessions(workspace, agentId));
});

app.get("/api/agents/:agentId/sessions/:sessionId", async (context) => {
  const agentId = context.req.param("agentId");
  const sessionId = context.req.param("sessionId");
  if (agentId === ORCHESTRATOR_AGENT_ID) {
    return context.json(await orchestrator.getSession(sessionId));
  }

  return context.json(await getSession(workspace, agentId, sessionId));
});

app.get(
  "/api/agents/:agentId/sessions/:sessionId/attachments/:attachmentId",
  async (context) => {
    const agentId = context.req.param("agentId");
    const sessionId = context.req.param("sessionId");
    const attachmentId = context.req.param("attachmentId");
    const thread = await getSession(workspace, agentId, sessionId);
    const attachment = thread.turns
      .map((turn) => turn.attachment)
      .find((candidate) => candidate?.attachmentId === attachmentId);
    if (!attachment) {
      return context.json({ error: "Attachment not found." }, 404);
    }

    const attachmentPath = path.join(
      workspace.storeRoot,
      attachment.relativePath
    );
    const content = await fs.readFile(attachmentPath);
    return new Response(content, {
      headers: {
        "cache-control": "no-store",
        "content-disposition": `${
          attachment.mediaType === "image" ? "inline" : "attachment"
        }; filename="${attachment.name.replaceAll('"', "")}"`,
        "content-type": attachment.contentType,
      },
    });
  }
);

app.delete("/api/agents/:agentId/sessions/:sessionId", async (context) => {
  const agentId = context.req.param("agentId");
  const sessionId = context.req.param("sessionId");
  if (agentId === ORCHESTRATOR_AGENT_ID) {
    await orchestrator.deleteSession(sessionId);
    return context.json({ ok: true });
  }

  await deleteChatSession(workspace, agentId, sessionId);
  return context.json({ ok: true });
});

app.post(
  "/api/agents/:agentId/sessions/:sessionId/analyze-for-memory",
  async (context) => {
    const request = memoryAnalysisRequestSchema.parse(
      ((await readOptionalJson(context)) ?? {}) satisfies MemoryAnalysisRequest
    );
    return context.json(
      await runMemoryAnalysisFlow(
        context.req.param("agentId"),
        context.req.param("sessionId"),
        request
      )
    );
  }
);

app.get("/api/memory", async (context) => {
  const agentId = context.req.query("agentId");
  return context.json(await listMemoryEntries(workspace, { agentId }));
});

app.post("/api/agents/:agentId/sessions", async (context) => {
  const agentId = context.req.param("agentId");
  if (agentId === ORCHESTRATOR_AGENT_ID) {
    return context.json(
      {
        error:
          "Use the dedicated orchestrator session endpoint for the built-in orchestrator agent.",
      },
      400
    );
  }

  const request = chatRequestSchema.parse(
    (await context.req.json()) satisfies ChatRequest
  );
  return context.json(await runChatFlow(agentId, request, request.sessionId));
});

app.post(
  "/api/agents/:agentId/sessions/:sessionId/messages",
  async (context) => {
    const agentId = context.req.param("agentId");
    if (agentId === ORCHESTRATOR_AGENT_ID) {
      return context.json(
        {
          error:
            "Use the dedicated orchestrator job endpoint for the built-in orchestrator agent.",
        },
        400
      );
    }

    const request = chatRequestSchema.parse(
      (await context.req.json()) satisfies ChatRequest
    );
    return context.json(
      await runChatFlow(agentId, request, context.req.param("sessionId"))
    );
  }
);

app.get("/api/orchestrator/capabilities", async (context) => {
  return context.json(await orchestrator.getCapabilities());
});

app.get("/api/orchestrator/sessions", async (context) => {
  return context.json(await orchestrator.listSessions());
});

app.post("/api/orchestrator/sessions", async (context) => {
  const request = orchestratorSessionCreateSchema.parse(
    (await context.req.json()) satisfies OrchestratorSessionCreateRequest
  );
  return context.json(await orchestrator.createSession(request));
});

app.get("/api/orchestrator/sessions/:sessionId", async (context) => {
  return context.json(
    await orchestrator.getSession(context.req.param("sessionId"))
  );
});

app.get("/api/orchestrator/sessions/:sessionId/terminal", async (context) => {
  const sessionId = context.req.param("sessionId");
  const requestedBefore = Number.parseInt(
    context.req.query("before") ?? Number.MAX_SAFE_INTEGER.toString(),
    10
  );
  const beforeOffset =
    Number.isFinite(requestedBefore) && requestedBefore >= 0
      ? requestedBefore
      : Number.MAX_SAFE_INTEGER;
  const requestedMaxLines = Number.parseInt(
    context.req.query("maxLines") ??
      ORCHESTRATOR_TERMINAL_PAGE_LINE_LIMIT.toString(),
    10
  );
  const maxLines =
    Number.isFinite(requestedMaxLines) && requestedMaxLines > 0
      ? Math.min(requestedMaxLines, ORCHESTRATOR_TERMINAL_PAGE_LINE_LIMIT)
      : ORCHESTRATOR_TERMINAL_PAGE_LINE_LIMIT;

  return context.json(
    await orchestrator.readTerminalHistoryChunk(sessionId, beforeOffset, maxLines)
  );
});

app.patch("/api/orchestrator/sessions/:sessionId", async (context) => {
  const request = orchestratorSessionUpdateSchema.parse(
    (await context.req.json()) satisfies OrchestratorSessionUpdateRequest
  );
  return context.json(
    await orchestrator.updateSession(context.req.param("sessionId"), request)
  );
});

app.post("/api/orchestrator/sessions/:sessionId/jobs", async (context) => {
  const request = orchestratorDelegateRequestSchema.parse(
    (await context.req.json()) satisfies OrchestratorDelegateRequest
  );
  return context.json(
    await orchestrator.delegate(context.req.param("sessionId"), request)
  );
});

app.post("/api/orchestrator/sessions/:sessionId/input", async (context) => {
  const request = orchestratorTerminalInputSchema.parse(
    (await context.req.json()) satisfies OrchestratorTerminalInputRequest
  );
  return context.json(
    await orchestrator.sendInput(
      context.req.param("sessionId"),
      request.input,
      request.submit
    )
  );
});

app.post("/api/orchestrator/sessions/:sessionId/cancel", async (context) => {
  return context.json(
    await orchestrator.cancelJob(context.req.param("sessionId"))
  );
});

app.post("/api/orchestrator/sessions/:sessionId/restart", async (context) => {
  return context.json(
    await orchestrator.restartSession(context.req.param("sessionId"))
  );
});

app.delete(
  "/api/orchestrator/sessions/:sessionId/jobs/:jobId",
  async (context) => {
    return context.json(
      await orchestrator.deleteQueuedJob(
        context.req.param("sessionId"),
        context.req.param("jobId")
      )
    );
  }
);

app.get("/api/orchestrator/schedules", async (context) => {
  const sessionId = context.req.query("sessionId") ?? undefined;
  return context.json(await orchestrator.listSchedules(sessionId));
});

app.post("/api/orchestrator/schedules", async (context) => {
  const request = orchestratorScheduleCreateSchema.parse(
    (await context.req.json()) satisfies OrchestratorScheduleCreateRequest
  );
  return context.json(
    await orchestrator.createSchedule(request, computeNextRunAt(request))
  );
});

app.patch("/api/orchestrator/schedules/:scheduleId", async (context) => {
  const request = orchestratorScheduleUpdateSchema.parse(
    (await context.req.json()) satisfies OrchestratorScheduleUpdateRequest
  );
  return context.json(
    await orchestrator.updateSchedule(
      context.req.param("scheduleId"),
      request,
      computeNextRunAt(request)
    )
  );
});

app.delete("/api/orchestrator/schedules/:scheduleId", async (context) => {
  await orchestrator.deleteSchedule(context.req.param("scheduleId"));
  return context.json({ ok: true });
});

app.get("/api/orchestrator/sessions/:sessionId/stream", async (context) => {
  return streamOrchestratorTerminal(context, context.req.param("sessionId"));
});

app.get("/", async (context) => serveWebRequest(context, "/"));
app.get("/*", async (context) => serveWebRequest(context, context.req.path));

serve({ fetch: app.fetch, port });
scheduleService.start();
console.log(`min-kb-app runtime listening on http://localhost:${port}`);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, async () => {
    scheduleService.stop();
    await runtime.stop();
    process.exit(0);
  });
}

async function runChatFlow(
  agentId: string,
  request: ChatRequest,
  forcedSessionId?: string
): Promise<ChatResponse> {
  if (!request.prompt.trim() && !request.attachment) {
    throw new Error("Provide a prompt or attach a file before sending.");
  }
  const createdAt = new Date().toISOString();
  const title =
    request.title ??
    createSessionTitle(request.prompt, request.attachment?.name);
  const sessionId =
    forcedSessionId ??
    request.sessionId ??
    sessionIdFromTitle(title, createdAt);
  const agent = await getAgentById(workspace, agentId);
  const runtimeConfig = mergeChatRuntimeConfigs(
    agent?.runtimeConfig ?? createDefaultChatRuntimeConfig(),
    request.config
  );
  const userThread = await saveChatTurn(workspace, {
    agentId,
    sessionId,
    title,
    sender: "user",
    bodyMarkdown: buildUserTurnMarkdown(
      request.prompt,
      request.attachment?.name
    ),
    createdAt,
    runtimeConfig,
    attachment: request.attachment,
  });
  const userTurn = userThread.turns.at(-1);
  const prompt = buildPromptWithAttachmentContext(
    workspace.storeRoot,
    request.prompt,
    userTurn?.attachment
  );

  const runtimeResult = await runtime.sendMessage({
    agentId,
    sessionId,
    prompt,
    config: runtimeConfig,
    conversation: userThread.turns.slice(0, -1).map((turn) => ({
      sender: turn.sender,
      bodyMarkdown: turn.bodyMarkdown,
    })),
  });

  const summary =
    userThread.turnCount <= 1
      ? buildSummary(title, request.prompt, request.attachment?.name)
      : undefined;
  const updatedThread = await saveChatTurn(workspace, {
    agentId,
    sessionId,
    title,
    sender: "assistant",
    bodyMarkdown: runtimeResult.assistantText,
    createdAt: new Date().toISOString(),
    summary,
    runtimeConfig,
  });
  if (runtimeResult.llmStats) {
    await recordSessionLlmUsage(
      workspace,
      agentId,
      sessionId,
      runtimeResult.llmStats
    );
  }

  const assistantTurn = updatedThread.turns.at(-1);
  if (!assistantTurn) {
    throw new Error("Assistant turn was not persisted.");
  }

  return {
    thread: updatedThread,
    assistantTurn,
  };
}

async function runMemoryAnalysisFlow(
  agentId: string,
  sessionId: string,
  request: MemoryAnalysisRequest
) {
  if (agentId === ORCHESTRATOR_AGENT_ID) {
    throw new Error("Memory analysis only applies to chat agents.");
  }

  const thread = await getSession(workspace, agentId, sessionId);
  if (thread.turns.length === 0) {
    throw new Error("Nothing to analyze yet for this session.");
  }

  const skills = await listSkillsForAgent(workspace, agentId);
  const availableSkillNames = skills.map((skill) => skill.name);
  const memorySkillNames = availableSkillNames.filter((skillName) =>
    isMemorySkillName(skillName)
  );
  const baseConfig = thread.runtimeConfig ?? request.config ?? undefined;
  const model = resolveMemoryAnalysisModel(request.model);
  const analysisConfig = buildMemoryAnalysisRuntimeConfig({
    availableSkillNames,
    baseConfig,
    model,
  });
  const memoryEntriesBefore = await listMemoryEntries(workspace, { agentId });

  const result = await runtime.sendMessage({
    agentId,
    sessionId: `${sessionId}-memory-${Date.now()}`,
    prompt: buildMemoryAnalysisPrompt(thread, memorySkillNames),
    config: analysisConfig,
  });
  const memoryEntriesAfter = await listMemoryEntries(workspace, { agentId });
  const analysisByTier = parseMemoryAnalysisMarkdown(result.assistantText);

  return {
    markdown: result.assistantText,
    model,
    configuredMemorySkillNames: memorySkillNames,
    enabledSkillNames:
      result.sessionDiagnostics?.loadedSkills
        .filter((skill) => skill.enabled)
        .map((skill) => skill.name) ?? [],
    loadedSkillNames:
      result.sessionDiagnostics?.loadedSkills.map((skill) => skill.name) ?? [],
    invokedSkillNames: result.sessionDiagnostics?.invokedSkills ?? [],
    toolExecutions: result.sessionDiagnostics?.toolExecutions ?? [],
    reportedLoadedSkills:
      result.sessionDiagnostics?.reportedLoadedSkills ?? false,
    analysisByTier,
    memoryChanges: summarizeMemoryChanges(
      memoryEntriesBefore,
      memoryEntriesAfter
    ),
  };
}

function createSessionTitle(prompt: string, attachmentName?: string): string {
  const words = prompt.trim().split(/\s+/).filter(Boolean).slice(0, 6);
  if (words.length > 0) {
    return words.join(" ");
  }
  if (attachmentName) {
    return `Attachment ${attachmentName}`;
  }
  return "New session";
}

function buildSummary(
  title: string,
  prompt: string,
  attachmentName?: string
): string {
  const normalizedPrompt = prompt.trim().replace(/\s+/g, " ");
  const titleWordCount = title.trim().split(/\s+/).filter(Boolean).length;
  const remainder = normalizedPrompt
    .split(/\s+/)
    .slice(titleWordCount)
    .join(" ");
  return (
    remainder.slice(0, 120) ||
    (attachmentName
      ? `Started from the attached file ${attachmentName}.`
      : "Started from the initial prompt.")
  );
}

function buildUserTurnMarkdown(
  prompt: string,
  attachmentName?: string
): string {
  const trimmedPrompt = prompt.trim();
  if (!attachmentName) {
    return trimmedPrompt;
  }
  if (!trimmedPrompt) {
    return `Attached file: \`${attachmentName}\``;
  }
  return `${trimmedPrompt}\n\nAttached file: \`${attachmentName}\``;
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
  const userPrompt =
    trimmedPrompt ||
    "Inspect the attached file and help the user with the next relevant step.";

  return [
    "The user attached a file to this request.",
    `Attachment name: ${attachment.name}`,
    `Attachment type: ${attachment.contentType}`,
    `Attachment size: ${attachment.size} bytes`,
    `Attachment path: ${attachmentPath}`,
    "Use the attachment as part of your response. If you need the file contents, inspect it from disk using the available tools.",
    "",
    "User request:",
    userPrompt,
  ].join("\n");
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

function summarizeMemoryChanges(
  before: MemoryEntry[],
  after: MemoryEntry[]
): {
  working: MemoryAnalysisEntryChange[];
  shortTerm: MemoryAnalysisEntryChange[];
  longTerm: MemoryAnalysisEntryChange[];
} {
  const byPathBefore = new Map(before.map((entry) => [entry.path, entry]));
  const changes = {
    working: [] as MemoryAnalysisEntryChange[],
    shortTerm: [] as MemoryAnalysisEntryChange[],
    longTerm: [] as MemoryAnalysisEntryChange[],
  };

  for (const entry of after) {
    const tier = classifyMemoryTier(entry);
    if (!tier) {
      continue;
    }

    const previous = byPathBefore.get(entry.path);
    if (!previous) {
      changes[tierKey(tier)].push(buildMemoryChange(entry, tier, "added"));
      continue;
    }

    if (
      previous.updatedAt !== entry.updatedAt ||
      previous.title !== entry.title ||
      previous.id !== entry.id
    ) {
      changes[tierKey(tier)].push(buildMemoryChange(entry, tier, "updated"));
    }
  }

  return changes;
}

function buildMemoryChange(
  entry: MemoryEntry,
  tier: MemoryTier,
  status: "added" | "updated"
): MemoryAnalysisEntryChange {
  return {
    id: entry.id,
    title: entry.title,
    path: entry.path,
    status,
    tier,
    updatedAt: entry.updatedAt,
  };
}

function classifyMemoryTier(entry: MemoryEntry): MemoryTier | undefined {
  const normalizedPath = entry.path.replaceAll("\\", "/");
  if (normalizedPath.includes("/memory/working/")) {
    return "working";
  }
  if (normalizedPath.includes("/memory/shared/short-term/")) {
    return "short-term";
  }
  if (normalizedPath.includes("/memory/shared/long-term/")) {
    return "long-term";
  }
  return undefined;
}

function tierKey(tier: MemoryTier): "working" | "shortTerm" | "longTerm" {
  if (tier === "working") {
    return "working";
  }
  if (tier === "short-term") {
    return "shortTerm";
  }
  return "longTerm";
}

async function streamOrchestratorTerminal(
  context: Context<{ Bindings: HttpBindings }>,
  sessionId: string
) {
  const initialSession = await orchestrator.getSession(sessionId);
  const { incoming, outgoing } = context.env;
  let closed = false;
  let busy = false;
  let offset = Number.parseInt(context.req.query("offset") ?? "0", 10);
  if (!Number.isFinite(offset) || offset < 0) {
    offset = 0;
  }
  let lastSessionSignal = buildSessionSignal(initialSession);

  const sendEvent = (event: string, data: unknown) => {
    if (closed) {
      return;
    }
    outgoing.write(`event: ${event}\n`);
    outgoing.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  outgoing.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
  });
  outgoing.write("retry: 1000\n\n");

  sendEvent("session", initialSession);
  if (offset === 0 && initialSession.terminalTail) {
    offset = Math.max(
      0,
      initialSession.logSize - Buffer.byteLength(initialSession.terminalTail)
    );
    sendEvent("output", {
      chunk: initialSession.terminalTail,
      nextOffset: initialSession.logSize,
    });
  }

  const tick = async () => {
    if (closed || busy) {
      return;
    }
    busy = true;
    try {
      const chunk = await orchestrator.readTerminalChunk(sessionId, offset);
      if (chunk.chunk) {
        offset = chunk.nextOffset;
        sendEvent("output", chunk);
      }

      const session = await orchestrator.getSession(sessionId);
      const nextSessionSignal = buildSessionSignal(session);
      if (nextSessionSignal !== lastSessionSignal) {
        lastSessionSignal = nextSessionSignal;
        sendEvent("session", session);
      }

      sendEvent("heartbeat", {
        offset,
        status: session.status,
      });
    } catch (error) {
      sendEvent("error", {
        message:
          error instanceof Error ? error.message : "Unknown stream error",
      });
      cleanup();
    } finally {
      busy = false;
    }
  };

  const interval = setInterval(() => {
    void tick();
  }, 1000);

  const cleanup = () => {
    if (closed) {
      return;
    }
    closed = true;
    clearInterval(interval);
    outgoing.end();
  };

  incoming.on("close", cleanup);
  return RESPONSE_ALREADY_SENT;
}

function buildSessionSignal(
  session: Pick<
    OrchestratorSession,
    "updatedAt" | "status" | "activeJobId" | "lastJobId"
  >
): string {
  return JSON.stringify({
    updatedAt: session.updatedAt,
    status: session.status,
    activeJobId: session.activeJobId,
    lastJobId: session.lastJobId,
  });
}

async function serveWebRequest(
  context: Context<{ Bindings: HttpBindings }>,
  requestPath: string
) {
  if (requestPath.startsWith("/api/")) {
    return context.notFound();
  }

  const assetPath = resolveWebAssetPath(requestPath);
  if (assetPath) {
    try {
      return await serveWebFile(context, assetPath);
    } catch (error) {
      if (!isNodeError(error) || error.code !== "ENOENT") {
        throw error;
      }

      if (path.extname(requestPath)) {
        return context.notFound();
      }
    }
  }

  try {
    return await serveWebFile(context, webDistIndex);
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return context.json({
        name: "min-kb-app runtime",
        message:
          "Run the web app separately with `pnpm dev:web` or `pnpm --filter @min-kb-app/web preview`.",
      });
    }

    throw error;
  }
}

function resolveWebAssetPath(requestPath: string): string | undefined {
  const normalizedPath =
    requestPath === "/" ? "/index.html" : path.posix.normalize(requestPath);
  const resolvedPath = path.resolve(webDistRoot, `.${normalizedPath}`);
  return resolvedPath.startsWith(webDistRoot) ? resolvedPath : undefined;
}

async function serveWebFile(
  context: Context<{ Bindings: HttpBindings }>,
  filePath: string
) {
  const body = await fs.readFile(filePath);
  return context.body(body, 200, {
    "content-type": getContentType(filePath),
  });
}

function getContentType(filePath: string): string {
  switch (path.extname(filePath)) {
    case ".css":
      return "text/css; charset=utf-8";
    case ".html":
      return "text/html; charset=utf-8";
    case ".ico":
      return "image/x-icon";
    case ".js":
      return "text/javascript; charset=utf-8";
    case ".json":
      return "application/json; charset=utf-8";
    case ".png":
      return "image/png";
    case ".svg":
      return "image/svg+xml";
    case ".webmanifest":
      return "application/manifest+json; charset=utf-8";
    default:
      return "application/octet-stream";
  }
}

async function readOptionalJson(context: Context<{ Bindings: HttpBindings }>) {
  try {
    return (await context.req.json()) as Record<string, unknown>;
  } catch (error) {
    if (error instanceof SyntaxError) {
      return undefined;
    }
    throw error;
  }
}
