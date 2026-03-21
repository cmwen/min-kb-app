import { z } from "zod";

export const DEFAULT_CHAT_MODEL = "gpt-5";
export const DEFAULT_CHAT_PROVIDER = "copilot";

export const chatProviderCapabilitiesSchema = z.object({
  supportsReasoningEffort: z.boolean().default(false),
  supportsSkills: z.boolean().default(false),
  supportsMcpServers: z.boolean().default(false),
});
export type ChatProviderCapabilities = z.infer<
  typeof chatProviderCapabilitiesSchema
>;

export const chatProviderDescriptorSchema = z.object({
  id: z.string().min(1),
  displayName: z.string().min(1),
  description: z.string().optional(),
  capabilities: chatProviderCapabilitiesSchema,
});
export type ChatProviderDescriptor = z.infer<
  typeof chatProviderDescriptorSchema
>;

export const reasoningEffortSchema = z.enum(["low", "medium", "high", "xhigh"]);
export type ReasoningEffort = z.infer<typeof reasoningEffortSchema>;

const localMcpServerSchema = z.object({
  type: z.enum(["local", "stdio"]),
  command: z.string().min(1),
  args: z.array(z.string()).default([]),
  cwd: z.string().optional(),
  env: z.record(z.string(), z.string()).default({}),
  tools: z.array(z.string()).default(["*"]),
  timeout: z.number().int().positive().optional(),
});

const remoteMcpServerSchema = z.object({
  type: z.enum(["http", "sse"]),
  url: z.string().url(),
  headers: z.record(z.string(), z.string()).default({}),
  tools: z.array(z.string()).default(["*"]),
  timeout: z.number().int().positive().optional(),
});

export const mcpServerConfigSchema = z.discriminatedUnion("type", [
  localMcpServerSchema,
  remoteMcpServerSchema,
]);
export type McpServerConfig = z.infer<typeof mcpServerConfigSchema>;

export const skillScopeSchema = z.enum([
  "copilot-global",
  "store-global",
  "agent-local",
]);
export type SkillScope = z.infer<typeof skillScopeSchema>;

export const skillDescriptorSchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  scope: skillScopeSchema,
  path: z.string().min(1),
  sourceRoot: z.string().min(1),
});
export type SkillDescriptor = z.infer<typeof skillDescriptorSchema>;

export const chatRuntimeConfigSchema = z.object({
  provider: z.string().min(1).default(DEFAULT_CHAT_PROVIDER),
  model: z.string().min(1).default(DEFAULT_CHAT_MODEL),
  reasoningEffort: reasoningEffortSchema.optional(),
  disabledSkills: z.array(z.string()).default([]),
  mcpServers: z.record(z.string(), mcpServerConfigSchema).default({}),
});
export type ChatRuntimeConfig = z.infer<typeof chatRuntimeConfigSchema>;

function normalizeQuotaCounter(value: unknown): unknown {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return value;
  }

  return Math.max(0, value);
}

function normalizeQuotaRemainingPercentage(value: unknown): unknown {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return value;
  }

  const normalized =
    value > 1 ? (value <= 100 ? value / 100 : 1) : Math.max(0, value);
  return Math.min(Math.max(normalized, 0), 1);
}

const quotaCounterSchema = z.preprocess(
  normalizeQuotaCounter,
  z.number().nonnegative()
);
const quotaRemainingPercentageSchema = z.preprocess(
  normalizeQuotaRemainingPercentage,
  z.number().min(0).max(1)
);

export const llmQuotaSnapshotSchema = z.object({
  isUnlimitedEntitlement: z.boolean(),
  entitlementRequests: quotaCounterSchema,
  usedRequests: quotaCounterSchema,
  usageAllowedWithExhaustedQuota: z.boolean(),
  overage: quotaCounterSchema,
  overageAllowedWithExhaustedQuota: z.boolean(),
  remainingPercentage: quotaRemainingPercentageSchema,
  resetDate: z.string().min(1).optional(),
});
export type LlmQuotaSnapshot = z.infer<typeof llmQuotaSnapshotSchema>;

