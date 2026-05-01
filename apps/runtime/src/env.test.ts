import { describe, expect, it } from "vitest";
import {
  DEFAULT_ORCHESTRATOR_TMUX_SESSION_NAME,
  DEFAULT_RUNTIME_PORT,
  isRuntimeSmtpConfigured,
  readOrchestratorTmuxSessionName,
  readRuntimePort,
  readRuntimeSmtpEnv,
} from "./env.js";

describe("runtime env helpers", () => {
  it("keeps the existing runtime port precedence and default", () => {
    expect(readRuntimePort({})).toBe(DEFAULT_RUNTIME_PORT);
    expect(readRuntimePort({ MIN_KB_APP_PORT: "9797" })).toBe(9797);
    expect(readRuntimePort({ MIN_KB_APP_PORT: "" })).toBe(0);
  });

  it("keeps the existing tmux session precedence and default", () => {
    expect(readOrchestratorTmuxSessionName({})).toBe(
      DEFAULT_ORCHESTRATOR_TMUX_SESSION_NAME
    );
    expect(
      readOrchestratorTmuxSessionName({
        MIN_KB_APP_ORCHESTRATOR_TMUX_SESSION: "team-runtime",
      })
    ).toBe("team-runtime");
    expect(
      readOrchestratorTmuxSessionName({
        MIN_KB_APP_ORCHESTRATOR_TMUX_SESSION: "",
      })
    ).toBe("");
  });

  it("normalizes SMTP settings while preserving raw mail headers", () => {
    const smtp = readRuntimeSmtpEnv({
      MIN_KB_APP_SMTP_HOST: " smtp.example.com ",
      MIN_KB_APP_SMTP_PORT: " 587 ",
      MIN_KB_APP_SMTP_SECURE: "true",
      MIN_KB_APP_SMTP_USER: " deploy-bot ",
      MIN_KB_APP_SMTP_PASS: "secret",
      MIN_KB_APP_SMTP_FROM: " Deploy Bot <bot@example.com> ",
      MIN_KB_APP_SMTP_REPLY_TO: "reply@example.com",
    });

    expect(smtp).toEqual({
      host: "smtp.example.com",
      port: "587",
      secure: true,
      user: "deploy-bot",
      pass: "secret",
      from: " Deploy Bot <bot@example.com> ",
      normalizedFrom: "Deploy Bot <bot@example.com>",
      replyTo: "reply@example.com",
    });
    expect(
      isRuntimeSmtpConfigured({
        MIN_KB_APP_SMTP_HOST: " smtp.example.com ",
        MIN_KB_APP_SMTP_PORT: " 587 ",
        MIN_KB_APP_SMTP_FROM: " Deploy Bot <bot@example.com> ",
      })
    ).toBe(true);
  });

  it("requires trimmed SMTP host, port, and from values before enabling email", () => {
    expect(
      isRuntimeSmtpConfigured({
        MIN_KB_APP_SMTP_HOST: "smtp.example.com",
        MIN_KB_APP_SMTP_PORT: "587",
        MIN_KB_APP_SMTP_FROM: "   ",
      })
    ).toBe(false);
  });
});
