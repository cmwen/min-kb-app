import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { getSession, resolveWorkspace, saveChatTurn } from "./index.js";

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
