import { beforeEach, describe, expect, it, vi } from "vitest";
import { ChatRuntimeService } from "./index";

const createSessionMock = vi.fn();
const resumeSessionMock = vi.fn();
const listSessionsMock = vi.fn();
const listModelsMock = vi.fn();
const startMock = vi.fn();
const stopMock = vi.fn();

vi.mock("@github/copilot-sdk", () => ({
  approveAll: vi.fn(),
  CopilotClient: class {
    createSession = createSessionMock;
    resumeSession = resumeSessionMock;
    listSessions = listSessionsMock;
    listModels = listModelsMock;
    start = startMock;
    stop = stopMock;
  },
}));

vi.mock("@min-kb-app/min-kb-store", () => ({
  listAgents: vi.fn(async () => []),
  listSkillsForAgent: vi.fn(async () => []),
  pathExists: vi.fn(async () => false),
}));

function createMockSession(options?: {
  emitAfterSend?: (emit: (event: unknown) => void) => void;
}) {
  const listeners: Array<{
    eventType?: string;
    handler: (event: unknown) => void;
  }> = [];
  const emit = (event: unknown) => {
    for (const listener of listeners) {
      if (
        !listener.eventType ||
        (event as { type?: string }).type === listener.eventType
      ) {
        void listener.handler(event);
      }
    }
  };

  return {
    on: vi.fn((eventTypeOrHandler, maybeHandler) => {
      const handler =
        typeof eventTypeOrHandler === "function"
          ? eventTypeOrHandler
          : maybeHandler;
      const eventType =
        typeof eventTypeOrHandler === "string" ? eventTypeOrHandler : undefined;

      if (!handler) {
        return vi.fn();
      }

      listeners.push({ eventType, handler });
      return vi.fn();
    }),
    send: vi.fn(async () => {
      options?.emitAfterSend?.(emit);
      return "message-1";
    }),
    disconnect: vi.fn(async () => undefined),
  };
}