export const llmTokenDetailSchema = z.object({
  batchSize: z.number().nonnegative(),
  costPerBatch: z.number().nonnegative(),
  tokenCount: z.number().nonnegative(),
  tokenType: z.string().min(1),
});
export type LlmTokenDetail = z.infer<typeof llmTokenDetailSchema>;

export const llmRequestStatsSchema = z.object({
  recordedAt: z.string().min(1),
  model: z.string().min(1),
  requestCount: z.number().int().positive().default(1),
  premiumRequestUnits: z.number().nonnegative().default(0),
  inputTokens: z.number().int().nonnegative().default(0),
  outputTokens: z.number().int().nonnegative().default(0),
  cacheReadTokens: z.number().int().nonnegative().default(0),
  cacheWriteTokens: z.number().int().nonnegative().default(0),
  cost: z.number().nonnegative().default(0),
  durationMs: z.number().nonnegative().default(0),
  reasoningEffort: z.string().min(1).optional(),
  initiator: z.string().min(1).optional(),
  interactionId: z.string().min(1).optional(),
  apiCallId: z.string().min(1).optional(),
  providerCallId: z.string().min(1).optional(),
  parentToolCallId: z.string().min(1).optional(),
  quotaSnapshots: z.record(z.string(), llmQuotaSnapshotSchema).default({}),
  tokenDetails: z.array(llmTokenDetailSchema).default([]),
  totalNanoAiu: z.number().nonnegative().optional(),
});
export type LlmRequestStats = z.infer<typeof llmRequestStatsSchema>;

export const llmSessionStatsSchema = z.object({
  requestCount: z.number().int().nonnegative().default(0),
  premiumRequestUnits: z.number().nonnegative().default(0),
  inputTokens: z.number().int().nonnegative().default(0),
  outputTokens: z.number().int().nonnegative().default(0),
  cacheReadTokens: z.number().int().nonnegative().default(0),
  cacheWriteTokens: z.number().int().nonnegative().default(0),
  totalCost: z.number().nonnegative().default(0),
  totalDurationMs: z.number().nonnegative().default(0),
  totalNanoAiu: z.number().nonnegative().default(0),
  lastRecordedAt: z.string().min(1).optional(),
  lastModel: z.string().min(1).optional(),
  lastReasoningEffort: z.string().min(1).optional(),
  quotaSnapshots: z.record(z.string(), llmQuotaSnapshotSchema).default({}),
});
export type LlmSessionStats = z.infer<typeof llmSessionStatsSchema>;

export const premiumUsageSchema = z.object({
  source: z.enum(["sdk", "tmux-estimate"]),
  model: z.string().min(1),
  premiumRequestUnits: z.number().nonnegative().default(0),
  billingMultiplier: z.number().nonnegative().optional(),
  recordedAt: z.string().min(1),
});
export type PremiumUsage = z.infer<typeof premiumUsageSchema>;

export const premiumUsageTotalsSchema = z.object({
  chargedRequestCount: z.number().int().nonnegative().default(0),
  premiumRequestUnits: z.number().nonnegative().default(0),
  lastRecordedAt: z.string().min(1).optional(),
  lastModel: z.string().min(1).optional(),
});
export type PremiumUsageTotals = z.infer<typeof premiumUsageTotalsSchema>;

export const modelDescriptorSchema = z.object({
  id: z.string().min(1),
  displayName: z.string().min(1),
  runtimeProvider: z.string().min(1).default(DEFAULT_CHAT_PROVIDER),
  provider: z.string().optional(),
  premiumRequestMultiplier: z.number().nonnegative().optional(),
  supportedReasoningEfforts: z.array(reasoningEffortSchema).default([]),
  defaultReasoningEffort: reasoningEffortSchema.optional(),
});
export type ModelDescriptor = z.infer<typeof modelDescriptorSchema>;

