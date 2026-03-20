import { promises as fs } from "node:fs";
import path from "node:path";
import type { MemoryEntry } from "@min-kb-app/shared";
import matter from "gray-matter";
import { normalizeAgentId, pathExists, walkFiles } from "./utils.js";
import type { MinKbWorkspace } from "./workspace.js";

export async function listMemoryEntries(
  workspace: MinKbWorkspace,
  options: { agentId?: string } = {}
): Promise<MemoryEntry[]> {
  const files: Array<{
    filePath: string;
    scope: "shared" | "agent";
    agentId?: string;
  }> = [];
  const sharedRoot = path.join(workspace.memoryRoot, "shared");
  const sharedFiles = await walkMarkdownFiles(sharedRoot);
  files.push(
    ...sharedFiles.map((filePath) => ({ filePath, scope: "shared" as const }))
  );

  if (options.agentId) {
    const normalizedAgentId = normalizeAgentId(options.agentId);
    const workingRoot = path.join(
      workspace.agentsRoot,
      normalizedAgentId,
      "memory",
      "working"
    );
    const workingFiles = await walkMarkdownFiles(workingRoot);
    files.push(
      ...workingFiles.map((filePath) => ({
        filePath,
        scope: "agent" as const,
        agentId: normalizedAgentId,
      }))
    );
  }

  const entries: MemoryEntry[] = [];
  for (const file of files) {
    const raw = await fs.readFile(file.filePath, "utf8");
    const parsed = matter(raw);
    const metadata = parsed.data as Record<string, unknown>;
    entries.push({
      id:
        typeof metadata.id === "string"
          ? metadata.id
          : path.basename(file.filePath, ".md"),
      type: typeof metadata.type === "string" ? metadata.type : "entry",
      title:
        typeof metadata.title === "string"
          ? metadata.title
          : path.basename(file.filePath, ".md"),
      path: file.filePath,
      scope: file.scope,
      agentId: file.agentId,
      tags: normalizeStringArray(metadata.tags),
      topics: normalizeStringArray(metadata.topics),
      updatedAt:
        typeof metadata.updated_at === "string"
          ? metadata.updated_at
          : undefined,
    });
  }

  return entries.sort((left, right) => left.title.localeCompare(right.title));
}

async function walkMarkdownFiles(root: string): Promise<string[]> {
  if (!(await pathExists(root))) {
    return [];
  }

  return (await walkFiles(root)).filter((filePath) => filePath.endsWith(".md"));
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is string => typeof item === "string");
}
