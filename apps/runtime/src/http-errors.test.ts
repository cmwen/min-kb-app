import { describe, expect, it } from "vitest";
import { getHttpErrorMessage, getHttpErrorStatus } from "./http-errors.js";

describe("http errors", () => {
  it("maps validation failures to 400", () => {
    const error = new SyntaxError("Unexpected token");

    expect(getHttpErrorStatus(error)).toBe(400);
    expect(getHttpErrorMessage(error)).toBe("Unexpected token");
  });

  it("maps missing resources to 404", () => {
    const error = new Error("Orchestrator session not found: missing-session");

    expect(getHttpErrorStatus(error)).toBe(404);
    expect(getHttpErrorMessage(error)).toBe(error.message);
  });

  it("keeps unexpected failures as 500", () => {
    const error = new Error("tmux failed to open a pane");

    expect(getHttpErrorStatus(error)).toBe(500);
    expect(getHttpErrorMessage(error)).toBe(error.message);
  });
});
