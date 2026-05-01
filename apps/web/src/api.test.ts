import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "./api.js";

describe("web API helpers", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("normalizes JSON error responses for streaming requests", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: "Streaming failed" }), {
          status: 400,
          headers: {
            "content-type": "application/json",
          },
        })
      )
    );

    await expect(
      api.sendMessageStream(
        "coding-agent",
        undefined,
        { prompt: "Hello" },
        () => undefined
      )
    ).rejects.toThrow("Streaming failed");
  });
});
