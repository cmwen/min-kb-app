import { approveAll, CopilotClient } from "@github/copilot-sdk";
import {
  listAgents,
  listSkillsForAgent,
  type MinKbWorkspace,
  pathExists,
} from "@min-kb-app/min-kb-store";
import type {
  AgentSummary,
  ChatRuntimeConfig,
  ModelDescriptor,
} from "@min-kb-app/shared";
import { chatRuntimeConfigSchema } from "@min-kb-app/shared";
import {
  FALLBACK_MODELS,
  mapModelInfoToDescriptor,
  mergeModelCatalogs,
} from "./models";

export interface SendRuntimeMessageInput {
  agentId: string;
  sessionId: string;
  prompt: string;
  config?: Partial<ChatRuntimeConfig>;
}

export class CopilotRuntimeService {
  private readonly client = new CopilotClient();
  private started = false;

  constructor(private readonly workspace: MinKbWorkspace) {}

  async listModels(): Promise<ModelDescriptor[]> {
    try {
      await this.ensureStarted();
      const liveModels = await this.client.listModels();
      return mergeModelCatalogs(
        liveModels.map((model) => mapModelInfoToDescriptor(model)),
        FALLBACK_MODELS
      );
    } catch (error) {
      console.warn(
        "Falling back to the bundled model catalog because live Copilot model discovery failed.",
        error
      );
      return FALLBACK_MODELS;
    }
  }

  async stop(): Promise<void> {
    if (!this.started) {
      return;
    }

    await this.client.stop();
    this.started = false;
  }

  async sendMessage(input: SendRuntimeMessageInput): Promise<string> {
    const runtimeConfig = chatRuntimeConfigSchema.parse(input.config ?? {});
    const session = await this.openSession(
      input.agentId,
      input.sessionId,
      runtimeConfig
    );

    try {
      const response = await session.sendAndWait({ prompt: input.prompt });
      const assistantText = this.extractAssistantText(response);
      if (!assistantText) {
        throw new Error(
          "Copilot completed without returning an assistant message."
        );
      }
      return assistantText;
    } finally {
      await session.disconnect();
    }
  }

  private async openSession(
    agentId: string,
    sessionId: string,
    runtimeConfig: ChatRuntimeConfig
  ): Promise<Awaited<ReturnType<CopilotClient["createSession"]>>> {
    await this.ensureStarted();
    const sessionExists = await this.hasSession(sessionId);
    const customAgents = await this.buildCustomAgents();
    const skillDirectories = await this.resolveSkillDirectories(agentId);
    const sessionConfig = {
      sessionId,
      model: runtimeConfig.model,
      reasoningEffort: runtimeConfig.reasoningEffort,
      onPermissionRequest: approveAll,
      customAgents,
      agent: agentId,
      skillDirectories,
      disabledSkills: runtimeConfig.disabledSkills,
      mcpServers: runtimeConfig.mcpServers,
    };

    return sessionExists
      ? this.client.resumeSession(sessionId, sessionConfig)
      : this.client.createSession(sessionConfig);
  }

  private async buildCustomAgents(): Promise<
    Array<{
      name: string;
      displayName: string;
      description: string;
      prompt: string;
    }>
  > {
    const agents = await listAgents(this.workspace);
    return agents.map((agent) => this.mapCustomAgent(agent));
  }

  private async resolveSkillDirectories(agentId: string): Promise<string[]> {
    const skills = await listSkillsForAgent(this.workspace, agentId);
    const roots = [
      this.workspace.copilotSkillsRoot,
      this.workspace.skillsRoot,
      `${this.workspace.agentsRoot}/${agentId}/skills`,
    ];
    const availableRoots: string[] = [];
    const seen = new Set<string>();

    for (const root of roots) {
      if (seen.has(root) || !(await pathExists(root))) {
        continue;
      }
      seen.add(root);
      availableRoots.push(root);
    }

    for (const skill of skills) {
      if (seen.has(skill.sourceRoot) || !(await pathExists(skill.sourceRoot))) {
        continue;
      }
      seen.add(skill.sourceRoot);
      availableRoots.push(skill.sourceRoot);
    }

    return availableRoots;
  }

  private extractAssistantText(response: unknown): string | undefined {
    if (!response || typeof response !== "object") {
      return undefined;
    }

    const data = Reflect.get(response, "data");
    if (!data || typeof data !== "object") {
      return undefined;
    }

    const content = Reflect.get(data, "content");
    return typeof content === "string" ? content : undefined;
  }

  private mapCustomAgent(agent: AgentSummary) {
    return {
      name: agent.id,
      displayName: agent.title,
      description: agent.description,
      prompt: agent.combinedPrompt,
    };
  }

  private async hasSession(sessionId: string): Promise<boolean> {
    const sessions = await this.client.listSessions();
    return sessions.some((session) => session.sessionId === sessionId);
  }

  private async ensureStarted(): Promise<void> {
    if (this.started) {
      return;
    }

    process.env.MIN_KB_STORE_ROOT = this.workspace.storeRoot;
    process.chdir(this.workspace.storeRoot);
    await this.client.start();
    this.started = true;
  }
}
