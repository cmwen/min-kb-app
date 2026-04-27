import type { ModelInfo } from "@github/copilot-sdk";
import { DEFAULT_CHAT_MODEL } from "@min-kb-app/shared";
import { describe, expect, it } from "vitest";
import {
  COPILOT_RUNTIME_PROVIDER,
  FALLBACK_MODELS,
  findModelDescriptor,
  getModelsForProvider,
  inferModelProvider,
  LM_STUDIO_RUNTIME_PROVIDER,
  mapLmStudioModelToDescriptor,
  mapModelInfoToDescriptor,
  mergeModelCatalogs,
  normalizeConfigForModel,
} from "./models";

function buildModelInfo(overrides: Partial<ModelInfo>): ModelInfo {
  return {
    id: overrides.id ?? "gpt-5",
    name: overrides.name ?? "GPT-5",
    capabilities: overrides.capabilities ?? {
      supports: {
        vision: false,
        reasoningEffort: false,
      },
      limits: {
        max_context_window_tokens: 128_000,
      },
    },
    policy: overrides.policy,
    billing: overrides.billing,
    supportedReasoningEfforts: overrides.supportedReasoningEfforts,
    defaultReasoningEffort: overrides.defaultReasoningEffort,
  };
}

describe("inferModelProvider", () => {
  it("maps well-known model families", () => {
    expect(inferModelProvider("claude-sonnet-4.5")).toBe("Anthropic");
    expect(inferModelProvider("gemini-3.1-pro-preview")).toBe("Google");
    expect(inferModelProvider("grok-code-fast-1")).toBe("xAI");
    expect(inferModelProvider("gpt-5.4")).toBe("OpenAI");
  });
});

describe("mapModelInfoToDescriptor", () => {
  it("keeps reasoning metadata from the SDK", () => {
    expect(
      mapModelInfoToDescriptor(
        buildModelInfo({
          id: "gpt-5.4",
          name: "GPT-5.4",
          billing: {
            multiplier: 3,
          },
          supportedReasoningEfforts: ["medium", "high"],
          defaultReasoningEffort: "medium",
        })
      )
    ).toEqual({
      id: "gpt-5.4",
      displayName: "GPT-5.4",
      runtimeProvider: COPILOT_RUNTIME_PROVIDER.id,
      provider: "OpenAI",
      premiumRequestMultiplier: 3,
      supportedReasoningEfforts: ["medium", "high"],
      defaultReasoningEffort: "medium",
    });
  });
});

describe("mapLmStudioModelToDescriptor", () => {
  it("tags LM Studio models with the runtime provider id", () => {
    expect(
      mapLmStudioModelToDescriptor({
        id: "qwen2.5-7b-instruct",
        owned_by: "lmstudio-community",
      })
    ).toEqual({
      id: "qwen2.5-7b-instruct",
      displayName: "qwen2.5-7b-instruct",
      runtimeProvider: LM_STUDIO_RUNTIME_PROVIDER.id,
      provider: "lmstudio-community",
      supportedReasoningEfforts: [],
    });
  });
});

describe("LM_STUDIO_RUNTIME_PROVIDER", () => {
  it("exposes prompt-backed skill support without MCP wiring", () => {
    expect(LM_STUDIO_RUNTIME_PROVIDER.capabilities).toEqual({
      supportsReasoningEffort: false,
      supportsSkills: true,
      supportsMcpServers: false,
    });
  });
});

describe("findModelDescriptor", () => {
  it("returns the matching model entry for the selected provider", () => {
    expect(
      findModelDescriptor(
        [
          {
            id: "gpt-4.1",
            displayName: "GPT-4.1",
            runtimeProvider: COPILOT_RUNTIME_PROVIDER.id,
            provider: "OpenAI",
            supportedReasoningEfforts: [],
          },
          {
            id: "gpt-4.1",
            displayName: "GPT-4.1 local",
            runtimeProvider: LM_STUDIO_RUNTIME_PROVIDER.id,
            supportedReasoningEfforts: [],
          },
        ],
        "gpt-4.1",
        LM_STUDIO_RUNTIME_PROVIDER.id
      )
    ).toEqual({
      id: "gpt-4.1",
      displayName: "GPT-4.1 local",
      runtimeProvider: LM_STUDIO_RUNTIME_PROVIDER.id,
      supportedReasoningEfforts: [],
    });
  });
});

describe("getModelsForProvider", () => {
  it("filters a mixed catalog by runtime provider", () => {
    expect(
      getModelsForProvider(
        [
          {
            id: "gpt-5",
            displayName: "GPT-5",
            runtimeProvider: COPILOT_RUNTIME_PROVIDER.id,
            supportedReasoningEfforts: [],
          },
          {
            id: "llama-3.1",
            displayName: "llama-3.1",
            runtimeProvider: LM_STUDIO_RUNTIME_PROVIDER.id,
            supportedReasoningEfforts: [],
          },
        ],
        LM_STUDIO_RUNTIME_PROVIDER.id
      )
    ).toEqual([
      {
        id: "llama-3.1",
        displayName: "llama-3.1",
        runtimeProvider: LM_STUDIO_RUNTIME_PROVIDER.id,
        supportedReasoningEfforts: [],
      },
    ]);
  });
});

