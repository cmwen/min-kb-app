import { stdin as input, stdout as output } from "node:process";
import readline from "node:readline/promises";
import type {
  AgentSummary,
  ChatRequest,
  ChatResponse,
  ChatSessionSummary,
  SkillDescriptor,
  WorkspaceSummary,
} from "@min-kb-app/shared";
import { Command } from "commander";

const runtimeUrl =
  process.env.MIN_KB_APP_RUNTIME_URL ?? "http://localhost:8787";
const program = new Command();

program
  .name("min-kb-app")
  .description("CLI for the min-kb-app runtime.")
  .option("-u, --url <url>", "Runtime base URL", runtimeUrl);

program
  .command("doctor")
  .description("Check runtime connectivity and workspace resolution.")
  .action(async () => {
    const url = getRuntimeUrl();
    const health = await requestJson<{
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
  .action(async () => {
    const agents = await requestJson<AgentSummary[]>(
      `${getRuntimeUrl()}/api/agents`
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
  .action(async (agentId: string) => {
    const sessions = await requestJson<ChatSessionSummary[]>(
      `${getRuntimeUrl()}/api/agents/${agentId}/sessions`
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
  .action(async (agentId: string) => {
    const skills = await requestJson<SkillDescriptor[]>(
      `${getRuntimeUrl()}/api/agents/${agentId}/skills`
    );
    for (const skill of skills) {
      console.log(`- ${skill.name} [${skill.scope}]`);
      console.log(`  ${skill.description}`);
    }
  });

program
  .command("chat")
  .description("Send a single message or start an interactive chat.")
  .argument("<agentId>", "Agent identifier")
  .option("-s, --session <sessionId>", "Resume a specific session")
  .option("-t, --title <title>", "Title to use when creating a new session")
  .option("-m, --message <message>", "Send a single message")
  .option("--model <model>", "Model to request from Copilot", "gpt-5")
  .action(async (agentId: string, options: ChatOptions) => {
    if (options.message) {
      const response = await sendMessage(agentId, {
        sessionId: options.session,
        title: options.title,
        prompt: options.message,
        config: {
          model: options.model,
          disabledSkills: [],
          mcpServers: {},
        },
      });
      console.log(response.assistantTurn.bodyMarkdown);
      return;
    }

    await runInteractiveChat(agentId, options);
  });

await program.parseAsync(process.argv);

interface ChatOptions {
  session?: string;
  title?: string;
  message?: string;
  model: string;
}

async function runInteractiveChat(
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

    const response = await sendMessage(agentId, {
      sessionId,
      title,
      prompt,
      config: {
        model: options.model,
        disabledSkills: [],
        mcpServers: {},
      },
    });

    sessionId = response.thread.sessionId;
    title = response.thread.title;
    console.log(`\n${response.assistantTurn.bodyMarkdown}\n`);
  }

  rl.close();
}

async function sendMessage(
  agentId: string,
  request: ChatRequest
): Promise<ChatResponse> {
  const url = request.sessionId
    ? `${getRuntimeUrl()}/api/agents/${agentId}/sessions/${request.sessionId}/messages`
    : `${getRuntimeUrl()}/api/agents/${agentId}/sessions`;

  return requestJson<ChatResponse>(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(request),
  });
}

function getRuntimeUrl(): string {
  return program.opts<{ url: string }>().url;
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Request failed (${response.status}): ${body}`);
  }
  return (await response.json()) as T;
}
