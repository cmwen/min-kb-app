import { stdin as input, stdout as output } from "node:process";
import readline from "node:readline/promises";
import { fileURLToPath } from "node:url";
import type {
  AgentSummary,
  ChatRequest,
  ChatResponse,
  ChatSessionSummary,
  OrchestratorExecutionMode,
  OrchestratorJob,
  OrchestratorSession,
  OrchestratorSessionCreateRequest,
  OrchestratorSessionStatus,
  SkillDescriptor,
  WorkspaceSummary,
} from "@min-kb-app/shared";
import {
  DEFAULT_CHAT_MODEL as defaultChatModel,
  fetchJson,
} from "@min-kb-app/shared";
import { Command } from "commander";

const runtimeUrl =
  process.env.MIN_KB_APP_RUNTIME_URL ?? "http://localhost:8787";
const DEFAULT_ORCHESTRATOR_POLL_INTERVAL_MS = 1000;
const DEFAULT_ORCHESTRATOR_TIMEOUT_SECONDS = 1800;

export function createProgram(): Command {
  const program = new Command();

  program
    .name("min-kb-app")
    .description("CLI for the min-kb-app runtime.")
    .option("-u, --url <url>", "Runtime base URL", runtimeUrl);

  program
    .command("doctor")
    .description("Check runtime connectivity and workspace resolution.")
    .action(async (_options, command: Command) => {
      const url = getRuntimeUrl(command);
      const health = await fetchJson<{
        ok: boolean;
        workspace: WorkspaceSummary;
      }>(`${url}/api/health`);
      console.log(`Runtime healthy: ${health.ok}`);
      console.log(`Store root: ${health.workspace.storeRoot}`);
      console.log(`Copilot config: ${health.workspace.copilotConfigDir}`);
      console.log(`Agents: ${health.workspace.agentCount}`);
    });

  program
    .command("agents")
    .description("List available min-kb-store agents.")
    .action(async (_options, command: Command) => {
      const agents = await fetchJson<AgentSummary[]>(
        `${getRuntimeUrl(command)}/api/agents`
      );
      for (const agent of agents) {
        console.log(`- ${agent.id}: ${agent.title}`);
        console.log(`  ${agent.description}`);
      }
    });

  program
    .command("sessions")
    .description("List sessions for an agent.")
    .argument("<agentId>", "Agent identifier")
    .action(async (agentId: string, _options, command: Command) => {
      const sessions = await fetchJson<ChatSessionSummary[]>(
        `${getRuntimeUrl(command)}/api/agents/${agentId}/sessions`
      );
      for (const session of sessions) {
        console.log(`- ${session.sessionId} (${session.startedAt})`);
        console.log(`  ${session.title}`);
      }
    });

  program
    .command("skills")
    .description("List merged skills for an agent.")
    .argument("<agentId>", "Agent identifier")
    .action(async (agentId: string, _options, command: Command) => {
      const skills = await fetchJson<SkillDescriptor[]>(
        `${getRuntimeUrl(command)}/api/agents/${agentId}/skills`
      );
      for (const skill of skills) {
        console.log(`- ${skill.name} [${skill.scope}]`);
        console.log(`  ${skill.description}`);
      }
    });

  program
    .command("chat")
    .description(
      "Send a single message non-interactively with --message, or start an interactive chat."
    )
    .argument("<agentId>", "Agent identifier")
    .option("-s, --session <sessionId>", "Resume a specific session")
    .option("-t, --title <title>", "Title to use when creating a new session")
    .option("-m, --message <message>", "Send a single message")
    .option(
      "--model <model>",
      "Model to request from the selected runtime provider",
      defaultChatModel
    )
    .option(
      "--provider <provider>",
      "Chat runtime provider (for example: copilot or gemini)",
      "copilot"
    )
    .action(async (agentId: string, options: ChatOptions, command: Command) => {
      const runtimeUrl = getRuntimeUrl(command);
      if (options.message) {
        const response = await sendMessage(runtimeUrl, agentId, {
          sessionId: options.session,
          title: options.title,
          prompt: options.message,
          config: {
            provider: options.provider,
            model: options.model,
          },
        });
        console.log(response.assistantTurn.bodyMarkdown);
        return;
      }

      await runInteractiveChat(runtimeUrl, agentId, options);
    });

  program
    .command("orchestrate")
    .description("Queue a tmux-backed Copilot orchestrator job.")
    .argument("<prompt>", "Prompt to delegate")
    .option(
      "-s, --session <sessionId>",
      "Reuse an existing orchestrator session"
    )
    .option(
      "--project-path <path>",
      "Project path for a new orchestrator session"
    )
    .option(
      "--project-purpose <purpose>",
      "Project purpose for a new orchestrator session"
    )
    .option("-t, --title <title>", "Title to use when creating a new session")
    .option(
      "--model <model>",
      "Model to request from the selected CLI provider",
      defaultChatModel
    )
    .option(
      "--provider <provider>",
      "CLI provider for delegated jobs (copilot or gemini)",
      "copilot"
    )
    .option("--agent <agentId>", "Copilot custom agent ID to use")
    .option(
      "--execution-mode <mode>",
      "Execution mode for delegated jobs (standard or fleet; fleet is Copilot-only)",
      "standard"
    )
    .option("-w, --wait", "Wait for the delegated job to finish")
    .option(
      "--poll-interval <ms>",
      "Polling interval in milliseconds when waiting",
      `${DEFAULT_ORCHESTRATOR_POLL_INTERVAL_MS}`
    )
    .option(
      "--timeout-seconds <seconds>",
      "Maximum number of seconds to wait for a delegated job",
      `${DEFAULT_ORCHESTRATOR_TIMEOUT_SECONDS}`
    )
    .action(
      async (prompt: string, options: OrchestrateOptions, command: Command) => {
        const runtimeUrl = getRuntimeUrl(command);
        const delegatedSession = await queueOrchestratorJob(
          runtimeUrl,
          prompt,
          options
        );
        const delegatedJob = getLatestOrchestratorJob(delegatedSession);
        if (!delegatedJob) {
          throw new Error("Delegated orchestrator job was not returned.");
        }

        console.log(
          `Queued orchestrator job ${delegatedJob.jobId} in session ${delegatedSession.sessionId}.`
        );

        if (!options.wait) {
          return;
        }

        const completedJob = await waitForOrchestratorJob(
          runtimeUrl,
          delegatedSession.sessionId,
          delegatedJob.jobId,
          {
            pollIntervalMs: parsePositiveInteger(
              options.pollInterval,
              "--poll-interval"
            ),
            timeoutSeconds: parsePositiveInteger(
              options.timeoutSeconds,
              "--timeout-seconds"
            ),
          }
        );
        const exitCode =
          typeof completedJob.exitCode === "number" ? completedJob.exitCode : 1;
        console.log(
          `Job ${completedJob.jobId} finished with status ${completedJob.status} (exit ${exitCode}).`
        );
        process.exitCode = toProcessExitCode(exitCode);
      }
    );

  return program;
}

