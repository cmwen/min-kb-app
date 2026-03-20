import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildOrchestratorWindowName,
  createOrchestratorJob,
  createOrchestratorSession,
  getOrchestratorSession,
  resolveWorkspace,
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
    });

    const session = await getOrchestratorSession(workspace, created.sessionId);
    const manifest = await readFile(
      path.join(created.sessionDirectory, "SESSION.md"),
      "utf8"
    );

    expect(session.title).toBe("Platform support");
    expect(session.model).toBe("claude-sonnet-4.6");
    expect(manifest).toContain("# Orchestrator Session: Platform support");
    expect(manifest).toContain("Model: claude-sonnet-4.6");
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
