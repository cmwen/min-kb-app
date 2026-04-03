import {
  type AssistantMessageEvent,
  approveAll,
  CopilotClient,
  type SessionEvent,
} from "@github/copilot-sdk";
import {
  type GenerateContentResponse,
  GoogleGenAI,
  type GoogleGenAIOptions,
} from "@google/genai";
import {
  getAgentById,
  listAgents,
  listSkillsForAgent,
  loadEnabledSkillDocumentsForAgent,
  type MinKbWorkspace,
  pathExists,
} from "@min-kb-app/min-kb-store";
import type {
  AgentSummary,
  ChatProviderDescriptor,
  ChatRuntimeConfig,
  LlmRequestStats,
  ModelCatalog,
  ModelDescriptor,
  TurnSender,
} from "@min-kb-app/shared";
import {
  llmRequestStatsSchema,
  type MemoryTier,
  mergeChatRuntimeConfigs,
} from "@min-kb-app/shared";
import {
  COPILOT_RUNTIME_PROVIDER,
  FALLBACK_MODELS,
  GEMINI_RUNTIME_PROVIDER,
  LM_STUDIO_RUNTIME_PROVIDER,
  mapGeminiModelToDescriptor,
  mapLmStudioModelToDescriptor,
  mapModelInfoToDescriptor,
  mergeModelCatalogs,
  normalizeConfigForModel,
  RUNTIME_PROVIDERS,
} from "./models";

export interface ConversationTurn {
  sender: TurnSender;
  bodyMarkdown: string;
}

export interface SendRuntimeMessageInput {
  agentId: string;
  sessionId: string;
  prompt: string;
  config?: Partial<ChatRuntimeConfig>;
  conversation?: ConversationTurn[];
}

interface NormalizedSendRuntimeMessageInput
  extends Omit<SendRuntimeMessageInput, "config"> {
  agent?: AgentSummary;
  config: ChatRuntimeConfig;
}

export interface SendRuntimeMessageResult {
  assistantText: string;
  llmStats?: LlmRequestStats;
  sessionDiagnostics?: SessionDiagnostics;
}

interface LoadedSkillDiagnostic {
  name: string;
  enabled: boolean;
}

interface ToolExecutionDiagnostic {
  toolName: string;
  success: boolean;
  content?: string;
  memoryTier?: MemoryTier;
}

export interface SessionDiagnostics {
  loadedSkills: LoadedSkillDiagnostic[];
  invokedSkills: string[];
  toolExecutions: ToolExecutionDiagnostic[];
  reportedLoadedSkills: boolean;
}

interface RuntimeProvider {
  readonly descriptor: ChatProviderDescriptor;
  listModels(): Promise<ModelDescriptor[]>;
  sendMessage(
    input: NormalizedSendRuntimeMessageInput
  ): Promise<SendRuntimeMessageResult>;
  stop(): Promise<void>;
}

interface SettledCopilotResponse {
  assistantMessage?: AssistantMessageEvent;
  assistantText?: string;
}

const DIAGNOSTIC_IDLE_WAIT_MS = 25;
const DIAGNOSTIC_MAX_WAIT_MS = 250;
const SESSION_IDLE_SETTLE_MS = 100;
const SESSION_COMPLETION_POLL_MS = 50;
const SESSION_COMPLETION_TIMEOUT_MS = 600000;
const DEFAULT_LM_STUDIO_BASE_URL = "http://127.0.0.1:1234/v1";
const DEFAULT_LM_STUDIO_MODEL_DISCOVERY_TIMEOUT_MS = 15000;
const DEFAULT_LM_STUDIO_CHAT_TIMEOUT_MS = SESSION_COMPLETION_TIMEOUT_MS;

export class ChatRuntimeService {
  private readonly providers: RuntimeProvider[];
  private readonly providersById: Map<string, RuntimeProvider>;
  private readonly workspace: MinKbWorkspace;

  constructor(
    workspace: MinKbWorkspace,
    options?: {
      geminiApiKey?: string;
      geminiApiVersion?: string;
      geminiLocation?: string;
      geminiModel?: string;
      geminiProject?: string;
      geminiUseVertexAi?: boolean;
      lmStudioBaseUrl?: string;
      lmStudioModel?: string;
    }
  ) {
    this.workspace = workspace;
    this.providers = [
      new CopilotRuntimeProvider(workspace),
      new GeminiRuntimeProvider(workspace, options),
      new LmStudioRuntimeProvider(workspace, options),
    ];
    this.providersById = new Map(
      this.providers.map((provider) => [provider.descriptor.id, provider])
    );
  }