export const modelCatalogSchema = z.object({
  defaultProvider: z.string().min(1).default(DEFAULT_CHAT_PROVIDER),
  providers: z.array(chatProviderDescriptorSchema).default([]),
  models: z.array(modelDescriptorSchema).default([]),
});
export type ModelCatalog = z.infer<typeof modelCatalogSchema>;

export const agentKindSchema = z.enum(["chat", "orchestrator"]);
export type AgentKind = z.infer<typeof agentKindSchema>;

export const agentSummarySchema = z.object({
  id: z.string().min(1),
  kind: agentKindSchema.default("chat"),
  title: z.string().min(1),
  description: z.string().min(1),
  combinedPrompt: z.string().min(1),
  agentPath: z.string().min(1),
  defaultSoulPath: z.string().min(1),
  soulPath: z.string().optional(),
  historyRoot: z.string().min(1),
  workingMemoryRoot: z.string().min(1),
  skillRoot: z.string().min(1),
  skillNames: z.array(z.string()),
  sessionCount: z.number().int().nonnegative(),
});
export type AgentSummary = z.infer<typeof agentSummarySchema>;

export const senderSchema = z.enum(["user", "assistant", "system", "tool"]);
export type TurnSender = z.infer<typeof senderSchema>;

export const attachmentMediaTypeSchema = z.enum(["image", "text", "binary"]);
export type AttachmentMediaType = z.infer<typeof attachmentMediaTypeSchema>;

export const attachmentUploadSchema = z.object({
  name: z.string().trim().min(1),
  contentType: z.string().trim().min(1),
  size: z.number().int().nonnegative(),
  base64Data: z.string().min(1),
});
export type AttachmentUpload = z.infer<typeof attachmentUploadSchema>;

export const storedAttachmentSchema = z.object({
  attachmentId: z.string().min(1),
  name: z.string().min(1),
  contentType: z.string().min(1),
  size: z.number().int().nonnegative(),
  mediaType: attachmentMediaTypeSchema,
  relativePath: z.string().min(1),
});
export type StoredAttachment = z.infer<typeof storedAttachmentSchema>;

export const chatTurnSchema = z.object({
  messageId: z.string().min(1),
  sender: senderSchema,
  createdAt: z.string().min(1),
  bodyMarkdown: z.string(),
  relativePath: z.string().min(1),
  attachment: storedAttachmentSchema.optional(),
});
export type ChatTurn = z.infer<typeof chatTurnSchema>;

export const chatSessionSummarySchema = z.object({
  sessionId: z.string().min(1),
  agentId: z.string().min(1),
  title: z.string().min(1),
  startedAt: z.string().min(1),
  summary: z.string(),
  manifestPath: z.string().min(1),
  turnCount: z.number().int().nonnegative(),
  lastTurnAt: z.string().optional(),
  runtimeConfig: chatRuntimeConfigSchema.optional(),
  llmStats: llmSessionStatsSchema.optional(),
  premiumUsage: premiumUsageTotalsSchema.optional(),
  completionStatus: z.enum(["completed", "failed"]).optional(),
});
export type ChatSessionSummary = z.infer<typeof chatSessionSummarySchema>;

export const chatSessionSchema = chatSessionSummarySchema.extend({
  turns: z.array(chatTurnSchema),
});
export type ChatSession = z.infer<typeof chatSessionSchema>;

export const memoryEntrySchema = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
  title: z.string().min(1),
  path: z.string().min(1),
  scope: z.enum(["shared", "agent"]),
  agentId: z.string().optional(),
  tags: z.array(z.string()),
  topics: z.array(z.string()),
  updatedAt: z.string().optional(),
});
export type MemoryEntry = z.infer<typeof memoryEntrySchema>;

export const orchestratorJobStatusSchema = z.enum([
  "queued",
  "running",
  "completed",
  "failed",
]);
export type OrchestratorJobStatus = z.infer<typeof orchestratorJobStatusSchema>;

export const orchestratorSessionStatusSchema = z.enum([
  "idle",
  "running",
  "completed",
  "failed",
  "missing",
]);
export type OrchestratorSessionStatus = z.infer<
  typeof orchestratorSessionStatusSchema
