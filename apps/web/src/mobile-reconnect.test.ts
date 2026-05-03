import { describe, expect, it } from "vitest";
import {
  getAdaptivePollDelayMs,
  getAdaptiveReconnectDelayMs,
} from "./mobile-reconnect";

describe("mobile reconnect policy", () => {
  it("polls more conservatively while hidden", () => {
    expect(
      getAdaptivePollDelayMs({
        attempt: 0,
        pageVisible: true,
        saveData: false,
      })
    ).toBe(30_000);
    expect(
      getAdaptivePollDelayMs({
        attempt: 0,
        pageVisible: false,
        saveData: false,
      })
    ).toBe(120_000);
  });

  it("backs off reconnects and slows down further on constrained networks", () => {
    expect(
      getAdaptiveReconnectDelayMs({
        attempt: 0,
        pageVisible: true,
        saveData: false,
      })
    ).toBe(3_000);
    expect(
      getAdaptiveReconnectDelayMs({
        attempt: 0,
        pageVisible: false,
        saveData: false,
      })
    ).toBe(20_000);
    expect(
      getAdaptiveReconnectDelayMs({
        attempt: 1,
        pageVisible: false,
        saveData: true,
        effectiveType: "3g",
      })
    ).toBe(160_000);
  });
});
