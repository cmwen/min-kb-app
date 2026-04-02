import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  listMemoryEntries,
  resolveWorkspace,
  writeMemoryAnalysisFallbackEntries,
} from "./index.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))
  );
});

describe("writeMemoryAnalysisFallbackEntries", () => {
  it("persists working and shared memory tiers for a session", async () => {
    const root = await createStoreFixture();
    const workspace = await resolveWorkspace({
      storeRoot: root,
      copilotConfigDir: path.join(root, ".copilot-home"),
    });

    const writes = await writeMemoryAnalysisFallbackEntries(workspace, {
      agentId: "support-agent",
      sessionId: "incident-123",
      sessionTitle: "Incident 123",
      analyzedAt: "2026-03-26T00:00:00.000Z",
      analysisByTier: {
        working: {
          summary: "Keep the deployment owner visible during the rollback.",
          items: ["Ping the on-call engineer before retrying the deploy"],
        },
        shortTerm: {
          summary: "Revisit the rollback checklist tomorrow morning.",
          items: [],
        },
        longTerm: {
          summary: "",
          items: ["The user prefers blue-green deploys for risky changes"],
        },
      },
    });

    expect(writes).toEqual([
      expect.objectContaining({
        tier: "working",
        status: "added",
      }),
      expect.objectContaining({
        tier: "short-term",
        status: "added",
      }),
      expect.objectContaining({
        tier: "long-term",
        status: "added",
      }),
    ]);

    const entries = await listMemoryEntries(workspace, {
      agentId: "support-agent",
    });
    expect(entries.map((entry) => entry.title)).toEqual(
      expect.arrayContaining([
        "Working memory for Incident 123",
        "Short-term memory for Incident 123",
        "Long-term memory for Incident 123",
      ])
    );

    const longTermPath = writes.find(
      (write) => write.tier === "long-term"
    )?.path;
    expect(longTermPath).toContain(
      "/memory/shared/long-term/2026/support-agent-incident-123.md"
    );
    expect(await readFile(longTermPath ?? "", "utf8")).toContain(
      "The user prefers blue-green deploys for risky changes"
    );
  });

  it("updates existing fallback memory files for the same session", async () => {
    const root = await createStoreFixture();
    const workspace = await resolveWorkspace({
      storeRoot: root,
      copilotConfigDir: path.join(root, ".copilot-home"),
    });

    await writeMemoryAnalysisFallbackEntries(workspace, {
      agentId: "support-agent",
      sessionId: "incident-123",
      sessionTitle: "Incident 123",
      analyzedAt: "2026-03-26T00:00:00.000Z",
      analysisByTier: {
        working: { summary: "Keep the rollback owner visible.", items: [] },
        shortTerm: { summary: "", items: [] },
        longTerm: { summary: "", items: [] },
      },
    });

    const writes = await writeMemoryAnalysisFallbackEntries(workspace, {
      agentId: "support-agent",
      sessionId: "incident-123",
      sessionTitle: "Incident 123",
      analyzedAt: "2026-03-26T00:05:00.000Z",
      analysisByTier: {
        working: { summary: "Keep the rollback owner visible.", items: [] },
        shortTerm: { summary: "", items: [] },
        longTerm: {
          summary: "Remember the preferred rollback owner for this incident.",
          items: [],
        },
      },
    });

    expect(writes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          tier: "working",
          status: "updated",
        }),
        expect.objectContaining({
          tier: "long-term",
          status: "added",
        }),
      ])
    );
  });
});

async function createStoreFixture(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "min-kb-app-memory-"));
  roots.push(root);

  await Promise.all([
    mkdir(path.join(root, "agents"), { recursive: true }),
    mkdir(path.join(root, "memory"), { recursive: true }),
    mkdir(path.join(root, "skills"), { recursive: true }),
    mkdir(path.join(root, ".copilot-home"), { recursive: true }),
  ]);

  return root;
}