>;

export const orchestratorPromptModeSchema = z.enum(["inline", "file"]);
export type OrchestratorPromptMode = z.infer<
  typeof orchestratorPromptModeSchema
>;

export const copilotCustomAgentSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string(),
  path: z.string().min(1),
});
export type CopilotCustomAgent = z.infer<typeof copilotCustomAgentSchema>;

export const orchestratorJobSchema = z.object({
  jobId: z.string().min(1),
  sessionId: z.string().min(1),
  promptPreview: z.string().min(1),
  promptMode: orchestratorPromptModeSchema,
  promptPath: z.string().min(1).optional(),
  attachment: storedAttachmentSchema.optional(),
  customAgentId: z.string().min(1).optional(),
  status: orchestratorJobStatusSchema,
  submittedAt: z.string().min(1),
  startedAt: z.string().min(1).optional(),
  completedAt: z.string().min(1).optional(),
  exitCode: z.number().int().optional(),
  premiumUsage: premiumUsageSchema.optional(),
  jobDirectory: z.string().min(1),
});
export type OrchestratorJob = z.infer<typeof orchestratorJobSchema>;

export const orchestratorSessionSummarySchema = z.object({
  sessionId: z.string().min(1),
  agentId: z.string().min(1),
  title: z.string().min(1),
  startedAt: z.string().min(1),
  updatedAt: z.string().min(1),
  summary: z.string(),
  projectPath: z.string().min(1),
  projectPurpose: z.string().min(1),
  model: z.string().min(1).default(DEFAULT_CHAT_MODEL),
  tmuxSessionName: z.string().min(1),
  tmuxWindowName: z.string().min(1),
  tmuxPaneId: z.string().min(1),
  status: orchestratorSessionStatusSchema,
  activeJobId: z.string().min(1).optional(),
  lastJobId: z.string().min(1).optional(),
  availableCustomAgents: z.array(copilotCustomAgentSchema).default([]),
  selectedCustomAgentId: z.string().min(1).optional(),
  premiumUsage: premiumUsageTotalsSchema.optional(),
  sessionDirectory: z.string().min(1),
  manifestPath: z.string().min(1),
});
export type OrchestratorSessionSummary = z.infer<
  typeof orchestratorSessionSummarySchema
>;

export const orchestratorSessionSchema =
  orchestratorSessionSummarySchema.extend({
    jobs: z.array(orchestratorJobSchema),
    terminalTail: z.string(),
    logSize: z.number().int().nonnegative(),
  });
export type OrchestratorSession = z.infer<typeof orchestratorSessionSchema>;

export const orchestratorCapabilitiesSchema = z.object({
  available: z.boolean(),
  defaultProjectPath: z.string().min(1),
  recentProjectPaths: z.array(z.string().min(1)).default([]),
  tmuxInstalled: z.boolean(),
  copilotInstalled: z.boolean(),
  tmuxSessionName: z.string().min(1),
});
export type OrchestratorCapabilities = z.infer<
  typeof orchestratorCapabilitiesSchema
>;

export const workspaceSummarySchema = z.object({
  storeRoot: z.string().min(1),
  copilotConfigDir: z.string().min(1),
  storeSkillDirectory: z.string().min(1),
  copilotSkillDirectory: z.string().min(1),
  agentCount: z.number().int().nonnegative(),
});
export type WorkspaceSummary = z.infer<typeof workspaceSummarySchema>;

export const chatRequestSchema = z.object({
  sessionId: z.string().min(1).optional(),
  title: z.string().min(1).optional(),
  prompt: z.string().default(""),
  config: chatRuntimeConfigSchema.optional(),
  attachment: attachmentUploadSchema.optional(),
});
export type ChatRequest = z.infer<typeof chatRequestSchema>;

export const chatResponseSchema = z.object({
  thread: chatSessionSchema,
  assistantTurn: chatTurnSchema,
});
export type ChatResponse = z.infer<typeof chatResponseSchema>;