describe("normalizeConfigForModel", () => {
  it("keeps supported reasoning effort", () => {
    expect(
      normalizeConfigForModel(
        {
          provider: COPILOT_RUNTIME_PROVIDER.id,
          model: "gpt-5.4",
          reasoningEffort: "high",
          disabledSkills: [],
          mcpServers: {},
        },
        [
          {
            id: "gpt-5.4",
            displayName: "GPT-5.4",
            runtimeProvider: COPILOT_RUNTIME_PROVIDER.id,
            provider: "OpenAI",
            supportedReasoningEfforts: ["medium", "high"],
          },
        ]
      )
    ).toEqual({
      provider: COPILOT_RUNTIME_PROVIDER.id,
      model: "gpt-5.4",
      reasoningEffort: "high",
      disabledSkills: [],
      mcpServers: {},
    });
  });

  it("switches to the first model available for the selected provider", () => {
    expect(
      normalizeConfigForModel(
        {
          provider: LM_STUDIO_RUNTIME_PROVIDER.id,
          model: "gpt-5",
          reasoningEffort: "high",
          disabledSkills: ["memory-capture"],
          mcpServers: {},
        },
        [
          {
            id: "gpt-5",
            displayName: "GPT-5",
            runtimeProvider: COPILOT_RUNTIME_PROVIDER.id,
            supportedReasoningEfforts: ["high"],
          },
          {
            id: "qwen2.5-7b-instruct",
            displayName: "qwen2.5-7b-instruct",
            runtimeProvider: LM_STUDIO_RUNTIME_PROVIDER.id,
            supportedReasoningEfforts: [],
          },
        ]
      )
    ).toEqual({
      provider: LM_STUDIO_RUNTIME_PROVIDER.id,
      model: "qwen2.5-7b-instruct",
      reasoningEffort: undefined,
      disabledSkills: ["memory-capture"],
      mcpServers: {},
    });
  });
});

describe("mergeModelCatalogs", () => {
  it("deduplicates entries by runtime provider and preserves richer metadata", () => {
    const merged = mergeModelCatalogs(
      [
        {
          id: "gpt-5.4",
          displayName: "GPT-5.4",
          runtimeProvider: COPILOT_RUNTIME_PROVIDER.id,
          provider: "OpenAI",
          premiumRequestMultiplier: 3,
          supportedReasoningEfforts: [],
        },
      ],
      [
        {
          id: "gpt-5.4",
          displayName: "GPT-5.4",
          runtimeProvider: COPILOT_RUNTIME_PROVIDER.id,
          supportedReasoningEfforts: ["high", "medium", "high"],
          defaultReasoningEffort: "medium",
        },
        {
          id: "gpt-5.4",
          displayName: "GPT-5.4 local",
          runtimeProvider: LM_STUDIO_RUNTIME_PROVIDER.id,
          supportedReasoningEfforts: [],
        },
      ]
    );

    expect(merged).toContainEqual({
      id: "gpt-5.4",
      displayName: "GPT-5.4",
      runtimeProvider: COPILOT_RUNTIME_PROVIDER.id,
      provider: "OpenAI",
      premiumRequestMultiplier: 3,
      supportedReasoningEfforts: ["high", "medium"],
      defaultReasoningEffort: "medium",
    });
    expect(merged).toContainEqual({
      id: "gpt-5.4",
      displayName: "GPT-5.4 local",
      provider: "OpenAI",
      runtimeProvider: LM_STUDIO_RUNTIME_PROVIDER.id,
      supportedReasoningEfforts: [],
    });
  });

  it("ships a fallback catalog that still includes the default model", () => {
    expect(
      FALLBACK_MODELS.some(
        (model) =>
          model.id === DEFAULT_CHAT_MODEL &&
          model.runtimeProvider === COPILOT_RUNTIME_PROVIDER.id
      )
    ).toBe(true);
    expect(
      FALLBACK_MODELS.some((model) => model.id === "claude-sonnet-4.6")
    ).toBe(true);
    expect(FALLBACK_MODELS.some((model) => model.id === "gpt-5.2")).toBe(true);
    expect(FALLBACK_MODELS.some((model) => model.id === "gpt-5")).toBe(false);
    expect(
      FALLBACK_MODELS.some((model) => model.id === "gpt-5.1-codex-mini")
    ).toBe(false);
    expect(
      FALLBACK_MODELS.some((model) => model.id === "claude-opus-4.6")
    ).toBe(false);
    expect(
      FALLBACK_MODELS.find((model) => model.id === "gpt-5-mini")
        ?.premiumRequestMultiplier
    ).toBe(0);
    expect(
      FALLBACK_MODELS.filter((model) => model.runtimeProvider === "gemini").map(
        (model) => model.id
      )
    ).toEqual([
      "gemini-3-flash-preview",
      "gemini-3.1-pro-preview",
      "gemini-2.5-flash",
      "gemini-2.5-pro",
    ]);
  });
});