  async listModelCatalog(): Promise<ModelCatalog> {
    const models = await Promise.all(
      this.providers.map((provider) => provider.listModels())
    );
    return {
      defaultProvider: COPILOT_RUNTIME_PROVIDER.id,
      providers: RUNTIME_PROVIDERS,
      models: mergeModelCatalogs(...models),
    };
  }

  async listModels(
    providerId = COPILOT_RUNTIME_PROVIDER.id
  ): Promise<ModelDescriptor[]> {
    return this.getProvider(providerId).listModels();
  }

  async stop(): Promise<void> {
    await Promise.allSettled(this.providers.map((provider) => provider.stop()));
  }

  async sendMessage(
    input: SendRuntimeMessageInput
  ): Promise<SendRuntimeMessageResult> {
    const agent = await getAgentById(this.workspace, input.agentId);
    const parsedConfig = mergeChatRuntimeConfigs(
      agent?.runtimeConfig,
      input.config
    );
    const provider = this.getProvider(parsedConfig.provider);
    const normalizedConfig = normalizeConfigForModel(
      parsedConfig,
      await provider.listModels()
    );
    return this.getProvider(normalizedConfig.provider).sendMessage({
      ...input,
      agent,
      config: normalizedConfig,
    });
  }

  private getProvider(providerId: string): RuntimeProvider {
    const provider =
      this.providersById.get(providerId) ??
      this.providersById.get(COPILOT_RUNTIME_PROVIDER.id) ??
      this.providers[0];
    if (!provider) {
      throw new Error("No runtime providers are registered.");
    }
    return provider;
  }
}

class CopilotRuntimeProvider implements RuntimeProvider {
  readonly descriptor = COPILOT_RUNTIME_PROVIDER;
  private readonly client = new CopilotClient();
  private started = false;

  constructor(private readonly workspace: MinKbWorkspace) {}

  async listModels(): Promise<ModelDescriptor[]> {
    try {
      await this.ensureStarted();
      const liveModels = await this.client.listModels();
      return mergeModelCatalogs(
        liveModels.map((model) =>
          mapModelInfoToDescriptor(model, this.descriptor.id)
        ),
        FALLBACK_MODELS
      );
    } catch (error) {
      console.warn(
        "Falling back to the bundled model catalog because live Copilot model discovery failed.",
        error
      );
      return FALLBACK_MODELS;
    }
  }

  async stop(): Promise<void> {
    if (!this.started) {
      return;
    }

    await this.client.stop();
    this.started = false;
  }

  async sendMessage(
    input: NormalizedSendRuntimeMessageInput
  ): Promise<SendRuntimeMessageResult> {
    const session = await this.openSession(
      input.agentId,
      input.sessionId,
      input.config
    );
    const usageEvents: SessionEvent[] = [];
    const sessionDiagnostics = createSessionDiagnosticsCollector();
    const unsubscribeUsage = session.on("assistant.usage", (event) => {
      usageEvents.push(event);
    });
    const unsubscribeDiagnostics = session.on((event) => {
      sessionDiagnostics.record(event);
    });

    try {
      const response = await this.sendAndWaitForCompletion(
        session,
        input.prompt
      );
      await sessionDiagnostics.waitForIdle();
      const assistantText =
        response.assistantText ??
        this.extractAssistantText(response.assistantMessage);
      if (assistantText === undefined) {
        console.warn(
          "Copilot completed without returning assistant text; saving an empty assistant turn."
        );
      }
      return {
        assistantText: assistantText ?? "",
        llmStats: this.aggregateUsageEvents(
          usageEvents,
          response.assistantMessage
        ),
        sessionDiagnostics: sessionDiagnostics.snapshot(),
      };
    } finally {
      await session.disconnect();
      unsubscribeUsage();
      unsubscribeDiagnostics();
    }
  }

  private async sendAndWaitForCompletion(
    session: Awaited<ReturnType<CopilotClient["createSession"]>>,
    prompt: string
  ): Promise<SettledCopilotResponse> {
    let lastAssistantMessage: AssistantMessageEvent | undefined;
    let latestAssistantText: string | undefined;
    const assistantTextByMessageId = new Map<string, string>();
    let idleObserved = false;
    let lastEventAt = Date.now();
    let sessionError: Error | undefined;
    const unsubscribe = session.on((event) => {
      lastEventAt = Date.now();
      if (event.type === "assistant.message") {
        lastAssistantMessage = event;
        latestAssistantText = this.extractAssistantText(event);
        return;
      }
      if (event.type === "assistant.message_delta") {
        const nextAssistantText = `${
          assistantTextByMessageId.get(event.data.messageId) ?? ""
        }${event.data.deltaContent}`;
        assistantTextByMessageId.set(event.data.messageId, nextAssistantText);
        latestAssistantText = nextAssistantText;
        return;
      }
      if (event.type === "session.idle") {
        idleObserved = true;
        return;
      }
      if (event.type === "session.error") {
        const error = new Error(event.data.message);
        error.stack = event.data.stack;
        sessionError = error;
      }
    });

    try {
      await session.send({ prompt });
      const deadline = Date.now() + SESSION_COMPLETION_TIMEOUT_MS;

      while (Date.now() < deadline) {
        if (sessionError) {
          throw sessionError;
        }
        if (
          idleObserved &&
          Date.now() - lastEventAt >= SESSION_IDLE_SETTLE_MS
        ) {
          return this.buildSettledCopilotResponse(
            lastAssistantMessage,
            latestAssistantText
          );
        }
        await delay(SESSION_COMPLETION_POLL_MS);
      }

      if (lastAssistantMessage || latestAssistantText !== undefined) {
        return this.buildSettledCopilotResponse(
          lastAssistantMessage,
          latestAssistantText
        );
      }
      throw new Error(
        `Timeout after ${SESSION_COMPLETION_TIMEOUT_MS}ms waiting for session completion`
      );
    } finally {
      unsubscribe();
    }
  }

