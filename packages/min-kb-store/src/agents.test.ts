import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  getAgentById,
  listSkillsForAgent,
  loadEnabledSkillDocumentsForAgent,
  resolveWorkspace,
} from "./index.js";

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

  it("loads agent runtime config and normalizes Copilot-style MCP server entries", async () => {
    const root = await createStoreFixture({
      runtimeConfig: {
        reasoningEffort: "high",
        mcpServers: {
          playwright: {
            command: "npx",
            args: ["@playwright/mcp@latest", "--headless"],
          },
        },
      },
    });
    const workspace = await resolveWorkspace({
      storeRoot: root,
      copilotConfigDir: path.join(root, ".copilot-home"),
    });

    const agent = await getAgentById(workspace, "coding-agent");

    expect(agent?.runtimeConfig).toEqual({
      provider: "copilot",
      model: "gpt-5-mini",
      reasoningEffort: "high",
      disabledSkills: [],
      mcpServers: {
        playwright: {
          type: "stdio",
          command: "npx",
          args: ["@playwright/mcp@latest", "--headless"],
          env: {},
          tools: ["*"],
        },
      },
    });
  });

  it("loads enabled skill documents with resolved precedence and strips frontmatter", async () => {
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
    await mkdir(path.join(root, "agents/coding-agent/skills/shared-skill"), {
      recursive: true,
    });
    await writeFile(
      path.join(root, "agents/coding-agent/skills/shared-skill/SKILL.md"),
      "---\nname: shared-skill\ndescription: Agent-local version\n---\n## Agent skill\n\nUse the local instructions.\n",
      "utf8"
    );
    await mkdir(path.join(root, "agents/coding-agent/skills/disabled-skill"), {
      recursive: true,
    });
    await writeFile(
      path.join(root, "agents/coding-agent/skills/disabled-skill/SKILL.md"),
      "---\nname: disabled-skill\ndescription: Should be skipped\n---\nDo not include me.\n",
      "utf8"
    );

    const workspace = await resolveWorkspace({
      storeRoot: root,
      copilotConfigDir,
    });

    const loadedSkills = await loadEnabledSkillDocumentsForAgent(
      workspace,
      "coding-agent",
      ["disabled-skill"]
    );

    expect(loadedSkills).toEqual([
      {
        name: "shared-skill",
        description: "Agent-local version",
        scope: "agent-local",
        path: path.join(
          root,
          "agents/coding-agent/skills/shared-skill/SKILL.md"
        ),
        sourceRoot: path.join(root, "agents/coding-agent/skills"),
        content: "## Agent skill\n\nUse the local instructions.",
      },
    ]);
  });
});

async function createStoreFixture(options?: {
  runtimeConfig?: Record<string, unknown>;
}): Promise<string> {
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
  if (options?.runtimeConfig) {
    await writeFile(
      path.join(root, "agents/coding-agent/RUNTIME.json"),
      `${JSON.stringify(options.runtimeConfig, null, 2)}\n`,
      "utf8"
    );
  }

  return root;
}
