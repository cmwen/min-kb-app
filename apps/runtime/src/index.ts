import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { type HttpBindings, serve } from "@hono/node-server";
import { RESPONSE_ALREADY_SENT } from "@hono/node-server/utils/response";
import { CopilotRuntimeService } from "@min-kb-app/copilot-runtime";
import {
  getAgentById,
  getSession,
  listAgents,
  listMemoryEntries,
  listSessions,
  listSkillsForAgent,
  ORCHESTRATOR_AGENT_ID,
  resolveWorkspace,
  saveChatTurn,
  sessionIdFromTitle,
  summarizeWorkspace,
} from "@min-kb-app/min-kb-store";
import type {
  ChatRequest,
  ChatResponse,
  MemoryAnalysisRequest,
  OrchestratorDelegateRequest,
  OrchestratorSession,
  OrchestratorSessionCreateRequest,
  OrchestratorSessionUpdateRequest,
  OrchestratorTerminalInputRequest,
  WorkspaceSummary,
} from "@min-kb-app/shared";
import {
  chatRequestSchema,
  memoryAnalysisRequestSchema,
  orchestratorDelegateRequestSchema,
  orchestratorSessionCreateSchema,
  orchestratorSessionUpdateSchema,
  orchestratorTerminalInputSchema,
} from "@min-kb-app/shared";
import { type Context, Hono } from "hono";
import {
  buildMemoryAnalysisPrompt,
  isMemorySkillName,
  TmuxOrchestratorService,
} from "./orchestrator.js";

const workspace = await resolveWorkspace();
const defaultProjectPath = process.cwd();
const collidingAgent = await getAgentById(workspace, ORCHESTRATOR_AGENT_ID);
if (collidingAgent) {
  throw new Error(
    `Reserved built-in agent id ${ORCHESTRATOR_AGENT_ID} already exists in min-kb-store.`
  );
}

const runtime = new CopilotRuntimeService(workspace);
const orchestrator = new TmuxOrchestratorService(workspace, defaultProjectPath);
const app = new Hono<{ Bindings: HttpBindings }>();
const port = Number(process.env.MIN_KB_APP_PORT ?? 8787);
const runtimeDir = path.dirname(fileURLToPath(import.meta.url));
const webDistRoot = path.resolve(runtimeDir, "../../web/dist");
const webDistIndex = path.join(webDistRoot, "index.html");

app.onError((error, context) => {
  console.error(error);
  return context.json({ error: error.message }, 500);
});

app.get("/api/health", async (context) => {
  const summary: WorkspaceSummary = await summarizeWorkspace(workspace);
  return context.json({ ok: true, workspace: summary });
});

app.get("/api/workspace", async (context) => {
  return context.json(await summarizeWorkspace(workspace));
});

app.get("/api/models", async (context) => {
  return context.json(await runtime.listModels());
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
    await orchestrator.delegate(context.req.param("sessionId"), request.prompt)
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

app.get("/api/orchestrator/sessions/:sessionId/stream", async (context) => {
  return streamOrchestratorTerminal(context, context.req.param("sessionId"));
});

app.get("/", async (context) => serveWebRequest(context, "/"));
app.get("/*", async (context) => serveWebRequest(context, context.req.path));

serve({ fetch: app.fetch, port });
console.log(`min-kb-app runtime listening on http://localhost:${port}`);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, async () => {
    await runtime.stop();
    process.exit(0);
  });
}

async function runChatFlow(
  agentId: string,
  request: ChatRequest,
  forcedSessionId?: string
): Promise<ChatResponse> {
  const createdAt = new Date().toISOString();
  const title = request.title ?? createSessionTitle(request.prompt);
  const sessionId =
    forcedSessionId ??
    request.sessionId ??
    sessionIdFromTitle(title, createdAt);
  const userThread = await saveChatTurn(workspace, {
    agentId,
    sessionId,
    title,
    sender: "user",
    bodyMarkdown: request.prompt,
    createdAt,
    runtimeConfig: request.config,
  });

  const assistantText = await runtime.sendMessage({
    agentId,
    sessionId,
    prompt: request.prompt,
    config: request.config,
  });

  const summary =
    userThread.turnCount <= 1 ? buildSummary(title, request.prompt) : undefined;
  const updatedThread = await saveChatTurn(workspace, {
    agentId,
    sessionId,
    title,
    sender: "assistant",
    bodyMarkdown: assistantText,
    createdAt: new Date().toISOString(),
    summary,
    runtimeConfig: request.config,
  });

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
  const memorySkillNames = skills
    .map((skill) => skill.name)
    .filter((skillName) => isMemorySkillName(skillName));
  const baseConfig = thread.runtimeConfig ?? request.config ?? undefined;
  const disabledSkills = (baseConfig?.disabledSkills ?? []).filter(
    (skillName) => !memorySkillNames.includes(skillName)
  );
  const analysisConfig = {
    ...baseConfig,
    model: "gpt-4.1",
    disabledSkills,
  };

  const markdown = await runtime.sendMessage({
    agentId,
    sessionId: `${sessionId}-memory-${Date.now()}`,
    prompt: buildMemoryAnalysisPrompt(thread, memorySkillNames),
    config: analysisConfig,
  });

  return {
    markdown,
    model: "gpt-4.1",
    enabledSkillNames: memorySkillNames,
  };
}

function createSessionTitle(prompt: string): string {
  const words = prompt.trim().split(/\s+/).slice(0, 6);
  return words.join(" ") || "New session";
}

function buildSummary(title: string, prompt: string): string {
  const normalizedPrompt = prompt.trim().replace(/\s+/g, " ");
  const titleWordCount = title.trim().split(/\s+/).filter(Boolean).length;
  const remainder = normalizedPrompt
    .split(/\s+/)
    .slice(titleWordCount)
    .join(" ");
  return remainder.slice(0, 120) || "Started from the initial prompt.";
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
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
