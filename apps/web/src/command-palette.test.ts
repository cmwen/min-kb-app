import type { AgentSummary, ChatSessionSummary } from "@min-kb-app/shared";
import { describe, expect, it } from "vitest";
import {
  buildCommandPaletteItems,
  filterCommandPaletteItems,
} from "./command-palette";

const AGENTS: AgentSummary[] = [
  {
    id: "planner",
    kind: "chat",
    title: "Planner",
    description: "Plans work",
    combinedPrompt: "prompt",
    agentPath: "/tmp/planner.md",
    defaultSoulPath: "/tmp/soul.md",
    historyRoot: "/tmp/history",
    workingMemoryRoot: "/tmp/memory",
    skillRoot: "/tmp/skills",
    skillNames: [],
    sessionCount: 1,
  },
  {
    id: "researcher",
    kind: "chat",
    title: "Researcher",
    description: "Finds context",
    combinedPrompt: "prompt",
    agentPath: "/tmp/researcher.md",
    defaultSoulPath: "/tmp/soul.md",
    historyRoot: "/tmp/history",
    workingMemoryRoot: "/tmp/memory",
    skillRoot: "/tmp/skills",
    skillNames: [],
    sessionCount: 1,
  },
];

const SESSIONS: Record<string, ChatSessionSummary[]> = {
  planner: [
    {
      sessionId: "roadmap",
      agentId: "planner",
      title: "Roadmap review",
      startedAt: "2026-03-18T10:00:00.000Z",
      summary: "Discuss the quarterly roadmap.",
      manifestPath: "/tmp/roadmap",
      turnCount: 3,
      lastTurnAt: "2026-03-20T09:00:00.000Z",
    },
  ],
  researcher: [
    {
      sessionId: "benchmarks",
      agentId: "researcher",
      title: "Benchmark notes",
      startedAt: "2026-03-15T10:00:00.000Z",
      summary: "Collect the benchmark data.",
      manifestPath: "/tmp/benchmarks",
      turnCount: 4,
      lastTurnAt: "2026-03-19T09:00:00.000Z",
    },
  ],
};

describe("command palette helpers", () => {
  it("builds action, agent, and chat items with recent chats first", () => {
    const items = buildCommandPaletteItems({
      agents: AGENTS,
      sessionsByAgent: SESSIONS,
      sidebarCollapsed: false,
      selectedAgentId: "planner",
      selectedSessionId: "roadmap",
    });

    expect(items.slice(0, 4).map((item) => item.kind)).toEqual([
      "action",
      "action",
      "action",
      "action",
    ]);
    expect(items.at(-2)?.id).toBe("session:planner:roadmap");
    expect(items.at(-1)?.id).toBe("session:researcher:benchmarks");
  });

  it("filters items by keywords and labels", () => {
    const items = buildCommandPaletteItems({
      agents: AGENTS,
      sessionsByAgent: SESSIONS,
      sidebarCollapsed: true,
      selectedAgentId: "planner",
    });

    const filtered = filterCommandPaletteItems(items, "roadmap planner");
    expect(filtered.map((item) => item.id)).toContain(
      "session:planner:roadmap"
    );
  });
});
