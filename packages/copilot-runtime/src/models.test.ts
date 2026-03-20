import type { ModelInfo } from "@github/copilot-sdk";
import { describe, expect, it } from "vitest";
import {
  FALLBACK_MODELS,
  inferModelProvider,
  mapModelInfoToDescriptor,
  mergeModelCatalogs,
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
    expect(inferModelProvider("gemini-3-pro-preview")).toBe("Google");
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
          supportedReasoningEfforts: ["medium", "high"],
          defaultReasoningEffort: "medium",
        })
      )
    ).toEqual({
      id: "gpt-5.4",
      displayName: "GPT-5.4",
      provider: "OpenAI",
      supportedReasoningEfforts: ["medium", "high"],
      defaultReasoningEffort: "medium",
    });
  });
});

describe("mergeModelCatalogs", () => {
  it("deduplicates entries and preserves richer metadata", () => {
    const merged = mergeModelCatalogs(
      [
        {
          id: "gpt-5.4",
          displayName: "GPT-5.4",
          provider: "OpenAI",
          supportedReasoningEfforts: [],
        },
      ],
      [
        {
          id: "gpt-5.4",
          displayName: "GPT-5.4",
          supportedReasoningEfforts: ["high", "medium", "high"],
          defaultReasoningEffort: "medium",
        },
      ]
    );

    expect(merged).toContainEqual({
      id: "gpt-5.4",
      displayName: "GPT-5.4",
      provider: "OpenAI",
      supportedReasoningEfforts: ["high", "medium"],
      defaultReasoningEffort: "medium",
    });
  });

  it("ships a fallback catalog that still includes the default model", () => {
    expect(FALLBACK_MODELS.some((model) => model.id === "gpt-5")).toBe(true);
    expect(
      FALLBACK_MODELS.some((model) => model.id === "claude-sonnet-4.6")
    ).toBe(true);
  });
});