  private buildSettledCopilotResponse(
    assistantMessage: AssistantMessageEvent | undefined,
    assistantText: string | undefined
  ): SettledCopilotResponse {
    return {
      assistantMessage,
      assistantText:
        assistantText ?? this.extractAssistantText(assistantMessage),
    };
  }

  private async openSession(
    agentId: string,
    sessionId: string,
    runtimeConfig: ChatRuntimeConfig
  ): Promise<Awaited<ReturnType<CopilotClient["createSession"]>>> {
    await this.ensureStarted();
    const normalizedRuntimeConfig = normalizeConfigForModel(
      runtimeConfig,
      await this.listModels()
    );
    const sessionExists = await this.hasSession(sessionId);
    const customAgents = await this.buildCustomAgents();
    const skillDirectories = await this.resolveSkillDirectories(agentId);
    const sessionConfig = {
      sessionId,
      model: normalizedRuntimeConfig.model,
      reasoningEffort: normalizedRuntimeConfig.reasoningEffort,
      onPermissionRequest: approveAll,
      customAgents,
      agent: agentId,
      skillDirectories,
      disabledSkills: normalizedRuntimeConfig.disabledSkills,
      mcpServers: normalizedRuntimeConfig.mcpServers,
    };

    return sessionExists
      ? this.client.resumeSession(sessionId, sessionConfig)
      : this.client.createSession(sessionConfig);
  }

  private async buildCustomAgents(): Promise<
    Array<{
      name: string;
      displayName: string;
      description: string;
      prompt: string;
    }>
  > {
    const agents = await listAgents(this.workspace);
    return agents.map((agent) => this.mapCustomAgent(agent));
  }

  private async resolveSkillDirectories(agentId: string): Promise<string[]> {
    const skills = await listSkillsForAgent(this.workspace, agentId);
    const roots = [
      this.workspace.copilotSkillsRoot,
      this.workspace.skillsRoot,
      `${this.workspace.agentsRoot}/${agentId}/skills`,
    ];
    const availableRoots: string[] = [];
    const seen = new Set<string>();

    for (const root of roots) {
      if (seen.has(root) || !(await pathExists(root))) {
        continue;
      }
      seen.add(root);
      availableRoots.push(root);
    }

    for (const skill of skills) {
      if (seen.has(skill.sourceRoot) || !(await pathExists(skill.sourceRoot))) {
        continue;
      }
      seen.add(skill.sourceRoot);
      availableRoots.push(skill.sourceRoot);
    }

    return availableRoots;
  }

  private extractAssistantText(response: unknown): string | undefined {
    if (!response || typeof response !== "object") {
      return undefined;
    }

    const data = Reflect.get(response, "data");
    if (!data || typeof data !== "object") {
      return undefined;
    }

    const content = Reflect.get(data, "content");
    return typeof content === "string" ? content : undefined;
  }

