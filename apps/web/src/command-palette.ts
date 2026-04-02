import type { AgentSummary, ChatSessionSummary } from "@min-kb-app/shared";

const GROUP_ORDER = {
  Actions: 0,
  Agents: 1,
  Chats: 2,
} as const;

type CommandPaletteGroup = keyof typeof GROUP_ORDER;

export type CommandPaletteActionId =
  | "new-session"
  | "open-settings"
  | "focus-composer"
  | "toggle-sidebar";

interface BaseCommandPaletteItem {
  id: string;
  group: CommandPaletteGroup;
  label: string;
  description: string;
  searchText: string;
  active: boolean;
}

export interface CommandPaletteActionItem extends BaseCommandPaletteItem {
  kind: "action";
  actionId: CommandPaletteActionId;
}

export interface CommandPaletteAgentItem extends BaseCommandPaletteItem {
  kind: "agent";
  agentId: string;
}

export interface CommandPaletteSessionItem extends BaseCommandPaletteItem {
  kind: "session";
  agentId: string;
  sessionId: string;
}

export type CommandPaletteItem =
  | CommandPaletteActionItem
  | CommandPaletteAgentItem
  | CommandPaletteSessionItem;

interface BuildCommandPaletteItemsOptions {
  agents: AgentSummary[];
  sessionsByAgent: Record<string, ChatSessionSummary[]>;
  sidebarCollapsed: boolean;
  selectedAgentId?: string;
  selectedSessionId?: string;
}

export function buildCommandPaletteItems(
  options: BuildCommandPaletteItemsOptions
): CommandPaletteItem[] {
  const selectedAgent = options.agents.find(
    (agent) => agent.id === options.selectedAgentId
  );
  const isOrchestrator = selectedAgent?.kind === "orchestrator";
  const isSchedule = selectedAgent?.kind === "schedule";
  const items: CommandPaletteItem[] = [
    createActionItem(
      "new-session",
      isOrchestrator
        ? "Start new session"
        : isSchedule
          ? "Start new schedule"
          : "Start new chat",
      isOrchestrator
        ? "Begin a fresh tmux-backed Copilot delegation session."
        : isSchedule
          ? "Create a fresh scheduled chat task."
          : "Begin a fresh conversation for the selected agent.",
      isOrchestrator
        ? "new session orchestrator tmux delegation compose"
        : isSchedule
          ? "new schedule recurring task automation"
          : "new session chat conversation compose"
    ),
    createActionItem(
      "open-settings",
      "Open settings",
      "Adjust theme, shortcuts, and visible models.",
      "settings preferences theme shortcuts model visibility"
    ),
    createActionItem(
      "focus-composer",
      "Focus composer",
      "Jump to the message composer.",
      "focus composer prompt input message"
    ),
    createActionItem(
      "toggle-sidebar",
      options.sidebarCollapsed ? "Show chat list" : "Hide chat list",
      options.sidebarCollapsed
        ? "Expand the chat list beside the conversation."
        : "Collapse the chat list to maximize the conversation.",
      "toggle sidebar chats sessions maximize layout"
    ),
  ];

  const agentsById = new Map(options.agents.map((agent) => [agent.id, agent]));

  for (const agent of options.agents) {
    items.push({
      id: `agent:${agent.id}`,
      kind: "agent",
      group: "Agents",
      agentId: agent.id,
      label: agent.title,
      description: agent.description,
      searchText: buildSearchText(
        agent.title,
        agent.description,
        agent.id,
        "agent"
      ),
      active: agent.id === options.selectedAgentId,
    });
  }

  const sessionEntries = Object.entries(options.sessionsByAgent).flatMap(
    ([agentId, sessions]) =>
      sessions.map((session) => ({
        agentId,
        agentTitle: agentsById.get(agentId)?.title ?? agentId,
        session,
      }))
  );

  sessionEntries.sort(
    (left, right) =>
      getSessionActivityTimestamp(right.session) -
      getSessionActivityTimestamp(left.session)
  );

  for (const entry of sessionEntries) {
    items.push({
      id: `session:${entry.agentId}:${entry.session.sessionId}`,
      kind: "session",
      group: "Chats",
      agentId: entry.agentId,
      sessionId: entry.session.sessionId,
      label: entry.session.title,
      description: `${entry.agentTitle} - ${entry.session.summary || entry.session.startedAt}`,
      searchText: buildSearchText(
        entry.session.title,
        entry.session.summary,
        entry.session.sessionId,
        entry.agentTitle,
        entry.agentId,
        "chat session conversation"
      ),
      active:
        entry.agentId === options.selectedAgentId &&
        entry.session.sessionId === options.selectedSessionId,
    });
  }

  return items;
}

export function filterCommandPaletteItems(
  items: CommandPaletteItem[],
  query: string
): CommandPaletteItem[] {
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) {
    return items;
  }

  const tokens = normalizedQuery.split(" ").filter(Boolean);
  return items
    .map((item) => ({
      item,
      score: scoreCommandPaletteItem(item, tokens, normalizedQuery),
    }))
    .filter((entry) => entry.score >= 0)
    .sort(
      (left, right) =>
        right.score - left.score ||
        GROUP_ORDER[left.item.group] - GROUP_ORDER[right.item.group] ||
        Number(right.item.active) - Number(left.item.active) ||
        left.item.label.localeCompare(right.item.label)
    )
    .map((entry) => entry.item);
}

function createActionItem(
  actionId: CommandPaletteActionId,
  label: string,
  description: string,
  keywords: string
): CommandPaletteActionItem {
  return {
    id: `action:${actionId}`,
    kind: "action",
    actionId,
    group: "Actions",
    label,
    description,
    searchText: buildSearchText(label, description, keywords),
    active: false,
  };
}

function scoreCommandPaletteItem(
  item: CommandPaletteItem,
  tokens: string[],
  fullQuery: string
): number {
  if (!tokens.every((token) => item.searchText.includes(token))) {
    return -1;
  }

  const normalizedLabel = normalizeSearchText(item.label);
  let score = 0;

  if (normalizedLabel.startsWith(fullQuery)) {
    score += 6;
  }
  if (item.searchText.includes(fullQuery)) {
    score += 3;
  }
  if (item.active) {
    score += 2;
  }
  if (item.kind === "action") {
    score += 1;
  }

  return score;
}

function getSessionActivityTimestamp(session: ChatSessionSummary): number {
  return Date.parse(session.lastTurnAt ?? session.startedAt);
}

function buildSearchText(...parts: Array<string | undefined>): string {
  return normalizeSearchText(parts.filter(Boolean).join(" "));
}

function normalizeSearchText(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}
