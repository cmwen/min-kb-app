import type { ChatSession } from "@min-kb-app/shared";
import { API_ROOT } from "../api";
import { formatFileSize } from "../attachments";
import { MarkdownRenderer } from "./MarkdownRenderer";

interface ChatTimelineProps {
  thread?: ChatSession;
  pending: boolean;
  pendingAssistantText?: string;
  pendingThinkingText?: string;
  error?: string;
}

export function ChatTimeline(props: ChatTimelineProps) {
  if (!props.thread) {
    return (
      <section className="chat-empty-state">
        <h2>Start a new chat</h2>
        <p>
          Pick an agent, adjust settings if needed, and send the first message.
          Use <code>Cmd/Ctrl+,</code> to open settings and{" "}
          <code>Cmd/Ctrl+Enter</code> to send.
        </p>
      </section>
    );
  }

  const thread = props.thread;

  return (
    <section
      className="chat-timeline"
      role="log"
      aria-live="polite"
      aria-relevant="additions text"
    >
      {props.thread.turns.map((turn) => (
        <article
          key={turn.messageId}
          className={`message-bubble ${turn.sender}`}
        >
          <header>
            <span>{turn.sender}</span>
            <time>{new Date(turn.createdAt).toLocaleString()}</time>
          </header>
          {turn.sender === "assistant" ? (
            renderAssistantSections(turn.bodyMarkdown, turn.thinkingMarkdown)
          ) : (
            <MarkdownRenderer>{turn.bodyMarkdown}</MarkdownRenderer>
          )}
          {turn.attachment ? (
            <div className="message-attachment">
              {turn.attachment.mediaType === "image" ? (
                <a
                  href={`${API_ROOT}/api/agents/${thread.agentId}/sessions/${thread.sessionId}/attachments/${turn.attachment.attachmentId}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  <img
                    src={`${API_ROOT}/api/agents/${thread.agentId}/sessions/${thread.sessionId}/attachments/${turn.attachment.attachmentId}`}
                    alt={turn.attachment.name}
                  />
                </a>
              ) : null}
              <a
                className="message-attachment-link"
                href={`${API_ROOT}/api/agents/${thread.agentId}/sessions/${thread.sessionId}/attachments/${turn.attachment.attachmentId}`}
                target={
                  turn.attachment.mediaType === "image" ? "_blank" : undefined
                }
                rel={
                  turn.attachment.mediaType === "image"
                    ? "noreferrer"
                    : undefined
                }
                download={
                  turn.attachment.mediaType === "image"
                    ? undefined
                    : turn.attachment.name
                }
              >
                <strong>{turn.attachment.name}</strong>
                <span>{formatFileSize(turn.attachment.size)}</span>
              </a>
            </div>
          ) : null}
        </article>
      ))}
      {props.pendingAssistantText || props.pendingThinkingText ? (
        <article className="message-bubble assistant">
          <header>
            <span>assistant</span>
            <time>{new Date().toLocaleString()}</time>
          </header>
          {renderAssistantSections(
            props.pendingAssistantText,
            props.pendingThinkingText
          )}
        </article>
      ) : null}
      {props.pending ? (
        <div className="activity-row" role="status">
          {props.pendingAssistantText || props.pendingThinkingText
            ? "Streaming…"
            : "Thinking…"}
        </div>
      ) : null}
      {props.error ? (
        <div className="error-row" role="alert">
          {props.error}
        </div>
      ) : null}
    </section>
  );
}

function renderAssistantSections(
  assistantText?: string,
  thinkingText?: string
) {
  const hasAssistantText = Boolean(assistantText?.trim());
  const hasThinkingText = Boolean(thinkingText?.trim());
  if (!hasAssistantText && !hasThinkingText) {
    return null;
  }

  return (
    <div className="assistant-message-sections">
      {hasAssistantText ? (
        <section className="assistant-response-section" aria-label="Response">
          {hasThinkingText ? (
            <div className="assistant-section-label">Response</div>
          ) : null}
          <MarkdownRenderer>{assistantText ?? ""}</MarkdownRenderer>
        </section>
      ) : null}
      {hasThinkingText ? (
        <details className="assistant-thinking-panel">
          <summary>Thinking process</summary>
          <MarkdownRenderer className="assistant-thinking-markdown">
            {thinkingText ?? ""}
          </MarkdownRenderer>
        </details>
      ) : null}
    </div>
  );
}
