import type { ModelDescriptor } from "@min-kb-app/shared";
import { describe, expect, it } from "vitest";
import {
  clampSidebarWidth,
  getVisibleModels,
  MAX_SIDEBAR_WIDTH,
  MIN_SIDEBAR_WIDTH,
  resolveTheme,
} from "./ui-preferences";

const MODELS: ModelDescriptor[] = [
  {
    id: "gpt-5",
    displayName: "GPT-5",
    supportedReasoningEfforts: ["medium", "high"],
  },
  {
    id: "claude-sonnet-4.6",
    displayName: "Claude Sonnet 4.6",
    provider: "Anthropic",
    supportedReasoningEfforts: [],
  },
];

describe("ui-preferences", () => {
  it("clamps the sidebar width to the supported range", () => {
    expect(clampSidebarWidth(MIN_SIDEBAR_WIDTH - 50)).toBe(MIN_SIDEBAR_WIDTH);
    expect(clampSidebarWidth(MAX_SIDEBAR_WIDTH + 50)).toBe(MAX_SIDEBAR_WIDTH);
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
});
