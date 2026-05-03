import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildOrchestratorWindowName,
  createOrchestratorJob,
  createOrchestratorSession,
  deleteOrchestratorJob,
  deleteOrchestratorSession,
  discoverCopilotCustomAgents,
  getDefaultOrchestratorCustomAgentId,
  getOrchestratorSession,
  IMPLEMENTATION_ORCHESTRATOR_CUSTOM_AGENT_ID,
  ORCHESTRATOR_SESSION_TAIL_LINE_LIMIT,
  readOrchestratorTerminalHistoryChunk,
  resolveWorkspace,
  toOrchestratorChatSummary,
  updateOrchestratorSession,
  writeOrchestratorJobCompletion,
} from "./index.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))
  );
});

describe("orchestrator session persistence", () => {
  it("stores orchestrator state inside the agent history tree", async () => {
    const root = await createStoreFixture();
    const workspace = await resolveWorkspace({
      storeRoot: root,
      copilotConfigDir: path.join(root, ".copilot-home"),
    });

    const created = await createOrchestratorSession(workspace, {
      title: "Fix auth flow",
      projectPath: root,
      projectPurpose: "Repair the authentication redirect",
      model: "claude-sonnet-4.6",
      tmuxSessionName: "min-kb-app-orchestrator",
      tmuxWindowName: "orchestrator-auth-fix-a1b2",
      tmuxPaneId: "%42",
      startedAt: "2026-03-20T12:00:00Z",
    });

    expect(created.sessionDirectory).toContain(
      path.join(
        "agents",
        "copilot-orchestrator",
        "history",
        "2026-03",
        "2026-03-20-fix-auth-flow"
      )
    );
    expect(created.manifestPath).toBe(
      "agents/copilot-orchestrator/history/2026-03/2026-03-20-fix-auth-flow/SESSION.md"
    );
    expect(created.model).toBe("claude-sonnet-4.6");
    expect(created.executionMode).toBe("standard");
    expect(created.availableCustomAgents).toEqual([]);
    expect(created.premiumUsage).toEqual({
      chargedRequestCount: 0,
      premiumRequestUnits: 0,
    });
  });

  it("derives completed job status from DONE.json", async () => {
    const root = await createStoreFixture();
    const workspace = await resolveWorkspace({
      storeRoot: root,
      copilotConfigDir: path.join(root, ".copilot-home"),
    });
    const created = await createOrchestratorSession(workspace, {
      title: "Fix auth flow",
      projectPath: root,
      projectPurpose: "Repair the authentication redirect",
      model: "gpt-5.4",
      tmuxSessionName: "min-kb-app-orchestrator",
      tmuxWindowName: "orchestrator-auth-fix-a1b2",
      tmuxPaneId: "%42",
      startedAt: "2026-03-20T12:00:00Z",
    });

    const job = await createOrchestratorJob(workspace, created.sessionId, {
      prompt: "Investigate the redirect loop",
      promptPreview: "Investigate the redirect loop",
      promptMode: "inline",
      submittedAt: "2026-03-20T12:01:00Z",
    });
    await writeOrchestratorJobCompletion(
      workspace,
      created.sessionId,
      job.jobId,
      {
        exitCode: 0,
        completedAt: "2026-03-20T12:02:00Z",
      }
    );

    const session = await getOrchestratorSession(workspace, created.sessionId);
    expect(session.jobs).toHaveLength(1);
    expect(session.jobs[0]?.prompt).toBe("Investigate the redirect loop");
    expect(session.jobs[0]?.status).toBe("completed");
    expect(session.jobs[0]?.exitCode).toBe(0);
  });

  it("rewrites the manifest when session metadata changes", async () => {
    const root = await createStoreFixture();
    const workspace = await resolveWorkspace({
      storeRoot: root,
      copilotConfigDir: path.join(root, ".copilot-home"),
    });
    const created = await createOrchestratorSession(workspace, {
      title: "Fix auth flow",
      projectPath: root,
      projectPurpose: "Repair the authentication redirect",
      model: "gpt-5.4",
      tmuxSessionName: "min-kb-app-orchestrator",
      tmuxWindowName: "orchestrator-auth-fix-a1b2",
      tmuxPaneId: "%42",
      startedAt: "2026-03-20T12:00:00Z",
    });

    await updateOrchestratorSession(workspace, created.sessionId, {
      title: "Platform support",
      model: "claude-sonnet-4.6",
      executionMode: "fleet",
    });

    const session = await getOrchestratorSession(workspace, created.sessionId);
    const manifest = await readFile(
      path.join(created.sessionDirectory, "SESSION.md"),
      "utf8"
    );

    expect(session.title).toBe("Platform support");
    expect(session.model).toBe("claude-sonnet-4.6");
    expect(session.executionMode).toBe("fleet");
    expect(manifest).toContain("# Orchestrator Session: Platform support");
    expect(manifest).toContain("Model: claude-sonnet-4.6");
    expect(manifest).toContain("Execution Mode: fleet");
    expect(manifest).toContain("Selected Custom Agent: none");
  });

  it("creates clearly named tmux window names", () => {
    const windowName = buildOrchestratorWindowName(
      "Investigate huge regression",
      "/tmp/some-super-long-project-name",
      "2026-03-20-investigate-huge-regression"
    );

    expect(windowName.length).toBeLessThanOrEqual(28);
    expect(windowName).toContain("some-super-long-project-name".slice(0, 4));
  });

  it("marks terminal orchestrator sessions in chat summaries", () => {
    const summary = toOrchestratorChatSummary({
      sessionId: "2026-03-20-release-support",
      agentId: "copilot-orchestrator",
      title: "Release support",
      startedAt: "2026-03-20T12:00:00Z",
      updatedAt: "2026-03-20T12:05:00Z",
      summary: "Ship the release",
      projectPath: "/tmp/project",
      projectPurpose: "Ship the release",
      model: "gpt-5.4",
      tmuxSessionName: "min-kb-app-orchestrator",
      tmuxWindowName: "project-release-support-0001",
      tmuxPaneId: "%42",
      status: "completed",
      activeJobId: undefined,
      lastJobId: "job-1",
      availableCustomAgents: [],
      selectedCustomAgentId: undefined,
      executionMode: "standard",
      sessionDirectory: "/tmp/session",
      manifestPath:
        "agents/copilot-orchestrator/history/2026-03/2026-03-20-release-support/SESSION.md",
    });

    expect(summary.summary).toContain("Completed");
    expect(summary.completionStatus).toBe("completed");
  });

  it("discovers Copilot custom agents from the target project folder", async () => {
    const root = await createStoreFixture();
    await mkdir(path.join(root, ".github/agents"), { recursive: true });
    await writeFile(
      path.join(root, ".github/agents/reviewer.agent.md"),
      [
        "---",
        "name: PR Reviewer",
        "description: Reviews changes before merge.",
        "---",
        "",
        "Review every important code change.",
        "",
      ].join("\n"),
      "utf8"
    );

    const agents = await discoverCopilotCustomAgents(root);

    expect(agents).toEqual([
      {
        id: "reviewer",
        name: "PR Reviewer",
        description: "Reviews changes before merge.",
        path: ".github/agents/reviewer.agent.md",
      },
    ]);
  });

  it("prefers the implementation orchestrator custom agent when available", () => {
    expect(
      getDefaultOrchestratorCustomAgentId([
        {
          id: "engineer",
          name: "Engineer",
          description: "Implements changes.",
          path: ".github/agents/engineer.agent.md",
        },
        {
          id: IMPLEMENTATION_ORCHESTRATOR_CUSTOM_AGENT_ID,
          name: "Implementation Orchestrator",
          description: "Coordinates the delivery workflow.",
          path: `.github/agents/${IMPLEMENTATION_ORCHESTRATOR_CUSTOM_AGENT_ID}.agent.md`,
        },
      ])
    ).toBe(IMPLEMENTATION_ORCHESTRATOR_CUSTOM_AGENT_ID);
  });

  it("deletes queued jobs from persisted session history", async () => {
    const root = await createStoreFixture();
    const workspace = await resolveWorkspace({
      storeRoot: root,
      copilotConfigDir: path.join(root, ".copilot-home"),
    });
    const created = await createOrchestratorSession(workspace, {
      title: "Fix auth flow",
      projectPath: root,
      projectPurpose: "Repair the authentication redirect",
      model: "gpt-5.4",
      tmuxSessionName: "min-kb-app-orchestrator",
      tmuxWindowName: "orchestrator-auth-fix-a1b2",
      tmuxPaneId: "%42",
      startedAt: "2026-03-20T12:00:00Z",
    });
    const job = await createOrchestratorJob(workspace, created.sessionId, {
      promptPreview: "Investigate the redirect loop",
      promptMode: "inline",
      submittedAt: "2026-03-20T12:01:00Z",
    });

    await deleteOrchestratorJob(workspace, created.sessionId, job.jobId);

    const session = await getOrchestratorSession(workspace, created.sessionId);
    expect(session.jobs).toHaveLength(0);
  });

  it("persists one attached file for delegated jobs", async () => {
    const root = await createStoreFixture();
    const workspace = await resolveWorkspace({
      storeRoot: root,
      copilotConfigDir: path.join(root, ".copilot-home"),
    });
    const created = await createOrchestratorSession(workspace, {
      title: "Inspect assets",
      projectPath: root,
      projectPurpose: "Inspect the attached asset",
      model: "gpt-5.4",
      tmuxSessionName: "min-kb-app-orchestrator",
      tmuxWindowName: "orchestrator-assets-a1b2",
      tmuxPaneId: "%42",
      startedAt: "2026-03-20T12:00:00Z",
    });

    const job = await createOrchestratorJob(workspace, created.sessionId, {
      promptPreview: "Inspect the attached asset",
      promptMode: "file",
      attachment: {
        name: "asset.png",
        contentType: "image/png",
        size: 4,
        base64Data: Buffer.from("test").toString("base64"),
      },
      submittedAt: "2026-03-20T12:01:00Z",
    });

    expect(job.attachment).toEqual(
      expect.objectContaining({
        name: "asset.png",
        contentType: "image/png",
        size: 4,
        mediaType: "image",
      })
    );

    const stored = await readFile(
      path.join(root, job.attachment?.relativePath ?? ""),
      "utf8"
    );
    expect(stored).toBe("test");
  });

  it("deletes an orchestrator session directory", async () => {
    const root = await createStoreFixture();
    const workspace = await resolveWorkspace({
      storeRoot: root,
      copilotConfigDir: path.join(root, ".copilot-home"),
    });
    const created = await createOrchestratorSession(workspace, {
      title: "Fix auth flow",
      projectPath: root,
      projectPurpose: "Repair the authentication redirect",
      model: "gpt-5.4",
      tmuxSessionName: "min-kb-app-orchestrator",
      tmuxWindowName: "orchestrator-auth-fix-a1b2",
      tmuxPaneId: "%42",
      startedAt: "2026-03-20T12:00:00Z",
    });

    await deleteOrchestratorSession(workspace, created.sessionId);

    await expect(
      getOrchestratorSession(workspace, created.sessionId)
    ).rejects.toThrow(/not found/);
  });

  it("returns only the most recent 200 tmux log lines in session payloads", async () => {
    const root = await createStoreFixture();
    const workspace = await resolveWorkspace({
      storeRoot: root,
      copilotConfigDir: path.join(root, ".copilot-home"),
    });
    const created = await createOrchestratorSession(workspace, {
      title: "Fix auth flow",
      projectPath: root,
      projectPurpose: "Repair the authentication redirect",
      model: "gpt-5.4",
      tmuxSessionName: "min-kb-app-orchestrator",
      tmuxWindowName: "orchestrator-auth-fix-a1b2",
      tmuxPaneId: "%42",
      startedAt: "2026-03-20T12:00:00Z",
    });
    const logPath = path.join(created.sessionDirectory, "terminal", "pane.log");
    const logLines = Array.from(
      { length: 2_500 },
      (_, index) => `line ${index + 1}`
    );
    await writeFile(logPath, `${logLines.join("\n")}\n`, "utf8");

    const session = await getOrchestratorSession(workspace, created.sessionId);

    expect(session.logSize).toBeGreaterThan(session.terminalTail.length);
    expect(session.terminalTail.split("\n").filter(Boolean)).toHaveLength(
      ORCHESTRATOR_SESSION_TAIL_LINE_LIMIT
    );
    expect(session.terminalTail).toContain(
      `line ${2_500 - ORCHESTRATOR_SESSION_TAIL_LINE_LIMIT + 1}`
    );
    expect(session.terminalTail).not.toContain(
      `line ${2_500 - ORCHESTRATOR_SESSION_TAIL_LINE_LIMIT}`
    );
    expect(session.terminalTail).toContain("line 2500");
  });

  it("reads older tmux log history in 2000-line chunks", async () => {
    const root = await createStoreFixture();
    const workspace = await resolveWorkspace({
      storeRoot: root,
      copilotConfigDir: path.join(root, ".copilot-home"),
    });
    const created = await createOrchestratorSession(workspace, {
      title: "Fix auth flow",
      projectPath: root,
      projectPurpose: "Repair the authentication redirect",
      model: "gpt-5.4",
      tmuxSessionName: "min-kb-app-orchestrator",
      tmuxWindowName: "orchestrator-auth-fix-a1b2",
      tmuxPaneId: "%42",
      startedAt: "2026-03-20T12:00:00Z",
    });
    const logPath = path.join(created.sessionDirectory, "terminal", "pane.log");
    const logLines = Array.from(
      { length: 2_500 },
      (_, index) => `line ${index + 1}`
    );
    const fullLog = `${logLines.join("\n")}\n`;
    await writeFile(logPath, fullLog, "utf8");

    const recentSession = await getOrchestratorSession(
      workspace,
      created.sessionId
    );
    const beforeOffset =
      Buffer.byteLength(fullLog) -
      Buffer.byteLength(recentSession.terminalTail);
    const chunk = await readOrchestratorTerminalHistoryChunk(
      workspace,
      created.sessionId,
      beforeOffset
    );
    const olderChunk = await readOrchestratorTerminalHistoryChunk(
      workspace,
      created.sessionId,
      chunk.startOffset
    );

    expect(chunk.startOffset).toBeGreaterThan(0);
    expect(chunk.endOffset).toBe(beforeOffset);
    expect(chunk.hasMoreBefore).toBe(true);
    expect(chunk.lineCount).toBe(2_000);
    expect(chunk.chunk).toContain(
      `line ${2_500 - ORCHESTRATOR_SESSION_TAIL_LINE_LIMIT - 2_000 + 1}`
    );
    expect(chunk.chunk).toContain(
      `line ${2_500 - ORCHESTRATOR_SESSION_TAIL_LINE_LIMIT}`
    );
    expect(chunk.chunk).not.toContain(
      `line ${2_500 - ORCHESTRATOR_SESSION_TAIL_LINE_LIMIT + 1}`
    );

    expect(olderChunk.startOffset).toBe(0);
    expect(olderChunk.endOffset).toBe(chunk.startOffset);
    expect(olderChunk.hasMoreBefore).toBe(false);
    expect(olderChunk.lineCount).toBe(
      2_500 - ORCHESTRATOR_SESSION_TAIL_LINE_LIMIT - 2_000
    );
    expect(olderChunk.chunk).toContain("line 1");
    expect(olderChunk.chunk).toContain("line 300");
    expect(olderChunk.chunk).not.toContain("line 301");
  });
});

async function createStoreFixture(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "min-kb-app-orch-"));
  roots.push(root);

  await mkdir(path.join(root, "agents/default"), { recursive: true });
  await mkdir(path.join(root, "memory/shared"), { recursive: true });
  await mkdir(path.join(root, "skills"), { recursive: true });

  await writeFile(
    path.join(root, "agents/default/SOUL.md"),
    `---\nid: "persona-default-core"\ntype: "persona"\ntitle: "Default persona layer"\n---\nStay concise.\n`,
    "utf8"
  );

  return root;
}