describe("ChatRuntimeService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    startMock.mockResolvedValue(undefined);
    stopMock.mockResolvedValue(undefined);
    listSessionsMock.mockResolvedValue([]);
    listModelsMock.mockResolvedValue([
      {
        id: "gpt-4.1",
        name: "GPT-4.1",
        capabilities: {
          supports: {
            vision: false,
            reasoningEffort: false,
          },
          limits: {
            max_context_window_tokens: 128_000,
          },
        },
        billing: {
          multiplier: 1,
        },
        supportedReasoningEfforts: [],
      },
    ]);
    createSessionMock.mockResolvedValue(
      createMockSession({
        emitAfterSend: (emit) => {
          emit({
            type: "assistant.usage",
            timestamp: "2026-03-20T09:00:01Z",
            data: {
              model: "gpt-4.1",
              inputTokens: 120,
              outputTokens: 45,
              cacheReadTokens: 10,
              cacheWriteTokens: 2,
              cost: 1,
              duration: 900,
              quotaSnapshots: {
                premium: {
                  isUnlimitedEntitlement: false,
                  entitlementRequests: 300,
                  usedRequests: 12,
                  usageAllowedWithExhaustedQuota: false,
                  overage: 0,
                  overageAllowedWithExhaustedQuota: false,
                  remainingPercentage: 0.96,
                },
              },
              copilotUsage: {
                tokenDetails: [
                  {
                    batchSize: 1_000,
                    costPerBatch: 1,
                    tokenCount: 120,
                    tokenType: "input",
                  },
                ],
                totalNanoAiu: 1_000,
              },
              reasoningEffort: "high",
            },
          });
          emit({
            type: "session.skills_loaded",
            data: {
              skills: [
                {
                  name: "memory-capture",
                  description: "Capture durable memory",
                  source: "project",
                  userInvocable: false,
                  enabled: true,
                  path: "/tmp/skills/memory-capture/SKILL.md",
                },
                {
                  name: "repo-search",
                  description: "Search the repo",
                  source: "project",
                  userInvocable: false,
                  enabled: false,
                  path: "/tmp/skills/repo-search/SKILL.md",
                },
              ],
            },
          });
          emit({
            type: "skill.invoked",
            data: {
              name: "memory-capture",
              path: "/tmp/skills/memory-capture/SKILL.md",
              content: "Remember important context.",
            },
          });
          emit({
            type: "tool.execution_start",
            data: {
              toolCallId: "tool-1",
              toolName: "write_memory",
              arguments: '{"tier":"long-term"}',
            },
          });
          emit({
            type: "tool.execution_complete",
            data: {
              toolCallId: "tool-1",
              success: true,
              result: {
                content: "Stored login redirect preference.",
              },
            },
          });
          emit({
            type: "assistant.message",
            data: {
              content: "stored memory analysis",
              interactionId: "interaction-1",
            },
          });
          emit({
            type: "session.idle",
            data: {},
            ephemeral: true,
          });
        },
      })
    );
    resumeSessionMock.mockResolvedValue(
      createMockSession({
        emitAfterSend: (emit) => {
          emit({
            type: "assistant.message",
            data: {
              content: "stored memory analysis",
            },
          });
          emit({
            type: "session.idle",
            data: {},
            ephemeral: true,
          });
        },
      })
    );
  });

  it("omits unsupported reasoning effort from Copilot session creation and returns sdk usage stats", async () => {
    const runtime = new ChatRuntimeService({
      storeRoot: "/tmp",
      agentsRoot: "/tmp/agents",
      skillsRoot: "/tmp/skills",
      copilotConfigDir: "/tmp/.copilot",
      copilotSkillsRoot: "/tmp/.copilot/skills",
      memoryRoot: "/tmp/memory",
    });

    const result = await runtime.sendMessage({
      agentId: "chat-agent",
      sessionId: "memory-session",
      prompt: "Review this chat for memory.",
      config: {
        provider: "copilot",
        model: "gpt-4.1",
        reasoningEffort: "high",
        disabledSkills: [],
        mcpServers: {},
      },
    });

    expect(createSessionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "memory-session",
        model: "gpt-4.1",
        reasoningEffort: undefined,
      })
    );
    expect(result.assistantText).toBe("stored memory analysis");
    expect(result.llmStats).toEqual({
      recordedAt: "2026-03-20T09:00:01Z",
      model: "gpt-4.1",
      requestCount: 1,
      premiumRequestUnits: 1,
      inputTokens: 120,
      outputTokens: 45,
      cacheReadTokens: 10,
      cacheWriteTokens: 2,
      cost: 1,
      durationMs: 900,
      reasoningEffort: "high",
      interactionId: "interaction-1",
      quotaSnapshots: {
        premium: {
          isUnlimitedEntitlement: false,
          entitlementRequests: 300,
          usedRequests: 12,
          usageAllowedWithExhaustedQuota: false,
          overage: 0,
          overageAllowedWithExhaustedQuota: false,
          remainingPercentage: 0.96,
        },
      },
      tokenDetails: [
        {
          batchSize: 1000,
          costPerBatch: 1,
          tokenCount: 120,
          tokenType: "input",
        },
      ],
      totalNanoAiu: 1000,
      initiator: undefined,
      apiCallId: undefined,
      providerCallId: undefined,
      parentToolCallId: undefined,
    });
    expect(result.sessionDiagnostics).toEqual({
      loadedSkills: [
        { name: "memory-capture", enabled: true },
        { name: "repo-search", enabled: false },
      ],
      invokedSkills: ["memory-capture"],
      toolExecutions: [
        {
          toolName: "write_memory",
          success: true,
          content: "Stored login redirect preference.",
          memoryTier: "long-term",
        },
      ],
      reportedLoadedSkills: true,
    });
  });

  it("resumes an existing Copilot session when the session id already exists", async () => {
    listSessionsMock.mockResolvedValue([{ sessionId: "memory-session" }]);
    const runtime = new ChatRuntimeService({
      storeRoot: "/tmp",
      agentsRoot: "/tmp/agents",
      skillsRoot: "/tmp/skills",
      copilotConfigDir: "/tmp/.copilot",
      copilotSkillsRoot: "/tmp/.copilot/skills",
      memoryRoot: "/tmp/memory",
    });

    const result = await runtime.sendMessage({
      agentId: "chat-agent",
      sessionId: "memory-session",
      prompt: "Continue reviewing this chat.",
      config: {
        provider: "copilot",
        model: "gpt-4.1",
        disabledSkills: [],
        mcpServers: {},
      },
    });

    expect(resumeSessionMock).toHaveBeenCalledWith(
      "memory-session",
      expect.objectContaining({
        sessionId: "memory-session",
        model: "gpt-4.1",
      })
    );
    expect(createSessionMock).not.toHaveBeenCalled();
    expect(result.assistantText).toBe("stored memory analysis");
  });

  it("routes LM Studio requests to the OpenAI-compatible endpoints and sends prior turns as chat history", async () => {
    const fetchMock = vi.fn();
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: [{ id: "qwen2.5-7b-instruct", owned_by: "lmstudio-community" }],
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        }
      )
    );
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          model: "qwen2.5-7b-instruct",
          created: 1_763_600_000,
          usage: {
            prompt_tokens: 18,
            completion_tokens: 7,
          },
          choices: [
            {
              message: {
                content: "Here is the local model response.",
              },
            },
          ],
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    const runtime = new ChatRuntimeService(
      {
        storeRoot: "/tmp",
        agentsRoot: "/tmp/agents",
        skillsRoot: "/tmp/skills",
        copilotConfigDir: "/tmp/.copilot",
        copilotSkillsRoot: "/tmp/.copilot/skills",
        memoryRoot: "/tmp/memory",
      },
      { lmStudioBaseUrl: "http://127.0.0.1:1234/v1" }
    );

    const result = await runtime.sendMessage({
      agentId: "chat-agent",
      sessionId: "local-session",
      prompt: "Summarize the latest issue.",
      conversation: [
        {
          sender: "user",
          bodyMarkdown: "What broke in production?",
        },
        {
          sender: "assistant",
          bodyMarkdown: "The deploy stalled waiting for a migration lock.",
        },
      ],
      config: {
        provider: "lmstudio",
        model: "qwen2.5-7b-instruct",
        disabledSkills: ["memory-capture"],
        mcpServers: {
          ignored: {
            type: "http",
            url: "https://example.test/mcp",
            headers: {},
            tools: ["*"],
          },
        },
      },
    });

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "http://127.0.0.1:1234/v1/models"
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "http://127.0.0.1:1234/v1/chat/completions",
      expect.objectContaining({
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: "qwen2.5-7b-instruct",
          messages: [
            { role: "user", content: "What broke in production?" },
            {
              role: "assistant",
              content: "The deploy stalled waiting for a migration lock.",
            },
            { role: "user", content: "Summarize the latest issue." },
          ],
          stream: false,
        }),
      })
    );
    expect(result.assistantText).toBe("Here is the local model response.");
    expect(result.llmStats).toEqual(
      expect.objectContaining({
        model: "qwen2.5-7b-instruct",
        requestCount: 1,
        inputTokens: 18,
        outputTokens: 7,
        cost: 0,
      })
    );
    expect(result.sessionDiagnostics).toBeUndefined();
  });
});
