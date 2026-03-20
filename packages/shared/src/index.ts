import { z } from "zod";

export const DEFAULT_CHAT_MODEL = "gpt-5";

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
  model: z.string().min(1).default(DEFAULT_CHAT_MODEL),
  reasoningEffort: reasoningEffortSchema.optional(),
  disabledSkills: z.array(z.string()).default([]),
  mcpServers: z.record(z.string(), mcpServerConfigSchema).default({}),
});
export type ChatRuntimeConfig = z.infer<typeof chatRuntimeConfigSchema>;

export const modelDescriptorSchema = z.object({
  id: z.string().min(1),
  displayName: z.string().min(1),
  provider: z.string().optional(),
  supportedReasoningEfforts: z.array(reasoningEffortSchema).default([]),
  defaultReasoningEffort: reasoningEffortSchema.optional(),
});
export type ModelDescriptor = z.infer<typeof modelDescriptorSchema>;

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

export const chatTurnSchema = z.object({
  messageId: z.string().min(1),
  sender: senderSchema,
  createdAt: z.string().min(1),
  bodyMarkdown: z.string(),
  relativePath: z.string().min(1),
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

export const orchestratorJobSchema = z.object({
  jobId: z.string().min(1),
  sessionId: z.string().min(1),
  promptPreview: z.string().min(1),
  promptMode: orchestratorPromptModeSchema,
  promptPath: z.string().min(1).optional(),
  status: orchestratorJobStatusSchema,
  submittedAt: z.string().min(1),
  startedAt: z.string().min(1).optional(),
  completedAt: z.string().min(1).optional(),
  exitCode: z.number().int().optional(),
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
  prompt: z.string().min(1),
  config: chatRuntimeConfigSchema.optional(),
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
  prompt: z.string().min(1).optional(),
});
export type OrchestratorSessionCreateRequest = z.infer<
  typeof orchestratorSessionCreateSchema
>;

export const orchestratorSessionUpdateSchema = z.object({
  title: z.string().trim().min(1),
  model: z.string().trim().min(1),
});
export type OrchestratorSessionUpdateRequest = z.infer<
  typeof orchestratorSessionUpdateSchema
>;

export const orchestratorDelegateRequestSchema = z.object({
  prompt: z.string().min(1),
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
});
export type MemoryAnalysisRequest = z.infer<typeof memoryAnalysisRequestSchema>;

export const memoryAnalysisResponseSchema = z.object({
  markdown: z.string(),
  model: z.string().min(1),
  enabledSkillNames: z.array(z.string()).default([]),
});
export type MemoryAnalysisResponse = z.infer<
  typeof memoryAnalysisResponseSchema
>;

export const apiErrorSchema = z.object({
  error: z.string().min(1),
});
export type ApiError = z.infer<typeof apiErrorSchema>;