interface ChatOptions {
  session?: string;
  title?: string;
  message?: string;
  model: string;
  provider: string;
}

interface OrchestrateOptions {
  session?: string;
  projectPath?: string;
  projectPurpose?: string;
  title?: string;
  model: string;
  provider: string;
  agent?: string;
  executionMode: string;
  wait?: boolean;
  pollInterval: string;
  timeoutSeconds: string;
}

async function runInteractiveChat(
  runtimeUrl: string,
  agentId: string,
  options: ChatOptions
): Promise<void> {
  const rl = readline.createInterface({ input, output });
  let sessionId = options.session;
  let title = options.title;

  console.log(`Interactive chat with ${agentId}. Type 'exit' to quit.`);
  while (true) {
    const prompt = await rl.question("> ");
    if (prompt.trim() === "exit" || prompt.trim() === "quit") {
      break;
    }
    if (!prompt.trim()) {
      continue;
    }

    const response = await sendMessage(runtimeUrl, agentId, {
      sessionId,
      title,
      prompt,
      config: {
        provider: options.provider,
        model: options.model,
      },
    });

    sessionId = response.thread.sessionId;
    title = response.thread.title;
    console.log(`\n${response.assistantTurn.bodyMarkdown}\n`);
  }

  rl.close();
}

async function sendMessage(
  runtimeUrl: string,
  agentId: string,
  request: ChatRequest
): Promise<ChatResponse> {
  const url = request.sessionId
    ? `${runtimeUrl}/api/agents/${agentId}/sessions/${request.sessionId}/messages`
    : `${runtimeUrl}/api/agents/${agentId}/sessions`;

  return fetchJson<ChatResponse>(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(request),
  });
}

