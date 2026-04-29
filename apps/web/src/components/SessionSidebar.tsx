import type { AgentSummary, ChatSessionSummary } from "@min-kb-app/shared";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";

interface SessionSidebarProps {
  agent?: AgentSummary;
  sessions: ChatSessionSummary[];
  notificationSessionIds?: ReadonlySet<string>;
  selectedSessionId?: string;
  sessionLabel?: string;
  newSessionLabel?: string;
  emptyMessage?: string;
  onSelect: (sessionId: string) => void;
  onNewSession: () => void;
}

export function SessionSidebar(props: SessionSidebarProps) {
  const sessionLabel = props.sessionLabel ?? "session";
  const newSessionLabel = props.newSessionLabel ?? "New chat";
  const emptyMessage = props.emptyMessage ?? "No sessions yet for this agent.";
  return (
    <aside className="session-sidebar" aria-label="Chats">
      <div className="sidebar-header">
        <div>
          <div className="eyebrow">Agent</div>
          <h1>{props.agent?.title ?? "Choose an agent"}</h1>
          <p>
            {props.agent?.description ??
              "Select an agent to load sessions and skills."}
          </p>
          <div className="session-count">
            {props.sessions.length} {sessionLabel}
            {props.sessions.length === 1 ? "" : "s"}
          </div>
        </div>
        <div className="sidebar-actions">
          <button
            type="button"
            className="primary-button"
            onClick={props.onNewSession}
            title={`${newSessionLabel} (Alt+Shift+N)`}
          >
            {newSessionLabel}
          </button>
        </div>
      </div>
      <div className="session-list">
        {props.sessions.length === 0 ? (
          <div className="empty-panel">{emptyMessage}</div>
        ) : (
          props.sessions.map((session, index) => {
            const selected = session.sessionId === props.selectedSessionId;
            const showNotification =
              !selected &&
              (props.notificationSessionIds?.has(session.sessionId) ?? false);
            return (
              <button
                type="button"
                key={session.sessionId}
                className={selected ? "session-card selected" : "session-card"}
                aria-pressed={selected}
                onClick={() => props.onSelect(session.sessionId)}
                onKeyDown={(event) =>
                  handleSessionKeyDown(
                    event,
                    index,
                    props.sessions,
                    props.onSelect
                  )
                }
              >
                <div className="session-card-header">
                  <div className="session-card-title">{session.title}</div>
                  {showNotification ? (
                    <span
                      className="session-notification-dot"
                      role="img"
                      aria-label={
                        session.completionStatus === "failed"
                          ? "Session failed while you were away"
                          : "Session completed while you were away"
                      }
                    />
                  ) : null}
                </div>
                <div className="session-card-meta">
                  {new Date(
                    session.lastTurnAt ?? session.startedAt
                  ).toLocaleString()}
                </div>
                <div className="session-card-summary">
                  {session.summary || "Continue this conversation."}
                </div>
              </button>
            );
          })
        )}
      </div>
    </aside>
  );
}

function handleSessionKeyDown(
  event: ReactKeyboardEvent<HTMLButtonElement>,
  index: number,
  sessions: ChatSessionSummary[],
  onSelect: (sessionId: string) => void
) {
  if (sessions.length === 0) {
    return;
  }

  const offset =
    event.key === "ArrowDown" ? 1 : event.key === "ArrowUp" ? -1 : 0;

  let nextIndex = index;
  if (offset !== 0) {
    nextIndex = (index + offset + sessions.length) % sessions.length;
  } else if (event.key === "Home") {
    nextIndex = 0;
  } else if (event.key === "End") {
    nextIndex = sessions.length - 1;
  } else {
    return;
  }

  event.preventDefault();
  const nextSession = sessions[nextIndex];
  if (!nextSession) {
    return;
  }

  onSelect(nextSession.sessionId);
  event.currentTarget.parentElement
    ?.querySelectorAll<HTMLButtonElement>(".session-card")
    .item(nextIndex)
    ?.focus();
}
