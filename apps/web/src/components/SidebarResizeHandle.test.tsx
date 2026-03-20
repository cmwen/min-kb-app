// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SidebarResizeHandle } from "./SidebarResizeHandle";

afterEach(() => {
  cleanup();
});

describe("SidebarResizeHandle", () => {
  it("supports keyboard resizing", async () => {
    const user = userEvent.setup();
    const onWidthChange = vi.fn();

    render(<SidebarResizeHandle width={320} onWidthChange={onWidthChange} />);

    const resizeButton = screen.getByRole("button", {
      name: "Resize session sidebar",
    });
    resizeButton.focus();
    await user.keyboard("{ArrowRight}{Home}");

    expect(onWidthChange).toHaveBeenNthCalledWith(1, 344);
    expect(onWidthChange).toHaveBeenNthCalledWith(2, 260);
  });
});
