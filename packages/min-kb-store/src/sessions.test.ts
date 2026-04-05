import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  deleteSession,
  getSession,
  recordSessionLlmUsage,
  resolveWorkspace,
  saveChatTurn,
} from "./index.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))
  );
});

describe("chat history persistence", () => {
  it("writes canonical manifests and immutable turn files", async () => {
    const root = await createStoreFixture();
    const workspace = await resolveWorkspace({ storeRoot: root });

    await saveChatTurn(workspace, {
      agentId: "coding-agent",
      title: "Release planning",
      sender: "user",
      bodyMarkdown: "Let's plan the release checklist.",
      createdAt: "2026-03-20T09:00:00Z",
    });

    const thread = await saveChatTurn(workspace, {
      agentId: "coding-agent",
      sessionId: "2026-03-20-release-planning",
      sender: "assistant",
      bodyMarkdown: "We should run the test suite first.",
      createdAt: "2026-03-20T09:01:00Z",
      summary: "Track release planning decisions.",
    });

    expect(thread.sessionId).toBe("2026-03-20-release-planning");
    expect(thread.turns).toHaveLength(2);
    expect(thread.summary).toBe("Track release planning decisions.");

    const manifestPath = path.join(
      root,
      "agents/coding-agent/history/2026-03/2026-03-20-release-planning/SESSION.md"
    );
    const manifest = await readFile(manifestPath, "utf8");
    expect(manifest).toContain("# Chat Session: Release planning");
    expect(manifest).toContain("Schema: opencode-chat-message-block-v1");
    expect(manifest).toContain("## Summary");

    const loaded = await getSession(
      workspace,
      "coding-agent",
      thread.sessionId
    );
    expect(loaded.turns[0]?.sender).toBe("user");
    expect(loaded.turns[1]?.sender).toBe("assistant");
    expect(loaded.turns[1]?.bodyMarkdown).toContain("test suite");
  });

  it("deletes a saved session directory", async () => {
    const root = await createStoreFixture();
    const workspace = await resolveWorkspace({ storeRoot: root });

    const thread = await saveChatTurn(workspace, {
      agentId: "coding-agent",
      title: "Release planning",
      sender: "user",
      bodyMarkdown: "Let's plan the release checklist.",
      createdAt: "2026-03-20T09:00:00Z",
    });

    await deleteSession(workspace, "coding-agent", thread.sessionId);

    await expect(
      getSession(workspace, "coding-agent", thread.sessionId)
    ).rejects.toThrow(/Session not found/);
  });

  it("persists aggregated llm stats for the chat session", async () => {
    const root = await createStoreFixture();
    const workspace = await resolveWorkspace({ storeRoot: root });

    const thread = await saveChatTurn(workspace, {
      agentId: "coding-agent",
      title: "Release planning",
      sender: "user",
      bodyMarkdown: "Let's plan the release checklist.",
      createdAt: "2026-03-20T09:00:00Z",
    });

    await recordSessionLlmUsage(workspace, "coding-agent", thread.sessionId, {
      recordedAt: "2026-03-20T09:00:01Z",
      model: "gpt-5.4",
      requestCount: 1,
      premiumRequestUnits: 2,
      inputTokens: 200,
      outputTokens: 80,
      cacheReadTokens: 20,
      cacheWriteTokens: 5,
      cost: 2,
      durationMs: 850,
      quotaSnapshots: {},
      tokenDetails: [],
      totalNanoAiu: 2_000,
    });
    await recordSessionLlmUsage(workspace, "coding-agent", thread.sessionId, {
      recordedAt: "2026-03-20T09:01:01Z",
      model: "gpt-5.4",
      requestCount: 1,
      premiumRequestUnits: 2,
      inputTokens: 140,
      outputTokens: 60,
      cacheReadTokens: 10,
      cacheWriteTokens: 0,
      cost: 2,
      durationMs: 650,
      quotaSnapshots: {
        premium: {
          isUnlimitedEntitlement: false,
          entitlementRequests: 300,
          usedRequests: 10,
          usageAllowedWithExhaustedQuota: false,
          overage: 0,
          overageAllowedWithExhaustedQuota: false,
          remainingPercentage: 0.97,
        },
      },
      tokenDetails: [],
      totalNanoAiu: 1_500,
    });

    const loaded = await getSession(
      workspace,
      "coding-agent",
      thread.sessionId
    );
    expect(loaded.llmStats).toEqual({
      requestCount: 2,
      premiumRequestUnits: 4,
      inputTokens: 340,
      outputTokens: 140,
      cacheReadTokens: 30,
      cacheWriteTokens: 5,
      totalCost: 4,
      totalDurationMs: 1500,
      totalNanoAiu: 3500,
      lastRecordedAt: "2026-03-20T09:01:01Z",
      lastModel: "gpt-5.4",
      quotaSnapshots: {
        premium: {
          isUnlimitedEntitlement: false,
          entitlementRequests: 300,
          usedRequests: 10,
          usageAllowedWithExhaustedQuota: false,
          overage: 0,
          overageAllowedWithExhaustedQuota: false,
          remainingPercentage: 0.97,
        },
      },
    });
  });

  it("reads persisted llm stats with normalized quota snapshots", async () => {
    const root = await createStoreFixture();
    const workspace = await resolveWorkspace({ storeRoot: root });

    const thread = await saveChatTurn(workspace, {
      agentId: "coding-agent",
      title: "Release planning",
      sender: "user",
      bodyMarkdown: "Let's plan the release checklist.",
      createdAt: "2026-03-20T09:00:00Z",
    });

    const statsPath = path.join(
      root,
      "agents/coding-agent/history/2026-03",
      thread.sessionId,
      "LLM_STATS.json"
    );
    await writeFile(
      statsPath,
      `${JSON.stringify(
        {
          requestCount: 1,
          premiumRequestUnits: 2,
          inputTokens: 200,
          outputTokens: 80,
          cacheReadTokens: 20,
          cacheWriteTokens: 5,
          totalCost: 2,
          totalDurationMs: 850,
          totalNanoAiu: 2_000,
          lastRecordedAt: "2026-03-20T09:00:01Z",
          lastModel: "gpt-5.4",
          quotaSnapshots: {
            chat: {
              isUnlimitedEntitlement: false,
              entitlementRequests: -3,
              usedRequests: 10,
              usageAllowedWithExhaustedQuota: false,
              overage: 0,
              overageAllowedWithExhaustedQuota: false,
              remainingPercentage: 96,
            },
          },
        },
        null,
        2
      )}\n`,
      "utf8"
    );

    const loaded = await getSession(
      workspace,
      "coding-agent",
      thread.sessionId
    );

    expect(loaded.llmStats?.quotaSnapshots).toEqual({
      chat: {
        isUnlimitedEntitlement: false,
        entitlementRequests: 0,
        usedRequests: 10,
        usageAllowedWithExhaustedQuota: false,
        overage: 0,
        overageAllowedWithExhaustedQuota: false,
        remainingPercentage: 0.96,
      },
    });
  });

  it("persists one attached file alongside a chat turn", async () => {
    const root = await createStoreFixture();
    const workspace = await resolveWorkspace({ storeRoot: root });

    const thread = await saveChatTurn(workspace, {
      agentId: "coding-agent",
      title: "Attachment review",
      sender: "user",
      bodyMarkdown: "Review the attached screenshot.",
      createdAt: "2026-03-20T09:00:00Z",
      attachment: {
        name: "screenshot.png",
        contentType: "image/png",
        size: 4,
        base64Data: Buffer.from("test").toString("base64"),
      },
    });

    const attachment = thread.turns[0]?.attachment;
    expect(attachment).toEqual(
      expect.objectContaining({
        name: "screenshot.png",
        contentType: "image/png",
        size: 4,
        mediaType: "image",
      })
    );

    const stored = await readFile(
      path.join(root, attachment?.relativePath ?? ""),
      "utf8"
    );
    expect(stored).toBe("test");
  });

  it("persists assistant thinking metadata separately from the visible body", async () => {
    const root = await createStoreFixture();
    const workspace = await resolveWorkspace({ storeRoot: root });

    await saveChatTurn(workspace, {
      agentId: "coding-agent",
      title: "Reasoning separation",
      sender: "user",
      bodyMarkdown: "Explain the incident.",
      createdAt: "2026-03-20T09:00:00Z",
    });

    const thread = await saveChatTurn(workspace, {
      agentId: "coding-agent",
      sessionId: "2026-03-20-reasoning-separation",
      sender: "assistant",
      bodyMarkdown: "The deploy stalled on a database lock.",
      thinkingMarkdown: "Compare the migration log with the deploy timeline.",
      createdAt: "2026-03-20T09:01:00Z",
    });

    expect(thread.turns[1]?.bodyMarkdown).toBe(
      "The deploy stalled on a database lock."
    );
    expect(thread.turns[1]?.thinkingMarkdown).toBe(
      "Compare the migration log with the deploy timeline."
    );

    const metadataPath = path.join(
      root,
      `${thread.turns[1]?.relativePath ?? ""}.json`
    );
    const metadata = JSON.parse(await readFile(metadataPath, "utf8")) as {
      thinkingMarkdown?: string;
    };
    expect(metadata.thinkingMarkdown).toBe(
      "Compare the migration log with the deploy timeline."
    );
  });
});

async function createStoreFixture(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "min-kb-app-store-"));
  roots.push(root);

  await mkdir(path.join(root, "agents/default"), { recursive: true });
  await mkdir(path.join(root, "agents/coding-agent/skills"), {
    recursive: true,
  });
  await mkdir(path.join(root, "memory/shared/long-term/2026"), {
    recursive: true,
  });
  await mkdir(path.join(root, "skills"), { recursive: true });

  await writeFile(
    path.join(root, "agents/default/SOUL.md"),
    `---\nid: "persona-default-core"\ntype: "persona"\ntitle: "Default persona layer"\n---\nDefault stance.\n`,
    "utf8"
  );
  await writeFile(
    path.join(root, "agents/coding-agent/AGENT.md"),
    `---\nid: "agent-coding-agent"\ntype: "agent"\ntitle: "Coding agent"\n---\n## Mission\n\nKeep code changes precise.\n`,
    "utf8"
  );
  await writeFile(
    path.join(root, "agents/coding-agent/SOUL.md"),
    `---\nid: "persona-coding-agent"\ntype: "persona"\ntitle: "Coding agent persona"\n---\nBe precise.\n`,
    "utf8"
  );

  return root;
}
