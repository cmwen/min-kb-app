import { promises as fs } from "node:fs";
import path from "node:path";
import type { MemoryEntry, MemoryTier } from "@min-kb-app/shared";
import matter from "gray-matter";
import {
  ensureTrailingNewline,
  normalizeAgentId,
  pathExists,
  slugify,
  walkFiles,
} from "./utils.js";
import type { MinKbWorkspace } from "./workspace.js";

export interface MemoryAnalysisTierContent {
  summary: string;
  items: string[];
}

export interface MemoryAnalysisByTier {
  working: MemoryAnalysisTierContent;
  shortTerm: MemoryAnalysisTierContent;
  longTerm: MemoryAnalysisTierContent;
}

export interface PersistedMemoryAnalysisEntry {
  tier: MemoryTier;
  path: string;
  status: "added" | "updated";
}

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

export async function writeMemoryAnalysisFallbackEntries(
  workspace: MinKbWorkspace,
  input: {
    agentId: string;
    sessionId: string;
    sessionTitle: string;
    analyzedAt?: string;
    analysisByTier: MemoryAnalysisByTier;
  }
): Promise<PersistedMemoryAnalysisEntry[]> {
  const analyzedAt = input.analyzedAt ?? new Date().toISOString();
  const normalizedAgentId = normalizeAgentId(input.agentId);
  const slugBase = slugify(`${normalizedAgentId}-${input.sessionId}`);
  const writes: PersistedMemoryAnalysisEntry[] = [];

  for (const tier of MEMORY_ANALYSIS_TIERS) {
    const content = input.analysisByTier[tier.key];
    if (!hasMemoryTierContent(content)) {
      continue;
    }

    const filePath = resolveMemoryAnalysisPath(
      workspace,
      normalizedAgentId,
      slugBase,
      tier.tier,
      analyzedAt
    );
    const status = (await pathExists(filePath)) ? "updated" : "added";
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(
      filePath,
      renderMemoryAnalysisEntry({
        agentId: normalizedAgentId,
        sessionId: input.sessionId,
        sessionTitle: input.sessionTitle,
        analyzedAt,
        tier: tier.tier,
        slugBase,
        content,
      }),
      "utf8"
    );
    writes.push({
      tier: tier.tier,
      path: filePath,
      status,
    });
  }

  return writes;
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

const MEMORY_ANALYSIS_TIERS = [
  { key: "working", tier: "working" as const },
  { key: "shortTerm", tier: "short-term" as const },
  { key: "longTerm", tier: "long-term" as const },
] as const satisfies ReadonlyArray<{
  key: keyof MemoryAnalysisByTier;
  tier: MemoryTier;
}>;

function hasMemoryTierContent(content: MemoryAnalysisTierContent): boolean {
  return content.summary.trim().length > 0 || content.items.length > 0;
}

function resolveMemoryAnalysisPath(
  workspace: MinKbWorkspace,
  agentId: string,
  slugBase: string,
  tier: MemoryTier,
  analyzedAt: string
): string {
  if (tier === "working") {
    return path.join(
      workspace.agentsRoot,
      agentId,
      "memory",
      "working",
      `${slugBase}.md`
    );
  }

  const year = analyzedAt.slice(0, 4);
  return path.join(
    workspace.memoryRoot,
    "shared",
    tier,
    year,
    `${slugBase}.md`
  );
}

function renderMemoryAnalysisEntry(input: {
  agentId: string;
  sessionId: string;
  sessionTitle: string;
  analyzedAt: string;
  tier: MemoryTier;
  slugBase: string;
  content: MemoryAnalysisTierContent;
}): string {
  const title = `${humanizeMemoryTier(input.tier)} for ${input.sessionTitle}`;
  const bodySections = [
    input.content.summary.trim() ? input.content.summary.trim() : undefined,
    input.content.items.length > 0
      ? ["## Items", ...input.content.items.map((item) => `- ${item}`)].join(
          "\n"
        )
      : undefined,
    [
      "## Source",
      `- Agent: ${input.agentId}`,
      `- Session: ${input.sessionId}`,
      `- Captured at: ${input.analyzedAt}`,
    ].join("\n"),
  ].filter((section): section is string => Boolean(section));

  return ensureTrailingNewline(
    matter.stringify(bodySections.join("\n\n"), {
      id: `${input.slugBase}-${slugify(input.tier)}`,
      type: "memory",
      title,
      tags: ["memory-analysis", input.agentId, slugify(input.tier)],
      topics: [input.sessionTitle],
      updated_at: input.analyzedAt,
      session_id: input.sessionId,
      agent_id: input.agentId,
      memory_tier: input.tier,
    })
  );
}

function humanizeMemoryTier(tier: MemoryTier): string {
  if (tier === "working") {
    return "Working memory";
  }
  if (tier === "short-term") {
    return "Short-term memory";
  }
  return "Long-term memory";
}
