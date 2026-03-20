// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CommandPaletteItem } from "../command-palette";
import { CommandPalette } from "./CommandPalette";

afterEach(() => {
  cleanup();
});

const ITEMS: CommandPaletteItem[] = [
  {
    id: "action:new-session",
    kind: "action",
    actionId: "new-session",
    group: "Actions",
    label: "Start new chat",
    description: "Begin a fresh conversation.",
    searchText: "start new chat",
    active: false,
  },
  {
    id: "agent:planner",
    kind: "agent",
    agentId: "planner",
    group: "Agents",
    label: "Planner",
    description: "Plans work",
    searchText: "planner",
    active: true,
  },
  {
    id: "session:planner:roadmap",
    kind: "session",
    agentId: "planner",
    sessionId: "roadmap",
    group: "Chats",
    label: "Roadmap review",
    description: "Planner - roadmap",
    searchText: "roadmap review planner",
    active: false,
  },
];

describe("CommandPalette", () => {
  it("navigates results with the keyboard and selects the active item", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();

    render(
      <CommandPalette
        open
        items={ITEMS}
        onClose={() => undefined}
        onSelect={onSelect}
      />
    );

    const input = screen.getByRole("searchbox", { name: "Search commands" });
    await user.click(input);
    await user.keyboard("{ArrowDown}{Enter}");

    expect(onSelect).toHaveBeenCalledWith(ITEMS[1]);
  });

  it("closes when escape is pressed", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();

    render(
      <CommandPalette
        open
        items={ITEMS}
        onClose={onClose}
        onSelect={() => undefined}
      />
    );

    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