  private aggregateUsageEvents(
    events: SessionEvent[],
    response: AssistantMessageEvent | undefined
  ): LlmRequestStats | undefined {
    const usageEvents = events.filter(
      (event): event is Extract<SessionEvent, { type: "assistant.usage" }> =>
        event.type === "assistant.usage"
    );
    if (usageEvents.length === 0) {
      return undefined;
    }

    const lastEvent = usageEvents.at(-1);
    if (!lastEvent) {
      return undefined;
    }

    const quotaSnapshots =
      lastEvent.data.quotaSnapshots &&
      Object.keys(lastEvent.data.quotaSnapshots).length
        ? lastEvent.data.quotaSnapshots
        : {};
    const tokenDetails = lastEvent.data.copilotUsage?.tokenDetails ?? [];

    const usageOutputTokens = usageEvents.reduce(
      (sum, event) => sum + (event.data.outputTokens ?? 0),
      0
    );

    return llmRequestStatsSchema.parse({
      recordedAt: lastEvent.timestamp,
      model: lastEvent.data.model,
      requestCount: usageEvents.length,
      premiumRequestUnits: usageEvents.reduce(
        (sum, event) => sum + (event.data.cost ?? 0),
        0
      ),
      inputTokens: usageEvents.reduce(
        (sum, event) => sum + (event.data.inputTokens ?? 0),
        0
      ),
      outputTokens: usageOutputTokens || (response?.data.outputTokens ?? 0),
      cacheReadTokens: usageEvents.reduce(
        (sum, event) => sum + (event.data.cacheReadTokens ?? 0),
        0
      ),
      cacheWriteTokens: usageEvents.reduce(
        (sum, event) => sum + (event.data.cacheWriteTokens ?? 0),
        0
      ),
      cost: usageEvents.reduce((sum, event) => sum + (event.data.cost ?? 0), 0),
      durationMs: usageEvents.reduce(
        (sum, event) => sum + (event.data.duration ?? 0),
        0
      ),
      reasoningEffort: lastEvent.data.reasoningEffort,
      initiator: lastEvent.data.initiator,
      interactionId: response?.data.interactionId,
      apiCallId: lastEvent.data.apiCallId,
      providerCallId: lastEvent.data.providerCallId,
      parentToolCallId:
        response?.data.parentToolCallId ?? lastEvent.data.parentToolCallId,
      quotaSnapshots,
      tokenDetails,
      totalNanoAiu: lastEvent.data.copilotUsage?.totalNanoAiu,
    });
  }

  private mapCustomAgent(agent: AgentSummary) {
    return {
      name: agent.id,
      displayName: agent.title,
      description: agent.description,
      prompt: agent.combinedPrompt,
    };
  }

  private async hasSession(sessionId: string): Promise<boolean> {
    const sessions = await this.client.listSessions();
    return sessions.some((session) => session.sessionId === sessionId);
  }

  private async ensureStarted(): Promise<void> {
    if (this.started) {
      return;
    }

    process.env.MIN_KB_STORE_ROOT = this.workspace.storeRoot;
    process.chdir(this.workspace.storeRoot);
    await this.client.start();
    this.started = true;
  }
}

class GeminiRuntimeProvider implements RuntimeProvider {
  readonly descriptor = GEMINI_RUNTIME_PROVIDER;
  private client: GoogleGenAI | undefined;
  private readonly clientOptions: GoogleGenAIOptions;
  private readonly clientConfigured: boolean;
  private readonly configuredModel: string | undefined;

  constructor(
    private readonly workspace: MinKbWorkspace,
    options?: {
      geminiApiKey?: string;
      geminiApiVersion?: string;
      geminiLocation?: string;
      geminiModel?: string;
      geminiProject?: string;
      geminiUseVertexAi?: boolean;
    }
  ) {
    this.clientOptions = buildGeminiClientOptions({
      apiKey: options?.geminiApiKey,
      apiVersion: options?.geminiApiVersion,
      location: options?.geminiLocation,
      project: options?.geminiProject,
      vertexai: options?.geminiUseVertexAi,
    });
    this.clientConfigured = Boolean(
      this.clientOptions.apiKey || this.clientOptions.vertexai
    );
    this.configuredModel =
      options?.geminiModel ?? process.env.MIN_KB_APP_GEMINI_MODEL;
  }

  async listModels(): Promise<ModelDescriptor[]> {
    const fallbackModels = [
      ...FALLBACK_MODELS.filter(
        (model) => model.runtimeProvider === this.descriptor.id
      ),
      ...(this.configuredModel
        ? [
            {
              id: this.configuredModel,
              displayName: this.configuredModel,
              runtimeProvider: this.descriptor.id,
              provider: "Google",
              supportedReasoningEfforts: [],
            } satisfies ModelDescriptor,
          ]
        : []),
    ];

    if (!this.clientConfigured) {
      return fallbackModels;
    }

    try {
      const pager = await this.getClient().models.list();
      const liveModels: ModelDescriptor[] = [];
      for await (const model of pager) {
        if (
          Array.isArray(model.supportedActions) &&
          !model.supportedActions.includes("generateContent")
        ) {
          continue;
        }
        const descriptor = mapGeminiModelToDescriptor(model);
        if (descriptor) {
          liveModels.push(descriptor);
        }
      }
      return mergeModelCatalogs(liveModels, fallbackModels);
    } catch (error) {
      console.warn("Gemini model discovery failed.", error);
      return fallbackModels;
    }
  }

  async stop(): Promise<void> {
    return Promise.resolve();
  }

