export const DEFAULT_RUNTIME_PORT = 8787;
export const DEFAULT_ORCHESTRATOR_TMUX_SESSION_NAME = "min-kb-app-orchestrator";

export interface RuntimeSmtpEnv {
  host?: string;
  port?: string;
  secure: boolean;
  user?: string;
  pass?: string;
  from?: string;
  normalizedFrom?: string;
  replyTo?: string;
}

export function readRuntimePort(env: NodeJS.ProcessEnv = process.env): number {
  return Number(env.MIN_KB_APP_PORT ?? DEFAULT_RUNTIME_PORT);
}

export function readOrchestratorTmuxSessionName(
  env: NodeJS.ProcessEnv = process.env
): string {
  return (
    env.MIN_KB_APP_ORCHESTRATOR_TMUX_SESSION ??
    DEFAULT_ORCHESTRATOR_TMUX_SESSION_NAME
  );
}

export function readRuntimeSmtpEnv(
  env: NodeJS.ProcessEnv = process.env
): RuntimeSmtpEnv {
  const from = env.MIN_KB_APP_SMTP_FROM;
  return {
    host: readTrimmedEnvValue(env.MIN_KB_APP_SMTP_HOST),
    port: readTrimmedEnvValue(env.MIN_KB_APP_SMTP_PORT),
    secure: env.MIN_KB_APP_SMTP_SECURE === "true",
    user: readTrimmedEnvValue(env.MIN_KB_APP_SMTP_USER),
    pass: env.MIN_KB_APP_SMTP_PASS,
    from,
    normalizedFrom: readTrimmedEnvValue(from),
    replyTo: env.MIN_KB_APP_SMTP_REPLY_TO,
  };
}

export function isRuntimeSmtpConfigured(
  env: NodeJS.ProcessEnv = process.env
): boolean {
  const smtp = readRuntimeSmtpEnv(env);
  return [smtp.host, smtp.port, smtp.normalizedFrom].every(
    (value) => typeof value === "string" && value.length > 0
  );
}

function readTrimmedEnvValue(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}
