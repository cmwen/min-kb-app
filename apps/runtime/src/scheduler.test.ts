import { DateTime } from "luxon";
import { describe, expect, it } from "vitest";
import { computeNextRunAt } from "./scheduler.js";

describe("computeNextRunAt", () => {
  it("rolls daily schedules to the next day once the time has passed", () => {
    const nextRunAt = computeNextRunAt(
      {
        sessionId: "session-1",
        title: "Daily summary",
        prompt: "Summarize the news.",
        frequency: "daily",
        timeOfDay: "08:00",
        timezone: "UTC",
        enabled: true,
      },
      DateTime.fromISO("2026-03-23T09:15:00Z")
    );

    expect(nextRunAt).toBe("2026-03-24T08:00:00.000Z");
  });

  it("keeps weekly schedules on the configured weekday in the chosen timezone", () => {
    const nextRunAt = computeNextRunAt(
      {
        title: "Weekly digest",
        prompt: "Send the digest.",
        frequency: "weekly",
        timeOfDay: "09:30",
        timezone: "America/New_York",
        dayOfWeek: "monday",
        enabled: true,
      },
      DateTime.fromISO("2026-03-24T12:00:00Z")
    );

    expect(nextRunAt).toBe("2026-03-30T13:30:00.000Z");
  });

  it("clamps monthly schedules to the last day when needed", () => {
    const nextRunAt = computeNextRunAt(
      {
        title: "Month end summary",
        prompt: "Send the month end email.",
        frequency: "monthly",
        timeOfDay: "06:00",
        timezone: "UTC",
        dayOfMonth: 31,
        enabled: true,
      },
      DateTime.fromISO("2026-04-01T00:00:00Z")
    );

    expect(nextRunAt).toBe("2026-04-30T06:00:00.000Z");
  });
});