  async sendMessage(
    input: NormalizedSendRuntimeMessageInput
  ): Promise<SendRuntimeMessageResult> {
    if (!this.clientConfigured) {
      throw new Error(
        "Gemini runtime is not configured. Set MIN_KB_APP_GEMINI_API_KEY, GEMINI_API_KEY, GOOGLE_API_KEY, or enable Vertex AI configuration."
      );
    }
    const startedAt = Date.now();
    const enabledSkills = await loadEnabledSkillDocumentsForAgent(
      this.workspace,
      input.agentId,
      input.config.disabledSkills
    );
    const sessionDiagnostics =
      buildPromptBackedSessionDiagnostics(enabledSkills);
    const response = await this.getClient().models.generateContent({
      model: input.config.model,
      contents: buildGeminiContents({
        conversation: input.conversation ?? [],
        prompt: input.prompt,
      }),
      config: {
        systemInstruction: buildGeminiSystemInstruction(
          input.agent?.combinedPrompt,
          enabledSkills
        ),
      },
    });
    const assistantText = response.text?.trim();
    if (!assistantText) {
      throw new Error("Gemini returned no assistant message content.");
    }

    return {
      assistantText,
      llmStats: buildGeminiUsageStats(
        response,
        input.config.model,
        Date.now() - startedAt
      ),
      sessionDiagnostics,
    };
  }

  private getClient(): GoogleGenAI {
    this.client ??= new GoogleGenAI(this.clientOptions);
    return this.client;
  }
}

function buildGeminiClientOptions(input: {
  apiKey?: string;
  apiVersion?: string;
  location?: string;
  project?: string;
  vertexai?: boolean;
}): GoogleGenAIOptions {
  const vertexai =
    input.vertexai ??
    readBooleanEnv("MIN_KB_APP_GEMINI_USE_VERTEXAI") ??
    readBooleanEnv("GOOGLE_GENAI_USE_VERTEXAI");
  const apiKey =
    input.apiKey ??
    process.env.MIN_KB_APP_GEMINI_API_KEY ??
    process.env.GEMINI_API_KEY ??
    process.env.GOOGLE_API_KEY;
  const project =
    input.project ??
    process.env.MIN_KB_APP_GEMINI_PROJECT ??
    process.env.GOOGLE_CLOUD_PROJECT;
  const location =
    input.location ??
    process.env.MIN_KB_APP_GEMINI_LOCATION ??
    process.env.GOOGLE_CLOUD_LOCATION;
  const apiVersion =
    input.apiVersion ?? process.env.MIN_KB_APP_GEMINI_API_VERSION;

  return {
    ...(vertexai === undefined ? {} : { vertexai }),
    ...(apiKey ? { apiKey } : {}),
    ...(project ? { project } : {}),
    ...(location ? { location } : {}),
    ...(apiVersion ? { apiVersion } : {}),
  };
}

function buildGeminiContents(input: {
  conversation: ConversationTurn[];
  prompt: string;
}) {
  const history = input.conversation
    .map((turn) => ({
      role: mapSenderToGeminiRole(turn.sender),
      parts: [{ text: turn.bodyMarkdown.trim() }],
    }))
    .filter((turn) => (turn.parts[0]?.text ?? "").length > 0);
  const normalizedPrompt = input.prompt.trim();
  if (normalizedPrompt.length > 0) {
    history.push({
      role: "user",
      parts: [{ text: normalizedPrompt }],
    });
  }
  return history;
}

function buildGeminiSystemInstruction(
  agentPrompt: string | undefined,
  enabledSkills: Awaited<ReturnType<typeof loadEnabledSkillDocumentsForAgent>>
): string | undefined {
  const sections = [
    "You are running through the Gemini SDK inside min-kb-app.",
    "Do not claim to have used MCP servers, tools, or external resources unless their results already appear in the conversation.",
    enabledSkills.length > 0
      ? [
          "Skills selected for this run are provided below as live operating instructions.",
          "Apply them when they are relevant instead of describing them as unavailable metadata.",
          "If a skill calls for tools, commands, MCP servers, or external systems, only rely on results already present in the conversation and clearly state when something still needs to be run outside this Gemini response.",
        ].join(" ")
      : undefined,
    agentPrompt?.trim()
      ? `## Agent instructions\n\n${agentPrompt.trim()}`
      : undefined,
    enabledSkills.length > 0
      ? [
          "## Enabled skills",
          ...enabledSkills.map(
            (skill) =>
              `### ${skill.name}\n- Scope: ${skill.scope}\n- Description: ${skill.description}\n\n${skill.content.trim()}`
          ),
        ].join("\n\n")
      : undefined,
  ].filter((section): section is string => Boolean(section?.trim()));

  if (sections.length === 0) {
    return undefined;
  }

  return sections.join("\n\n");
}

