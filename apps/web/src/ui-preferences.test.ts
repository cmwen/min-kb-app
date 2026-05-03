import type { ModelDescriptor } from "@min-kb-app/shared";
import { describe, expect, it } from "vitest";
import {
  clampOrchestratorTerminalHeight,
  clampSidebarWidth,
  getVisibleModels,
  MAX_ORCHESTRATOR_TERMINAL_HEIGHT,
  MAX_SIDEBAR_WIDTH,
  MIN_ORCHESTRATOR_TERMINAL_HEIGHT,
  MIN_SIDEBAR_WIDTH,
  resolveTheme,
} from "./ui-preferences";

const MODELS: ModelDescriptor[] = [
  {
    id: "gpt-5",
    displayName: "GPT-5",
    runtimeProvider: "copilot",
    supportedReasoningEfforts: ["medium", "high"],
  },
  {
    id: "claude-sonnet-4.6",
    displayName: "Claude Sonnet 4.6",
    runtimeProvider: "copilot",
    provider: "Anthropic",
    supportedReasoningEfforts: [],
  },
];

describe("ui-preferences", () => {
  it("clamps the sidebar width to the supported range", () => {
    expect(clampSidebarWidth(MIN_SIDEBAR_WIDTH - 50)).toBe(MIN_SIDEBAR_WIDTH);
    expect(clampSidebarWidth(MAX_SIDEBAR_WIDTH + 50)).toBe(MAX_SIDEBAR_WIDTH);
  });

  it("clamps the orchestrator terminal height to the supported range", () => {
    expect(clampOrchestratorTerminalHeight(120)).toBe(
      MIN_ORCHESTRATOR_TERMINAL_HEIGHT
    );
    expect(clampOrchestratorTerminalHeight(960)).toBe(
      MAX_ORCHESTRATOR_TERMINAL_HEIGHT
    );
  });

  it("keeps the selected model visible even when hidden from the picker", () => {
    const visibleModels = getVisibleModels(
      MODELS,
      ["claude-sonnet-4.6"],
      "claude-sonnet-4.6"
    );
    expect(visibleModels.map((model) => model.id)).toEqual([
      "gpt-5",
      "claude-sonnet-4.6",
    ]);
  });

  it("resolves the system theme to light or dark", () => {
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
    expect(resolveTheme("light", true)).toBe("light");
  });

  it("normalizes saved chat default model preferences", async () => {
    const { normalizeUiPreferences } = await import("./ui-preferences");
    expect(
      normalizeUiPreferences({
        defaultChatProvider: "lmstudio",
        defaultChatModelId: "qwen2.5-7b-instruct",
      })
    ).toMatchObject({
      defaultChatProvider: "lmstudio",
      defaultChatModelId: "qwen2.5-7b-instruct",
    });
  });

  it("normalizes task completion notification preferences", async () => {
    const { normalizeUiPreferences } = await import("./ui-preferences");
    expect(
      normalizeUiPreferences({
        completionNotifications: {
          enabled: false,
          minimumDurationMinutes: 0.4,
          disabledAgentIds: ["support-agent", "support-agent", 42 as never],
        },
      })
    ).toMatchObject({
      completionNotifications: {
        enabled: false,
        minimumDurationMinutes: 1,
        disabledAgentIds: ["support-agent"],
      },
    });
  });
});
