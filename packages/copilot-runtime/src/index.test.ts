import { beforeEach, describe, expect, it, vi } from "vitest";
import { ChatRuntimeService } from "./index";

const { getAgentByIdMock, loadEnabledSkillDocumentsForAgentMock } = vi.hoisted(
  () => ({
    getAgentByIdMock: vi.fn(),
    loadEnabledSkillDocumentsForAgentMock: vi.fn(),
  })
);
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
  getAgentById: getAgentByIdMock,
  listAgents: vi.fn(async () => []),
  listSkillsForAgent: vi.fn(async () => []),
  loadEnabledSkillDocumentsForAgent: loadEnabledSkillDocumentsForAgentMock,
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
    getAgentByIdMock.mockResolvedValue(undefined);
    loadEnabledSkillDocumentsForAgentMock.mockResolvedValue([]);
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

  it("merges agent runtime MCP defaults with request overrides before opening a Copilot session", async () => {
    getAgentByIdMock.mockResolvedValue({
      id: "researcher",
      kind: "chat",
      title: "Researcher",
      description: "Researches topics.",
      combinedPrompt: "Research carefully.",
      agentPath: "/tmp/agents/researcher/AGENT.md",
      defaultSoulPath: "/tmp/agents/default/SOUL.md",
      historyRoot: "/tmp/agents/researcher/history",
      workingMemoryRoot: "/tmp/agents/researcher/memory/working",
      skillRoot: "/tmp/agents/researcher/skills",
      skillNames: [],
      sessionCount: 0,
      runtimeConfig: {
        provider: "copilot",
        model: "gpt-4.1",
        disabledSkills: ["memory-capture"],
        mcpServers: {
          playwright: {
            type: "stdio",
            command: "npx",
            args: ["@playwright/mcp@latest", "--headless"],
            env: {},
            tools: ["*"],
          },
        },
      },
    });
    const runtime = new ChatRuntimeService({
      storeRoot: "/tmp",
      agentsRoot: "/tmp/agents",
      skillsRoot: "/tmp/skills",
      copilotConfigDir: "/tmp/.copilot",
      copilotSkillsRoot: "/tmp/.copilot/skills",
      memoryRoot: "/tmp/memory",
    });

    await runtime.sendMessage({
      agentId: "researcher",
      sessionId: "research-session",
      prompt: "Find recent MCP examples.",
      config: {
        provider: "copilot",
        model: "gpt-4.1",
        mcpServers: {
          github: {
            type: "http",
            url: "https://api.githubcopilot.com/mcp/",
            headers: {},
            tools: ["*"],
          },
        },
      },
    });

    expect(createSessionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        disabledSkills: ["memory-capture"],
        mcpServers: {
          playwright: {
            type: "stdio",
            command: "npx",
            args: ["@playwright/mcp@latest", "--headless"],
            env: {},
            tools: ["*"],
          },
          github: {
            type: "http",
            url: "https://api.githubcopilot.com/mcp/",
            headers: {},
            tools: ["*"],
          },
        },
      })
    );
  });

  it("routes LM Studio requests to the OpenAI-compatible endpoints with agent instructions and enabled skills", async () => {
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
    getAgentByIdMock.mockResolvedValue({
      id: "chat-agent",
      kind: "chat",
      title: "Chat agent",
      description: "Handles local chat tasks.",
      combinedPrompt: "Follow the local support workflow carefully.",
      agentPath: "/tmp/agents/chat-agent/AGENT.md",
      defaultSoulPath: "/tmp/agents/default/SOUL.md",
      historyRoot: "/tmp/agents/chat-agent/history",
      workingMemoryRoot: "/tmp/agents/chat-agent/memory/working",
      skillRoot: "/tmp/agents/chat-agent/skills",
      skillNames: ["memory-capture", "repo-search"],
      sessionCount: 0,
    });
    loadEnabledSkillDocumentsForAgentMock.mockResolvedValue([
      {
        name: "repo-search",
        description: "Search the repo",
        scope: "agent-local",
        path: "/tmp/agents/chat-agent/skills/repo-search/SKILL.md",
        sourceRoot: "/tmp/agents/chat-agent/skills",
        content: "Search the repository before answering code questions.",
      },
    ]);

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
      "http://127.0.0.1:1234/v1/models",
      expect.objectContaining({
        signal: expect.any(AbortSignal),
      })
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "http://127.0.0.1:1234/v1/chat/completions",
      expect.objectContaining({
        method: "POST",
        headers: { "content-type": "application/json" },
        signal: expect.any(AbortSignal),
        body: JSON.stringify({
          model: "qwen2.5-7b-instruct",
          messages: [
            {
              role: "system",
              content: [
                "You are running through LM Studio inside min-kb-app.",
                "Do not claim to have used MCP servers, tools, or external resources unless their results already appear in the conversation.",
                "Skills selected for this run are provided below as live operating instructions. Apply them when they are relevant instead of describing them as unavailable metadata. If a skill calls for tools, commands, MCP servers, or external systems, only rely on results already present in the conversation and clearly state when something still needs to be run outside this LM Studio response.",
                "## Agent instructions\n\nFollow the local support workflow carefully.",
                "## Enabled skills\n\n### repo-search\n- Scope: agent-local\n- Description: Search the repo\n\nSearch the repository before answering code questions.",
              ].join("\n\n"),
            },
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
    expect(loadEnabledSkillDocumentsForAgentMock).toHaveBeenCalledWith(
      expect.anything(),
      "chat-agent",
      ["memory-capture"]
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
    expect(result.sessionDiagnostics).toEqual({
      loadedSkills: [{ name: "repo-search", enabled: true }],
      invokedSkills: [],
      toolExecutions: [],
      reportedLoadedSkills: true,
    });
  });

  it("strips qwen-style thinking tags from LM Studio string responses", async () => {
    const fetchMock = vi.fn();
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: [{ id: "qwen3.5-32b", owned_by: "lmstudio-community" }],
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
          model: "qwen3.5-32b",
          created: 1_763_600_000,
          usage: {
            prompt_tokens: 18,
            completion_tokens: 7,
          },
          choices: [
            {
              message: {
                content:
                  "<think>\nNeed to reason step by step.\n</think>\n\nHere is the visible answer.",
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
      sessionId: "qwen-thinking-session",
      prompt: "Answer the question.",
      config: {
        provider: "lmstudio",
        model: "qwen3.5-32b",
        disabledSkills: [],
        mcpServers: {},
      },
    });

    expect(result.assistantText).toBe("Here is the visible answer.");
  });

  it("drops thinking content parts from LM Studio array responses", async () => {
    const fetchMock = vi.fn();
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: [{ id: "qwen3.5-32b", owned_by: "lmstudio-community" }],
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
          model: "qwen3.5-32b",
          created: 1_763_600_000,
          usage: {
            prompt_tokens: 18,
            completion_tokens: 7,
          },
          choices: [
            {
              message: {
                content: [
                  {
                    type: "thinking",
                    thinking: "Need to reason step by step.",
                  },
                  {
                    type: "text",
                    text: "Here is the visible answer.",
                  },
                ],
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
      sessionId: "qwen-thinking-parts-session",
      prompt: "Answer the question.",
      config: {
        provider: "lmstudio",
        model: "qwen3.5-32b",
        disabledSkills: [],
        mcpServers: {},
      },
    });

    expect(result.assistantText).toBe("Here is the visible answer.");
  });

  it("strips repeated leading thinking blocks from LM Studio responses", async () => {
    const fetchMock = vi.fn();
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: [{ id: "qwen3.5-32b", owned_by: "lmstudio-community" }],
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
          model: "qwen3.5-32b",
          created: 1_763_600_000,
          usage: {
            prompt_tokens: 18,
            completion_tokens: 7,
          },
          choices: [
            {
              message: {
                content:
                  "<think>First hidden block.</think>\n<reasoning>Second hidden block.</reasoning>\nVisible answer.",
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
      sessionId: "qwen-multiple-thinking-blocks",
      prompt: "Answer the question.",
      config: {
        provider: "lmstudio",
        model: "qwen3.5-32b",
        disabledSkills: [],
        mcpServers: {},
      },
    });

    expect(result.assistantText).toBe("Visible answer.");
  });

  it("surfaces a clear timeout error when LM Studio is too slow to reply", async () => {
    vi.useFakeTimers();
    process.env.MIN_KB_APP_LM_STUDIO_CHAT_TIMEOUT_MS = "5";
    const fetchMock = vi.fn((_input: string, init?: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(new DOMException("The operation was aborted", "AbortError"));
        });
      });
    });
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: [{ id: "qwen2.5-7b-instruct" }],
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

    const sendPromise = runtime.sendMessage({
      agentId: "chat-agent",
      sessionId: "slow-local-session",
      prompt: "Take your time.",
      config: {
        provider: "lmstudio",
        model: "qwen2.5-7b-instruct",
        disabledSkills: [],
        mcpServers: {},
      },
    });
    const rejection = expect(sendPromise).rejects.toThrow(
      "LM Studio chat request timed out after 5ms."
    );
    await vi.advanceTimersByTimeAsync(10);
    await rejection;

    delete process.env.MIN_KB_APP_LM_STUDIO_CHAT_TIMEOUT_MS;
    vi.useRealTimers();
  });

  it("falls back to accumulated assistant deltas when the final assistant message is missing", async () => {
    createSessionMock.mockResolvedValueOnce(
      createMockSession({
        emitAfterSend: (emit) => {
          emit({
            type: "assistant.message_delta",
            data: {
              messageId: "message-1",
              deltaContent: "Weekly summary: ",
            },
            ephemeral: true,
          });
          emit({
            type: "assistant.message_delta",
            data: {
              messageId: "message-1",
              deltaContent: "three completed tasks.",
            },
            ephemeral: true,
          });
          emit({
            type: "session.idle",
            data: {},
            ephemeral: true,
          });
        },
      })
    );

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
      sessionId: "delta-only-session",
      prompt: "Summarize the past week.",
      config: {
        provider: "copilot",
        model: "gpt-4.1",
        disabledSkills: [],
        mcpServers: {},
      },
    });

    expect(result.assistantText).toBe("Weekly summary: three completed tasks.");
  });

  it("prefers a newer delta-only reply over an earlier assistant status message", async () => {
    createSessionMock.mockResolvedValueOnce(
      createMockSession({
        emitAfterSend: (emit) => {
          emit({
            type: "assistant.message",
            data: {
              content:
                "I’m going to jump further down the Amazon HTML instead of repeating the top of the page.",
            },
          });
          emit({
            type: "assistant.message_delta",
            data: {
              messageId: "message-2",
              deltaContent: "Here are three compatible stylus options ",
            },
            ephemeral: true,
          });
          emit({
            type: "assistant.message_delta",
            data: {
              messageId: "message-2",
              deltaContent: "with links and prices.",
            },
            ephemeral: true,
          });
          emit({
            type: "session.idle",
            data: {},
            ephemeral: true,
          });
        },
      })
    );

    const runtime = new ChatRuntimeService({
      storeRoot: "/tmp",
      agentsRoot: "/tmp/agents",
      skillsRoot: "/tmp/skills",
      copilotConfigDir: "/tmp/.copilot",
      copilotSkillsRoot: "/tmp/.copilot/skills",
      memoryRoot: "/tmp/memory",
    });

    const result = await runtime.sendMessage({
      agentId: "researcher",
      sessionId: "delta-after-status-session",
      prompt: "Find Bluetooth stylus options with Amazon links and prices.",
      config: {
        provider: "copilot",
        model: "gpt-4.1",
        disabledSkills: [],
        mcpServers: {},
      },
    });

    expect(result.assistantText).toBe(
      "Here are three compatible stylus options with links and prices."
    );
  });

  it("waits for tool execution that starts after an initial assistant message", async () => {
    createSessionMock.mockResolvedValueOnce(
      createMockSession({
        emitAfterSend: (emit) => {
          emit({
            type: "assistant.message",
            data: {
              content:
                "I’m pulling the last week’s Logseq journal entries now.",
            },
          });
          setTimeout(() => {
            emit({
              type: "tool.execution_start",
              data: {
                toolCallId: "tool-2",
                toolName: "read_logseq",
                arguments: '{"range":"last-week"}',
              },
            });
            emit({
              type: "tool.execution_complete",
              data: {
                toolCallId: "tool-2",
                success: true,
                result: {
                  content: "Loaded seven daily notes.",
                },
              },
            });
            emit({
              type: "assistant.message",
              data: {
                content:
                  "Last week you captured seven daily notes focused on planning, bugs, and follow-ups.",
              },
            });
            emit({
              type: "session.idle",
              data: {},
              ephemeral: true,
            });
          }, 1700);
        },
      })
    );

    const runtime = new ChatRuntimeService({
      storeRoot: "/tmp",
      agentsRoot: "/tmp/agents",
      skillsRoot: "/tmp/skills",
      copilotConfigDir: "/tmp/.copilot",
      copilotSkillsRoot: "/tmp/.copilot/skills",
      memoryRoot: "/tmp/memory",
    });

    const result = await runtime.sendMessage({
      agentId: "logseq",
      sessionId: "logseq-summary-session",
      prompt: "Summarize Logseq for the past week.",
      config: {
        provider: "copilot",
        model: "gpt-4.1",
        disabledSkills: [],
        mcpServers: {},
      },
    });

    expect(result.assistantText).toBe(
      "Last week you captured seven daily notes focused on planning, bugs, and follow-ups."
    );
    expect(result.sessionDiagnostics?.toolExecutions).toEqual([
      {
        toolName: "read_logseq",
        success: true,
        content: "Loaded seven daily notes.",
        memoryTier: undefined,
      },
    ]);
  });

  it("returns an empty assistant message instead of throwing when Copilot settles without content", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    createSessionMock.mockResolvedValueOnce(
      createMockSession({
        emitAfterSend: (emit) => {
          emit({
            type: "session.idle",
            data: {},
            ephemeral: true,
          });
        },
      })
    );

    const runtime = new ChatRuntimeService({
      storeRoot: "/tmp",
      agentsRoot: "/tmp/agents",
      skillsRoot: "/tmp/skills",
      copilotConfigDir: "/tmp/.copilot",
      copilotSkillsRoot: "/tmp/.copilot/skills",
      memoryRoot: "/tmp/memory",
    });

    await expect(
      runtime.sendMessage({
        agentId: "chat-agent",
        sessionId: "idle-only-session",
        prompt: "Summarize the past week.",
        config: {
          provider: "copilot",
          model: "gpt-4.1",
          disabledSkills: [],
          mcpServers: {},
        },
      })
    ).resolves.toMatchObject({
      assistantText: "",
    });
    expect(warnSpy).toHaveBeenCalledWith(
      "Copilot completed without returning assistant text; saving an empty assistant turn."
    );
    warnSpy.mockRestore();
  });

  it("waits briefly after session.idle so a trailing assistant message is captured", async () => {
    createSessionMock.mockResolvedValueOnce(
      createMockSession({
        emitAfterSend: (emit) => {
          emit({
            type: "session.idle",
            data: {},
            ephemeral: true,
          });
          setTimeout(() => {
            emit({
              type: "assistant.message",
              data: {
                content: "Bluetooth stylus options loaded from Amazon results.",
              },
            });
          }, 10);
        },
      })
    );

    const runtime = new ChatRuntimeService({
      storeRoot: "/tmp",
      agentsRoot: "/tmp/agents",
      skillsRoot: "/tmp/skills",
      copilotConfigDir: "/tmp/.copilot",
      copilotSkillsRoot: "/tmp/.copilot/skills",
      memoryRoot: "/tmp/memory",
    });

    await expect(
      runtime.sendMessage({
        agentId: "researcher",
        sessionId: "idle-before-message-session",
        prompt: "Find Bluetooth stylus options.",
        config: {
          provider: "copilot",
          model: "gpt-4.1",
          disabledSkills: [],
          mcpServers: {},
        },
      })
    ).resolves.toMatchObject({
      assistantText: "Bluetooth stylus options loaded from Amazon results.",
    });
  });

  it("surfaces a trailing session error instead of saving an empty assistant turn", async () => {
    createSessionMock.mockResolvedValueOnce(
      createMockSession({
        emitAfterSend: (emit) => {
          emit({
            type: "session.idle",
            data: {},
            ephemeral: true,
          });
          setTimeout(() => {
            emit({
              type: "session.error",
              data: {
                message:
                  "Playwright MCP server failed before the assistant replied.",
                stack: "Error: Playwright MCP server failed",
              },
            });
          }, 10);
        },
      })
    );

    const runtime = new ChatRuntimeService({
      storeRoot: "/tmp",
      agentsRoot: "/tmp/agents",
      skillsRoot: "/tmp/skills",
      copilotConfigDir: "/tmp/.copilot",
      copilotSkillsRoot: "/tmp/.copilot/skills",
      memoryRoot: "/tmp/memory",
    });

    await expect(
      runtime.sendMessage({
        agentId: "researcher",
        sessionId: "idle-before-error-session",
        prompt: "Find Bluetooth stylus options.",
        config: {
          provider: "copilot",
          model: "gpt-4.1",
          disabledSkills: [],
          mcpServers: {},
        },
      })
    ).rejects.toThrow(
      "Playwright MCP server failed before the assistant replied."
    );
  });
});