function mapSenderToGeminiRole(sender: TurnSender): "user" | "model" {
  switch (sender) {
    case "assistant":
    case "tool":
      return "model";
    default:
      return "user";
  }
}

function buildGeminiUsageStats(
  response: GenerateContentResponse,
  modelId: string,
  durationMs: number
): LlmRequestStats {
  return llmRequestStatsSchema.parse({
    recordedAt: new Date().toISOString(),
    model: response.modelVersion ?? modelId,
    requestCount: 1,
    premiumRequestUnits: 0,
    inputTokens: response.usageMetadata?.promptTokenCount ?? 0,
    outputTokens: response.usageMetadata?.candidatesTokenCount ?? 0,
    cacheReadTokens: response.usageMetadata?.cachedContentTokenCount ?? 0,
    cacheWriteTokens: 0,
    cost: 0,
    durationMs,
  });
}

class LmStudioRuntimeProvider implements RuntimeProvider {
  readonly descriptor = LM_STUDIO_RUNTIME_PROVIDER;
  private readonly baseUrl: string;
  private readonly configuredModel: string | undefined;
  private readonly modelDiscoveryTimeoutMs: number;
  private readonly chatTimeoutMs: number;

  constructor(
    private readonly workspace: MinKbWorkspace,
    options?: { lmStudioBaseUrl?: string; lmStudioModel?: string }
  ) {
    this.baseUrl = normalizeBaseUrl(
      options?.lmStudioBaseUrl ??
        process.env.MIN_KB_APP_LM_STUDIO_BASE_URL ??
        process.env.LM_STUDIO_BASE_URL ??
        DEFAULT_LM_STUDIO_BASE_URL
    );
    this.configuredModel =
      options?.lmStudioModel ??
      process.env.MIN_KB_APP_LM_STUDIO_MODEL ??
      process.env.LM_STUDIO_MODEL;
    this.modelDiscoveryTimeoutMs = readPositiveIntegerEnv(
      "MIN_KB_APP_LM_STUDIO_MODELS_TIMEOUT_MS",
      DEFAULT_LM_STUDIO_MODEL_DISCOVERY_TIMEOUT_MS
    );
    this.chatTimeoutMs = readPositiveIntegerEnv(
      "MIN_KB_APP_LM_STUDIO_CHAT_TIMEOUT_MS",
      DEFAULT_LM_STUDIO_CHAT_TIMEOUT_MS
    );
  }

  async listModels(): Promise<ModelDescriptor[]> {
    try {
      const response = await fetchWithTimeout(
        `${this.baseUrl}/models`,
        undefined,
        this.modelDiscoveryTimeoutMs,
        "LM Studio model discovery"
      );
      if (!response.ok) {
        throw new Error(
          `LM Studio model discovery failed with status ${response.status}.`
        );
      }
      const body = (await response.json()) as {
        data?: Array<{ id?: string; owned_by?: string }>;
      };
      const liveModels = (body.data ?? [])
        .filter(
          (model): model is { id: string; owned_by?: string } =>
            typeof model.id === "string" && model.id.trim().length > 0
        )
        .map((model) => mapLmStudioModelToDescriptor(model));
      const fallbackModels = this.configuredModel
        ? [
            {
              id: this.configuredModel,
              displayName: this.configuredModel,
              runtimeProvider: this.descriptor.id,
              supportedReasoningEfforts: [],
            } satisfies ModelDescriptor,
          ]
        : [];
      return mergeModelCatalogs(liveModels, fallbackModels);
    } catch (error) {
      console.warn("LM Studio model discovery failed.", error);
      if (!this.configuredModel) {
        return [];
      }
      return [
        {
          id: this.configuredModel,
          displayName: this.configuredModel,
          runtimeProvider: this.descriptor.id,
          supportedReasoningEfforts: [],
        },
      ];
    }
  }

  async stop(): Promise<void> {
    return Promise.resolve();
  }

  async sendMessage(
    input: NormalizedSendRuntimeMessageInput
  ): Promise<SendRuntimeMessageResult> {
    const startedAt = Date.now();
    const enabledSkills = await loadEnabledSkillDocumentsForAgent(
      this.workspace,
      input.agentId,
      input.config.disabledSkills
    );
    const sessionDiagnostics =
      buildPromptBackedSessionDiagnostics(enabledSkills);
    const response = await fetchWithTimeout(
      `${this.baseUrl}/chat/completions`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: input.config.model,
          messages: buildLmStudioMessages({
            conversation: input.conversation ?? [],
            prompt: input.prompt,
            agentPrompt: input.agent?.combinedPrompt,
            enabledSkills,
          }),
          stream: false,
        }),
      },
      this.chatTimeoutMs,
      "LM Studio chat request"
    );
    if (!response.ok) {
      const body = await response.text();
      throw new Error(
        `LM Studio chat request failed (${response.status}): ${body || "No response body."}`
      );
    }

    const completion =
      (await response.json()) as LmStudioChatCompletionResponse;
    const assistantText = extractLmStudioAssistantText(completion);
    if (assistantText === undefined) {
      throw new Error("LM Studio returned no assistant message content.");
    }

    return {
      assistantText,
      llmStats: buildLmStudioUsageStats(
        completion,
        input.config.model,
        Date.now() - startedAt
      ),
      sessionDiagnostics,
    };
  }
}

