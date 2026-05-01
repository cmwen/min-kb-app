import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fetchJson,
  normalizeApiErrorMessage,
  readResponseErrorMessage,
} from "./index.js";

describe("HTTP error normalization", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("unwraps JSON API errors into plain messages", () => {
    expect(normalizeApiErrorMessage('{"error":"Invalid request"}', 400)).toBe(
      "Invalid request"
    );
  });

  it("keeps plain-text HTTP errors intact", () => {
    expect(normalizeApiErrorMessage("Request timed out", 504)).toBe(
      "Request timed out"
    );
  });

  it("falls back to the status message for empty error bodies", () => {
    expect(normalizeApiErrorMessage("   ", 502)).toBe(
      "Request failed with status 502."
    );
  });

  it("reuses normalized messages when fetchJson rejects", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: "Missing session" }), {
          status: 404,
          headers: {
            "content-type": "application/json",
          },
        })
      )
    );

    await expect(fetchJson("/api/test")).rejects.toThrow("Missing session");
  });

  it("can read normalized error messages directly from a response", async () => {
    await expect(
      readResponseErrorMessage(
        new Response(JSON.stringify({ error: "Bad gateway" }), {
          status: 502,
          headers: {
            "content-type": "application/json",
          },
        })
      )
    ).resolves.toBe("Bad gateway");
  });
});
