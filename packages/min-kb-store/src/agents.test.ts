import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { getAgentById, listSkillsForAgent, resolveWorkspace } from "./index.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))
  );
});

describe("agent loading", () => {
  it("prefers agent-local skills over store and copilot global skills", async () => {
    const root = await createStoreFixture();
    const copilotConfigDir = path.join(root, ".copilot-home");
    await mkdir(path.join(copilotConfigDir, "skills/shared-skill"), {
      recursive: true,
    });
    await writeFile(
      path.join(copilotConfigDir, "skills/shared-skill/SKILL.md"),
      "---\nname: shared-skill\ndescription: Copilot global version\n---\nGlobal skill\n",
      "utf8"
    );
    await mkdir(path.join(root, "skills/shared-skill"), { recursive: true });
    await writeFile(
      path.join(root, "skills/shared-skill/SKILL.md"),
      "---\nname: shared-skill\ndescription: Store global version\n---\nStore skill\n",
      "utf8"
    );
    await mkdir(path.join(root, "agents/coding-agent/skills/shared-skill"), {
      recursive: true,
    });
    await writeFile(
      path.join(root, "agents/coding-agent/skills/shared-skill/SKILL.md"),
      "---\nname: shared-skill\ndescription: Agent-local version\n---\nAgent skill\n",
      "utf8"
    );

    const workspace = await resolveWorkspace({
      storeRoot: root,
      copilotConfigDir,
    });
    const skills = await listSkillsForAgent(workspace, "coding-agent");
    const sharedSkill = skills.find((skill) => skill.name === "shared-skill");

    expect(sharedSkill?.description).toBe("Agent-local version");
    expect(sharedSkill?.scope).toBe("agent-local");

    const agent = await getAgentById(workspace, "coding-agent");
    expect(agent?.combinedPrompt).toContain("Default persona");
    expect(agent?.combinedPrompt).toContain("Agent contract");
    expect(agent?.combinedPrompt).toContain("shared-skill");
  });
});

async function createStoreFixture(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "min-kb-app-agent-"));
  roots.push(root);

  await mkdir(path.join(root, "agents/default"), { recursive: true });
  await mkdir(path.join(root, "agents/coding-agent/skills"), {
    recursive: true,
  });
  await mkdir(path.join(root, "memory/shared"), { recursive: true });
  await mkdir(path.join(root, "skills"), { recursive: true });

  await writeFile(
    path.join(root, "agents/default/SOUL.md"),
    `---\nid: "persona-default-core"\ntype: "persona"\ntitle: "Default persona layer"\n---\nKeep Markdown as the source of truth.\n`,
    "utf8"
  );
  await writeFile(
    path.join(root, "agents/coding-agent/AGENT.md"),
    `---\nid: "agent-coding-agent"\ntype: "agent"\ntitle: "Coding agent"\n---\n## Mission\n\nMake careful edits.\n`,
    "utf8"
  );
  await writeFile(
    path.join(root, "agents/coding-agent/SOUL.md"),
    `---\nid: "persona-coding-agent"\ntype: "persona"\ntitle: "Coding persona"\n---\nPrefer shared scripts.\n`,
    "utf8"
  );

  return root;
}