interface LmStudioChatCompletionResponse {
  id?: string;
  created?: number;
  model?: string;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
  };
  choices?: Array<{
    message?: {
      content?:
        | string
        | Array<{
            type?: string;
            text?: string;
            thinking?: string;
          }>;
    };
  }>;
}

function buildLmStudioMessages(input: {
  conversation: ConversationTurn[];
  prompt: string;
  agentPrompt?: string;
  enabledSkills: Awaited<ReturnType<typeof loadEnabledSkillDocumentsForAgent>>;
}): Array<{ role: "system" | "user" | "assistant"; content: string }> {
  const history = input.conversation
    .map((turn) => ({
      role: mapSenderToOpenAiRole(turn.sender),
      content: turn.bodyMarkdown.trim(),
    }))
    .filter((turn) => turn.content.length > 0);
  const systemPrompt = buildLmStudioSystemPrompt(
    input.agentPrompt,
    input.enabledSkills
  );
  if (systemPrompt) {
    history.unshift({
      role: "system",
      content: systemPrompt,
    });
  }
  const normalizedPrompt = input.prompt.trim();
  if (normalizedPrompt.length > 0) {
    history.push({
      role: "user",
      content: normalizedPrompt,
    });
  }
  return history;
}

function buildLmStudioSystemPrompt(
  agentPrompt: string | undefined,
  enabledSkills: Awaited<ReturnType<typeof loadEnabledSkillDocumentsForAgent>>
): string | undefined {
  const sections = [
    "You are running through LM Studio inside min-kb-app.",
    "Do not claim to have used MCP servers, tools, or external resources unless their results already appear in the conversation.",
    enabledSkills.length > 0
      ? [
          "Skills selected for this run are provided below as live operating instructions.",
          "Apply them when they are relevant instead of describing them as unavailable metadata.",
          "If a skill calls for tools, commands, MCP servers, or external systems, only rely on results already present in the conversation and clearly state when something still needs to be run outside this LM Studio response.",
        ].join(" ")
      : undefined,
    agentPrompt?.trim()
      ? `## Agent instructions\n\n${agentPrompt.trim()}`
      : undefined,
    enabledSkills.length > 0
      ? [
          "## Enabled skills",
          ...enabledSkills.map(
            (skill) =>
              `### ${skill.name}\n- Scope: ${skill.scope}\n- Description: ${skill.description}\n\n${skill.content.trim()}`
          ),
        ].join("\n\n")
      : undefined,
  ].filter((section): section is string => Boolean(section?.trim()));

  if (sections.length === 0) {
    return undefined;
  }

  return sections.join("\n\n");
}

function buildPromptBackedSessionDiagnostics(
  enabledSkills: Awaited<ReturnType<typeof loadEnabledSkillDocumentsForAgent>>
): SessionDiagnostics {
  return {
    loadedSkills: enabledSkills.map((skill) => ({
      name: skill.name,
      enabled: true,
    })),
    invokedSkills: [],
    toolExecutions: [],
    reportedLoadedSkills: true,
  };
}

function mapSenderToOpenAiRole(
  sender: TurnSender
): "system" | "user" | "assistant" {
  switch (sender) {
    case "system":
      return "system";
    case "assistant":
      return "assistant";
    case "tool":
      return "assistant";
    default:
      return "user";
  }
}

function extractLmStudioAssistantText(
  completion: LmStudioChatCompletionResponse
): string | undefined {
  const content = completion.choices?.[0]?.message?.content;
  if (typeof content === "string") {
    return stripLmStudioThinkingContent(content) || undefined;
  }
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        const normalizedType = part.type?.trim().toLowerCase();
        if (normalizedType === "thinking" || normalizedType === "reasoning") {
          return "";
        }
        return stripLmStudioThinkingContent(part.text ?? "");
      })
      .join("")
      .trim();
  }
  return undefined;
}

function stripLmStudioThinkingContent(content: string): string {
  let normalizedContent = content;

  for (const pattern of LM_STUDIO_THINKING_BLOCK_PATTERNS) {
    normalizedContent = normalizedContent.replace(pattern, "");
  }

  return normalizedContent.trim();
}

