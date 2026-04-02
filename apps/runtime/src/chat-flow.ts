import path from "node:path";
import type { ChatRuntimeService } from "@min-kb-app/copilot-runtime";
import {
  getAgentById,
  type MinKbWorkspace,
  recordSessionLlmUsage,
  saveChatTurn,
  sessionIdFromTitle,
} from "@min-kb-app/min-kb-store";
import type { ChatRequest, ChatResponse } from "@min-kb-app/shared";
import {
  createDefaultChatRuntimeConfig,
  mergeChatRuntimeConfigs,
} from "@min-kb-app/shared";

export async function runChatFlow(
  workspace: MinKbWorkspace,
  runtime: ChatRuntimeService,
  agentId: string,
  request: ChatRequest,
  forcedSessionId?: string
): Promise<ChatResponse> {
  if (!request.prompt.trim() && !request.attachment) {
    throw new Error("Provide a prompt or attach a file before sending.");
  }
  const createdAt = new Date().toISOString();
  const title =
    request.title ??
    createSessionTitle(request.prompt, request.attachment?.name);
  const sessionId =
    forcedSessionId ??
    request.sessionId ??
    sessionIdFromTitle(title, createdAt);
  const agent = await getAgentById(workspace, agentId);
  const runtimeConfig = mergeChatRuntimeConfigs(
    agent?.runtimeConfig ?? createDefaultChatRuntimeConfig(),
    request.config
  );
  const userThread = await saveChatTurn(workspace, {
    agentId,
    sessionId,
    title,
    sender: "user",
    bodyMarkdown: buildUserTurnMarkdown(
      request.prompt,
      request.attachment?.name
    ),
    createdAt,
    runtimeConfig,
    attachment: request.attachment,
  });
  const userTurn = userThread.turns.at(-1);
  const prompt = buildPromptWithAttachmentContext(
    workspace.storeRoot,
    request.prompt,
    userTurn?.attachment
  );

  const runtimeResult = await runtime.sendMessage({
    agentId,
    sessionId,
    prompt,
    config: runtimeConfig,
    conversation: userThread.turns.slice(0, -1).map((turn) => ({
      sender: turn.sender,
      bodyMarkdown: turn.bodyMarkdown,
    })),
  });

  const summary =
    userThread.turnCount <= 1
      ? buildSummary(title, request.prompt, request.attachment?.name)
      : undefined;
  const updatedThread = await saveChatTurn(workspace, {
    agentId,
    sessionId,
    title,
    sender: "assistant",
    bodyMarkdown: runtimeResult.assistantText,
    createdAt: new Date().toISOString(),
    summary,
    runtimeConfig,
  });
  if (runtimeResult.llmStats) {
    await recordSessionLlmUsage(
      workspace,
      agentId,
      sessionId,
      runtimeResult.llmStats
    );
  }

  const assistantTurn = updatedThread.turns.at(-1);
  if (!assistantTurn) {
    throw new Error("Assistant turn was not persisted.");
  }

  return {
    thread: updatedThread,
    assistantTurn,
  };
}

function createSessionTitle(prompt: string, attachmentName?: string): string {
  const words = prompt.trim().split(/\s+/).filter(Boolean).slice(0, 6);
  if (words.length > 0) {
    return words.join(" ");
  }
  if (attachmentName) {
    return `Attachment ${attachmentName}`;
  }
  return "New session";
}

function buildSummary(
  title: string,
  prompt: string,
  attachmentName?: string
): string {
  const normalizedPrompt = prompt.trim().replace(/\s+/g, " ");
  const titleWordCount = title.trim().split(/\s+/).filter(Boolean).length;
  const remainder = normalizedPrompt
    .split(/\s+/)
    .slice(titleWordCount)
    .join(" ");
  return (
    remainder.slice(0, 120) ||
    (attachmentName
      ? `Started from the attached file ${attachmentName}.`
      : "Started from the initial prompt.")
  );
}

function buildUserTurnMarkdown(
  prompt: string,
  attachmentName?: string
): string {
  const trimmedPrompt = prompt.trim();
  if (!attachmentName) {
    return trimmedPrompt;
  }
  if (!trimmedPrompt) {
    return `Attached file: \`${attachmentName}\``;
  }
  return `${trimmedPrompt}\n\nAttached file: \`${attachmentName}\``;
}

function buildPromptWithAttachmentContext(
  storeRoot: string,
  prompt: string,
  attachment?: {
    name: string;
    contentType: string;
    size: number;
    relativePath: string;
  }
): string {
  const trimmedPrompt = prompt.trim();
  if (!attachment) {
    return trimmedPrompt;
  }

  const attachmentPath = path.join(storeRoot, attachment.relativePath);
  const userPrompt =
    trimmedPrompt ||
    "Inspect the attached file and help the user with the next relevant step.";

  return [
    "The user attached a file to this request.",
    `Attachment name: ${attachment.name}`,
    `Attachment type: ${attachment.contentType}`,
    `Attachment size: ${attachment.size} bytes`,
    `Attachment path: ${attachmentPath}`,
    "Use the attachment as part of your response. If you need the file contents, inspect it from disk using the available tools.",
    "",
    "User request:",
    userPrompt,
  ].join("\n");
}