async function queueOrchestratorJob(
  runtimeUrl: string,
  prompt: string,
  options: OrchestrateOptions
): Promise<OrchestratorSession> {
  if (options.session) {
    return fetchJson<OrchestratorSession>(
      `${runtimeUrl}/api/orchestrator/sessions/${options.session}/jobs`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          prompt,
          customAgentId: options.agent ?? null,
        }),
      }
    );
  }

  if (!options.projectPath || !options.projectPurpose) {
    throw new Error(
      "Provide --session to reuse an orchestrator session, or pass both --project-path and --project-purpose to create a new one."
    );
  }

  const request: OrchestratorSessionCreateRequest = {
    title: options.title,
    projectPath: options.projectPath,
    projectPurpose: options.projectPurpose,
    cliProvider: options.provider,
    model: options.model,
    selectedCustomAgentId: options.agent ?? null,
    executionMode: parseExecutionMode(options.executionMode),
    prompt,
  };
  return fetchJson<OrchestratorSession>(
    `${runtimeUrl}/api/orchestrator/sessions`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(request),
    }
  );
}

function parseExecutionMode(value: string): OrchestratorExecutionMode {
  return value === "fleet" ? "fleet" : "standard";
}

async function waitForOrchestratorJob(
  runtimeUrl: string,
  sessionId: string,
  jobId: string,
  options: {
    pollIntervalMs: number;
    timeoutSeconds: number;
  }
): Promise<OrchestratorJob> {
  const deadline = Date.now() + options.timeoutSeconds * 1000;
  let lastStatusSignal = "";

  while (Date.now() <= deadline) {
    const session = await fetchJson<OrchestratorSession>(
      `${runtimeUrl}/api/orchestrator/sessions/${sessionId}`
    );
    const job = session.jobs.find((candidate) => candidate.jobId === jobId);
    if (!job) {
      throw new Error(
        `Delegated job ${jobId} no longer exists in orchestrator session ${sessionId}.`
      );
    }

    const statusSignal = `${session.status}:${job.status}:${job.exitCode ?? ""}`;
    if (statusSignal !== lastStatusSignal) {
      lastStatusSignal = statusSignal;
      console.log(
        `Session ${sessionId}: ${describeOrchestratorStatus(session.status, job)}`
      );
    }

    if (job.status === "completed" || job.status === "failed") {
      return job;
    }

    await sleep(options.pollIntervalMs);
  }

  throw new Error(
    `Timed out waiting for orchestrator job ${jobId} after ${options.timeoutSeconds} seconds.`
  );
}

export function getLatestOrchestratorJob(
  session: Pick<OrchestratorSession, "jobs" | "lastJobId">
): OrchestratorJob | undefined {
  if (session.lastJobId) {
    const currentJob = session.jobs.find(
      (job) => job.jobId === session.lastJobId
    );
    if (currentJob) {
      return currentJob;
    }
  }
  return session.jobs[0];
}

function describeOrchestratorStatus(
  sessionStatus: OrchestratorSessionStatus,
  job: Pick<OrchestratorJob, "jobId" | "status" | "exitCode">
): string {
  const exitSuffix =
    typeof job.exitCode === "number" ? ` (exit ${job.exitCode})` : "";
  return `session ${sessionStatus}, job ${job.jobId} ${job.status}${exitSuffix}`;
}

function parsePositiveInteger(value: string, flagName: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(
      `${flagName} must be a positive integer. Received: ${value}`
    );
  }
  return parsed;
}

function toProcessExitCode(exitCode: number): number {
  if (exitCode === 0) {
    return 0;
  }
  return exitCode > 0 && exitCode <= 255 ? exitCode : 1;
}

function getRuntimeUrl(command: Command): string {
  return command.optsWithGlobals<{ url: string }>().url;
}

function sleep(delayMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

const program = createProgram();
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await program.parseAsync(process.argv);
}
