// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { MarkdownRenderer } from "./MarkdownRenderer";

afterEach(() => {
  cleanup();
});

describe("MarkdownRenderer", () => {
  it("renders markdown tables with table semantics", () => {
    const { container } = render(
      <MarkdownRenderer>
        {"| Agent | Status |\n| --- | --- |\n| Writer | Ready |"}
      </MarkdownRenderer>
    );

    expect(container.querySelector("table")).not.toBeNull();
    expect(screen.queryByRole("table")).not.toBeNull();
    expect(
      screen.queryByRole("columnheader", { name: "Agent" })
    ).not.toBeNull();
    expect(screen.queryByRole("cell", { name: "Writer" })).not.toBeNull();
  });

  it("renders inline and block LaTeX equations", () => {
    const { container } = render(
      <MarkdownRenderer>
        {"Energy is $E=mc^2$.\n\n$$\n\\int_0^1 x^2 \\, dx = \\frac{1}{3}\n$$"}
      </MarkdownRenderer>
    );

    expect(container.querySelector(".katex")).not.toBeNull();
    expect(container.querySelector(".katex-display")).not.toBeNull();
    expect(screen.queryByText("$E=mc^2$")).toBeNull();
  });
});