export const orchestratorSessionCreateSchema = z.object({
  title: z.string().min(1).optional(),
  projectPath: z.string().min(1),
  projectPurpose: z.string().min(1),
  model: z.string().min(1).default(DEFAULT_CHAT_MODEL),
  selectedCustomAgentId: z.string().trim().min(1).nullable().optional(),
  prompt: z.string().min(1).optional(),
});
export type OrchestratorSessionCreateRequest = z.infer<
  typeof orchestratorSessionCreateSchema
>;

export const orchestratorSessionUpdateSchema = z.object({
  title: z.string().trim().min(1),
  model: z.string().trim().min(1),
  selectedCustomAgentId: z.string().trim().min(1).nullable().optional(),
});
export type OrchestratorSessionUpdateRequest = z.infer<
  typeof orchestratorSessionUpdateSchema
>;

export const orchestratorDelegateRequestSchema = z.object({
  prompt: z.string().default(""),
  customAgentId: z.string().trim().min(1).nullable().optional(),
  attachment: attachmentUploadSchema.optional(),
});
export type OrchestratorDelegateRequest = z.infer<
  typeof orchestratorDelegateRequestSchema
>;

export const orchestratorTerminalInputSchema = z.object({
  input: z.string(),
  submit: z.boolean().default(true),
});
export type OrchestratorTerminalInputRequest = z.infer<
  typeof orchestratorTerminalInputSchema
>;

export const memoryAnalysisRequestSchema = z.object({
  config: chatRuntimeConfigSchema.optional(),
  model: z.string().trim().min(1).optional(),
});
export type MemoryAnalysisRequest = z.infer<typeof memoryAnalysisRequestSchema>;

export const memoryTierSchema = z.enum(["working", "short-term", "long-term"]);
export type MemoryTier = z.infer<typeof memoryTierSchema>;

export const memoryAnalysisToolExecutionSchema = z.object({
  toolName: z.string().min(1),
  success: z.boolean(),
  content: z.string().optional(),
  memoryTier: memoryTierSchema.optional(),
});
export type MemoryAnalysisToolExecution = z.infer<
  typeof memoryAnalysisToolExecutionSchema
>;

export const memoryAnalysisTierSummarySchema = z.object({
  summary: z.string().default(""),
  items: z.array(z.string()).default([]),
});
export type MemoryAnalysisTierSummary = z.infer<
  typeof memoryAnalysisTierSummarySchema
>;

export const memoryAnalysisEntryChangeSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  path: z.string().min(1),
  status: z.enum(["added", "updated"]),
  tier: memoryTierSchema,
  updatedAt: z.string().optional(),
});
export type MemoryAnalysisEntryChange = z.infer<
  typeof memoryAnalysisEntryChangeSchema
>;

export const memoryAnalysisResponseSchema = z.object({
  markdown: z.string(),
  model: z.string().min(1),
  configuredMemorySkillNames: z.array(z.string()).default([]),
  enabledSkillNames: z.array(z.string()).default([]),
  loadedSkillNames: z.array(z.string()).default([]),
  invokedSkillNames: z.array(z.string()).default([]),
  toolExecutions: z.array(memoryAnalysisToolExecutionSchema).default([]),
  reportedLoadedSkills: z.boolean().default(false),
  analysisByTier: z.object({
    working: memoryAnalysisTierSummarySchema,
    shortTerm: memoryAnalysisTierSummarySchema,
    longTerm: memoryAnalysisTierSummarySchema,
  }),
  memoryChanges: z.object({
    working: z.array(memoryAnalysisEntryChangeSchema).default([]),
    shortTerm: z.array(memoryAnalysisEntryChangeSchema).default([]),
    longTerm: z.array(memoryAnalysisEntryChangeSchema).default([]),
  }),
});
export type MemoryAnalysisResponse = z.infer<
  typeof memoryAnalysisResponseSchema
>;

export const apiErrorSchema = z.object({
  error: z.string().min(1),
});
export type ApiError = z.infer<typeof apiErrorSchema>;
