import type { AgentSummary } from "@min-kb-app/shared";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";

interface AgentRailProps {
  agents: AgentSummary[];
  notificationAgentIds?: ReadonlySet<string>;
  selectedAgentId?: string;
  offline: boolean;
  onSelect: (agentId: string) => void;
  onNewSession: () => void;
  onOpenSettings: () => void;
}

export function AgentRail(props: AgentRailProps) {
  return (
    <aside className="agent-rail" aria-label="Agents">
      <div className="agent-rail-scroll">
        <div className="brand-pill">kb</div>
        <div className="agent-list">
          {props.agents.map((agent, index) => {
            const initials = agent.title
              .split(/\s+/)
              .slice(0, 2)
              .map((part) => part[0]?.toUpperCase() ?? "")
              .join("");
            const selected = agent.id === props.selectedAgentId;
            const showNotification =
              props.notificationAgentIds?.has(agent.id) ?? false;
            const buttonClassName = [
              "agent-pill",
              selected ? "selected" : undefined,
              agent.kind === "orchestrator"
                ? "agent-pill-orchestrator"
                : undefined,
            ]
              .filter(Boolean)
              .join(" ");

            return (
              <button
                type="button"
                key={agent.id}
                className={buttonClassName}
                title={agent.title}
                aria-label={
                  showNotification
                    ? `Select ${agent.title}. Completed work waiting.`
                    : `Select ${agent.title}`
                }
                aria-pressed={selected}
                onClick={() => props.onSelect(agent.id)}
                onKeyDown={(event) =>
                  handleAgentKeyDown(event, index, props.agents, props.onSelect)
                }
              >
                {initials}
                {showNotification ? (
                  <span
                    className="agent-notification-dot"
                    role="img"
                    aria-label="Agent has completed work waiting"
                  />
                ) : null}
              </button>
            );
          })}
        </div>
        <div className="rail-footer">
          <button
            type="button"
            className="new-session-pill"
            onClick={props.onNewSession}
            aria-label="Start a new chat"
            title="New chat (Alt+Shift+N)"
          >
            +
          </button>
          <div
            className={props.offline ? "status-pill offline" : "status-pill"}
          >
            {props.offline ? "Offline" : "Live"}
          </div>
          <button
            type="button"
            className="rail-icon-button"
            aria-label="Open app settings"
            title="Settings (Cmd/Ctrl+,)"
            onClick={props.onOpenSettings}
          >
            <GearIcon />
          </button>
        </div>
      </div>
    </aside>
  );
}

function handleAgentKeyDown(
  event: ReactKeyboardEvent<HTMLButtonElement>,
  index: number,
  agents: AgentSummary[],
  onSelect: (agentId: string) => void
) {
  if (agents.length === 0) {
    return;
  }

  const offset =
    event.key === "ArrowDown" || event.key === "ArrowRight"
      ? 1
      : event.key === "ArrowUp" || event.key === "ArrowLeft"
        ? -1
        : 0;

  let nextIndex = index;
  if (offset !== 0) {
    nextIndex = (index + offset + agents.length) % agents.length;
  } else if (event.key === "Home") {
    nextIndex = 0;
  } else if (event.key === "End") {
    nextIndex = agents.length - 1;
  } else {
    return;
  }

  event.preventDefault();
  const nextAgent = agents[nextIndex];
  if (!nextAgent) {
    return;
  }

  onSelect(nextAgent.id);
  event.currentTarget.parentElement
    ?.querySelectorAll<HTMLButtonElement>(".agent-pill")
    .item(nextIndex)
    ?.focus();
}

function GearIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path
        fill="currentColor"
        d="M19.14 12.94c.04-.31.06-.63.06-.94s-.02-.63-.07-.94l2.03-1.58a.5.5 0 0 0 .12-.64l-1.92-3.32a.5.5 0 0 0-.6-.22l-2.39.96a7.32 7.32 0 0 0-1.63-.94l-.36-2.54A.5.5 0 0 0 13.9 2h-3.8a.5.5 0 0 0-.49.42l-.36 2.54c-.58.23-1.13.54-1.63.94l-2.39-.96a.5.5 0 0 0-.6.22L2.71 8.48a.5.5 0 0 0 .12.64L4.86 10.7c-.05.31-.08.64-.08.97s.03.65.08.97l-2.03 1.58a.5.5 0 0 0-.12.64l1.92 3.32c.13.22.39.31.6.22l2.39-.96c.5.39 1.05.71 1.63.94l.36 2.54c.04.24.25.42.49.42h3.8c.24 0 .45-.18.49-.42l.36-2.54c.58-.23 1.13-.55 1.63-.94l2.39.96c.22.09.47 0 .6-.22l1.92-3.32a.5.5 0 0 0-.12-.64l-2.02-1.58ZM12 15.5A3.5 3.5 0 1 1 12 8a3.5 3.5 0 0 1 0 7.5Z"
      />
    </svg>
  );
}
