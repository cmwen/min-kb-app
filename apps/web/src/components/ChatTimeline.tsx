import type { ChatSession } from "@min-kb-app/shared";
import ReactMarkdown from "react-markdown";

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
          <ReactMarkdown>{turn.bodyMarkdown}</ReactMarkdown>
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
