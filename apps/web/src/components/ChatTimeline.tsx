import type { ChatSession } from "@min-kb-app/shared";
import { API_ROOT } from "../api";
import { formatFileSize } from "../attachments";
import { MarkdownRenderer } from "./MarkdownRenderer";

interface ChatTimelineProps {
  thread?: ChatSession;
  pending: boolean;
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
          <MarkdownRenderer>{turn.bodyMarkdown}</MarkdownRenderer>
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
      {props.pending ? (
        <div className="activity-row" role="status">
          Thinking…
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
