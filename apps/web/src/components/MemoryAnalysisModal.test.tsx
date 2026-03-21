// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { MemoryAnalysisModal } from "./MemoryAnalysisModal";

afterEach(() => {
  cleanup();
});

describe("MemoryAnalysisModal", () => {
  it("shows a loading message while analysis is running", () => {
    render(<MemoryAnalysisModal open loading onClose={() => undefined} />);

    expect(
      screen.queryByText(
        "Analyzing memory and waiting for the runtime to report what changed..."
      )
    ).not.toBeNull();
  });

  it("shows skill and tool diagnostics once analysis completes", () => {
    render(
      <MemoryAnalysisModal
        open
        result={{
          markdown:
            "## Long-term memory\n\nStored the user's preferred login flow.",
          model: "gpt-5-mini",
          configuredMemorySkillNames: ["memory-capture"],
          enabledSkillNames: ["memory-capture"],
          loadedSkillNames: ["memory-capture", "repo-search"],
          invokedSkillNames: ["memory-capture"],
          toolExecutions: [
            {
              toolName: "write_memory",
              success: true,
              content: "Stored the login flow preference.",
              memoryTier: "long-term",
            },
          ],
          reportedLoadedSkills: true,
          analysisByTier: {
            working: {
              summary: "Keep the deployment owner visible during the rollout.",
              items: [],
            },
            shortTerm: {
              summary: "",
              items: ["Check again after tomorrow's deploy"],
            },
            longTerm: {
              summary: "Stored the user's preferred login flow.",
              items: [],
            },
          },
          memoryChanges: {
            working: [],
            shortTerm: [],
            longTerm: [
              {
                id: "login-flow",
                title: "Login flow preference",
                path: "/tmp/memory/shared/long-term/login-flow.md",
                status: "added",
                tier: "long-term",
              },
            ],
          },
        }}
        onClose={() => undefined}
      />
    );

    expect(screen.queryByText("Memory updates were reported")).not.toBeNull();
    expect(screen.queryByText("memory-capture, repo-search")).not.toBeNull();
    expect(
      screen.queryByText("Stored the login flow preference.")
    ).not.toBeNull();
    expect(screen.queryByText("Succeeded · long-term")).not.toBeNull();
    expect(
      screen.queryAllByText("Stored the user's preferred login flow.").length
    ).toBeGreaterThan(0);
    expect(screen.queryByText("Login flow preference")).not.toBeNull();
  });

  it("shows a warning when runtime skill loading diagnostics are missing", () => {
    render(
      <MemoryAnalysisModal
        open
        result={{
          markdown:
            "## Long-term memory\n\nRecommended storing the project goal.",
          model: "gpt-5-mini",
          configuredMemorySkillNames: ["memory-capture"],
          enabledSkillNames: [],
          loadedSkillNames: [],
          invokedSkillNames: [],
          toolExecutions: [],
          reportedLoadedSkills: false,
          analysisByTier: {
            working: { summary: "", items: [] },
            shortTerm: { summary: "", items: [] },
            longTerm: {
              summary: "Recommended storing the project goal.",
              items: [],
            },
          },
          memoryChanges: {
            working: [],
            shortTerm: [],
            longTerm: [],
          },
        }}
        onClose={() => undefined}
      />
    );

    expect(
      screen.queryByText("No skill loading diagnostics were reported")
    ).not.toBeNull();
    expect(
      screen.queryByText("Skill loading diagnostics were missing")
    ).not.toBeNull();
  });
});