const LM_STUDIO_THINKING_BLOCK_PATTERNS = [
  /^\s*<think>\s*[\s\S]*?<\/think>\s*/gi,
  /^\s*<thinking>\s*[\s\S]*?<\/thinking>\s*/gi,
  /^\s*<reasoning>\s*[\s\S]*?<\/reasoning>\s*/gi,
  /^\s*\[think(?:ing)?\]\s*[\s\S]*?\[\/think(?:ing)?\]\s*/gi,
  /^\s*\{think(?:ing)?\}\s*[\s\S]*?\{\/think(?:ing)?\}\s*/gi,
];

function buildLmStudioUsageStats(
  completion: LmStudioChatCompletionResponse,
  modelId: string,
  durationMs: number
): LlmRequestStats {
  return llmRequestStatsSchema.parse({
    recordedAt: new Date(
      completion.created ? completion.created * 1000 : Date.now()
    ).toISOString(),
    model: completion.model ?? modelId,
    requestCount: 1,
    premiumRequestUnits: 0,
    inputTokens: completion.usage?.prompt_tokens ?? 0,
    outputTokens: completion.usage?.completion_tokens ?? 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    cost: 0,
    durationMs,
  });
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "");
}

async function fetchWithTimeout(
  input: string,
  init: RequestInit | undefined,
  timeoutMs: number,
  label: string
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  try {
    return await fetch(input, {
      ...init,
      signal: controller.signal,
    });
  } catch (error) {
    if (isAbortError(error)) {
      throw new Error(`${label} timed out after ${timeoutMs}ms.`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function isAbortError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === "AbortError" ||
      error.message === "The operation was aborted")
  );
}

function readPositiveIntegerEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) {
    return fallback;
  }
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function readBooleanEnv(name: string): boolean | undefined {
  const raw = process.env[name]?.trim().toLowerCase();
  if (!raw) {
    return undefined;
  }
  if (["1", "true", "yes", "on"].includes(raw)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(raw)) {
    return false;
  }
  return undefined;
}

function createSessionDiagnosticsCollector() {
  const loadedSkills = new Map<string, LoadedSkillDiagnostic>();
  const invokedSkills = new Set<string>();
  const toolNamesByCallId = new Map<string, string>();
  const toolTiersByCallId = new Map<string, MemoryTier>();
  const toolExecutions: ToolExecutionDiagnostic[] = [];
  let reportedLoadedSkills = false;
  let version = 0;

  return {
    record(event: SessionEvent) {
      let changed = false;
      switch (event.type) {
        case "session.skills_loaded":
          reportedLoadedSkills = true;
          for (const skill of event.data.skills) {
            loadedSkills.set(skill.name, {
              name: skill.name,
              enabled: skill.enabled,
            });
          }
          changed = true;
          break;
        case "skill.invoked":
          invokedSkills.add(event.data.name);
          changed = true;
          break;
        case "tool.execution_start": {
          toolNamesByCallId.set(event.data.toolCallId, event.data.toolName);
          const memoryTier = detectMemoryTier(event.data.arguments);
          if (memoryTier) {
            toolTiersByCallId.set(event.data.toolCallId, memoryTier);
          }
          changed = true;
          break;
        }
        case "tool.execution_complete":
          toolExecutions.push({
            toolName:
              toolNamesByCallId.get(event.data.toolCallId) ?? "unknown-tool",
            success: event.data.success,
            content:
              event.data.result?.detailedContent ?? event.data.result?.content,
            memoryTier: toolTiersByCallId.get(event.data.toolCallId),
          });
          changed = true;
          break;
        default:
          break;
      }

      if (changed) {
        version += 1;
      }
    },
    async waitForIdle() {
      const deadline = Date.now() + DIAGNOSTIC_MAX_WAIT_MS;
      let observedVersion = version;

      while (Date.now() < deadline) {
        await delay(DIAGNOSTIC_IDLE_WAIT_MS);
        if (version === observedVersion) {
          return;
        }
        observedVersion = version;
      }
    },
    snapshot(): SessionDiagnostics {
      return {
        loadedSkills: [...loadedSkills.values()],
        invokedSkills: [...invokedSkills],
        toolExecutions,
        reportedLoadedSkills,
      };
    },
  };
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function detectMemoryTier(argumentsJson: unknown): MemoryTier | undefined {
  if (typeof argumentsJson !== "string" || !argumentsJson.trim()) {
    return undefined;
  }

  const matchedTier = argumentsJson.match(/"tier"\s*:\s*"([^"]+)"/)?.[1];
  if (matchedTier === "working") {
    return "working";
  }
  if (matchedTier === "short-term") {
    return "short-term";
  }
  if (matchedTier === "long-term") {
    return "long-term";
  }

  return undefined;
}
