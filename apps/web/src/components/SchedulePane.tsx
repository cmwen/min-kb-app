import type {
  AgentSummary,
  ChatSession,
  ChatSessionSummary,
  OrchestratorSession,
  ScheduleTask,
  ScheduleTaskCreateRequest,
  ScheduleTaskUpdateRequest,
} from "@min-kb-app/shared";
import { useState } from "react";
import { ChatTimeline } from "./ChatTimeline";
import { ScheduleTaskModal } from "./ScheduleTaskModal";

interface SchedulePaneProps {
  task?: ScheduleTask;
  thread?: ChatSession;
  chatAgents: AgentSummary[];
  orchestratorSessions: ChatSessionSummary[];
  orchestratorSession?: OrchestratorSession;
  pending: boolean;
  error?: string;
  onCreateTask: (request: ScheduleTaskCreateRequest) => void;
  onUpdateTask: (
    scheduleId: string,
    request: ScheduleTaskUpdateRequest
  ) => void;
  onDeleteTask: (scheduleId: string) => void;
  onRunNow: (scheduleId: string) => void;
  onOpenTarget: (task: ScheduleTask) => void;
}

export function SchedulePane(props: SchedulePaneProps) {
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const agentTitle =
    props.chatAgents.find((agent) => agent.id === props.task?.agentId)?.title ??
    props.task?.agentId;
  const orchestratorTitle =
    props.orchestratorSessions.find(
      (session) => session.sessionId === props.task?.orchestratorSessionId
    )?.title ?? props.task?.orchestratorSessionId;
  const targetLabel =
    props.task?.targetKind === "orchestrator" ? orchestratorTitle : agentTitle;
  const hasTargets =
    props.chatAgents.length > 0 || props.orchestratorSessions.length > 0;

  function handleCreateTask(request: ScheduleTaskCreateRequest) {
    props.onCreateTask(request);
    setModalOpen(false);
  }

  function handleUpdateTask(request: ScheduleTaskUpdateRequest) {
    if (!props.task) {
      return;
    }
    props.onUpdateTask(props.task.scheduleId, request);
    setModalOpen(false);
    setEditing(false);
  }

  if (!props.task) {
    return (
      <>
        <section className="schedule-pane">
          <div className="orchestrator-intro settings-card">
            <div>
              <div className="eyebrow">Scheduled chats</div>
              <h3>Create a scheduled task</h3>
              <p>
                Run a real chat agent on a cadence, keep a dedicated backing
                thread for the task, and let the agent use the same skills it
                already has in chat.
              </p>
            </div>
            <div className="orchestrator-intro-actions">
              <button
                type="button"
                className="primary-button"
                disabled={props.pending || !hasTargets}
                onClick={() => {
                  setEditing(false);
                  setModalOpen(true);
                }}
              >
                New schedule
              </button>
            </div>
            {!hasTargets ? (
              <div className="empty-panel">
                Create a chat agent or an orchestrator session before scheduling
                recurring work.
              </div>
            ) : null}
          </div>
        </section>
        <ScheduleTaskModal
          open={modalOpen}
          pending={props.pending}
          chatAgents={props.chatAgents}
          orchestratorSessions={props.orchestratorSessions}
          onClose={() => setModalOpen(false)}
          onSave={handleCreateTask}
        />
      </>
    );
  }

  const task = props.task;
  const toggleRequest: ScheduleTaskUpdateRequest = {
    targetKind: task.targetKind,
    agentId: task.agentId,
    orchestratorSessionId: task.orchestratorSessionId,
    title: task.title,
    prompt: task.prompt,
    frequency: task.frequency,
    timeOfDay: task.timeOfDay,
    timezone: task.timezone,
    dayOfWeek: task.dayOfWeek,
    dayOfMonth: task.dayOfMonth,
    enabled: !task.enabled,
    config: task.runtimeConfig,
  };

  return (
    <>
      <section className="schedule-pane">
        <div className="settings-grid">
          <section className="settings-card">
            <div className="schedule-overview-header">
              <div>
                <div className="eyebrow">Scheduled task</div>
                <h3>{task.title}</h3>
                <p className="panel-caption">
                  Runs with <strong>{targetLabel}</strong>
                  {task.targetKind === "chat"
                    ? " and keeps a dedicated scheduled chat thread."
                    : " inside the selected orchestrated session."}
                </p>
              </div>
              <div className="header-button-row">
                <button
                  type="button"
                  className="primary-button"
                  disabled={props.pending}
                  onClick={() => props.onRunNow(task.scheduleId)}
                >
                  Run now
                </button>
                <button
                  type="button"
                  className="ghost-button"
                  disabled={props.pending}
                  onClick={() =>
                    props.onUpdateTask(task.scheduleId, toggleRequest)
                  }
                >
                  {task.enabled ? "Pause" : "Resume"}
                </button>
                <button
                  type="button"
                  className="ghost-button"
                  disabled={props.pending}
                  onClick={() => {
                    setEditing(true);
                    setModalOpen(true);
                  }}
                >
                  Edit
                </button>
                <button
                  type="button"
                  className="ghost-button"
                  disabled={props.pending}
                  onClick={() => props.onOpenTarget(task)}
                >
                  Open target
                </button>
                <button
                  type="button"
                  className="ghost-button danger-button"
                  disabled={props.pending}
                  onClick={() => props.onDeleteTask(task.scheduleId)}
                >
                  Delete schedule
                </button>
              </div>
            </div>
            <div className="orchestrator-overview-grid">
              <article className="overview-stat-card">
                <span>Status</span>
                <strong>{task.enabled ? "Active" : "Paused"}</strong>
              </article>
              <article className="overview-stat-card">
                <span>Next run</span>
                <strong>{new Date(task.nextRunAt).toLocaleString()}</strong>
              </article>
              <article className="overview-stat-card">
                <span>Last result</span>
                <strong>{task.lastRunStatus}</strong>
              </article>
              <article className="overview-stat-card">
                <span>Total runs</span>
                <strong>{task.totalRuns}</strong>
              </article>
            </div>
          </section>

          <section className="settings-card">
            <div>
              <div className="eyebrow">Details</div>
              <h3>Task configuration</h3>
            </div>
            <dl className="detail-list">
              <div>
                <dt>Target</dt>
                <dd>{targetLabel}</dd>
              </div>
              <div>
                <dt>Target type</dt>
                <dd>
                  {task.targetKind === "chat"
                    ? "Chat agent"
                    : "Orchestrated session"}
                </dd>
              </div>
              <div>
                <dt>Frequency</dt>
                <dd>{formatFrequency(task)}</dd>
              </div>
              <div>
                <dt>Timezone</dt>
                <dd>{task.timezone}</dd>
              </div>
              {task.targetKind === "chat" ? (
                <div>
                  <dt>Backing chat</dt>
                  <dd>{task.chatSessionId}</dd>
                </div>
              ) : (
                <div>
                  <dt>Session id</dt>
                  <dd>{task.orchestratorSessionId}</dd>
                </div>
              )}
            </dl>
            <label className="field-group">
              <span>Prompt</span>
              <textarea value={task.prompt} readOnly rows={8} />
            </label>
            {task.lastError ? (
              <div className="inline-error-banner">
                Last run failed: {task.lastError}
              </div>
            ) : null}
          </section>
        </div>

        <section className="settings-card">
          <div>
            <div className="eyebrow">
              {task.targetKind === "chat" ? "Scheduled chat" : "Orchestrator"}
            </div>
            <h3>
              {task.targetKind === "chat"
                ? "Latest backing conversation"
                : "Target session"}
            </h3>
            <p className="panel-caption">
              {task.targetKind === "chat"
                ? "Each scheduled task keeps writing to the same chat session so you can inspect the running context over time."
                : "This task delegates its prompt into the selected orchestrated session whenever it runs."}
            </p>
          </div>
          {task.targetKind === "chat" ? (
            <ChatTimeline
              thread={props.thread}
              pending={props.pending}
              error={props.error}
            />
          ) : (
            <div className="orchestrator-overview-grid">
              <article className="overview-stat-card">
                <span>Session status</span>
                <strong>
                  {props.orchestratorSession?.status ?? "Loading"}
                </strong>
              </article>
              <article className="overview-stat-card">
                <span>Delegated jobs</span>
                <strong>{props.orchestratorSession?.jobs.length ?? 0}</strong>
              </article>
              <article className="overview-stat-card">
                <span>Model</span>
                <strong>{props.orchestratorSession?.model ?? "Unknown"}</strong>
              </article>
            </div>
          )}
        </section>
      </section>

      <ScheduleTaskModal
        open={modalOpen}
        pending={props.pending}
        task={editing ? task : undefined}
        chatAgents={props.chatAgents}
        orchestratorSessions={props.orchestratorSessions}
        onClose={() => {
          setModalOpen(false);
          setEditing(false);
        }}
        onSave={(request) => {
          if (editing) {
            handleUpdateTask(request as ScheduleTaskUpdateRequest);
            return;
          }
          handleCreateTask(request as ScheduleTaskCreateRequest);
        }}
      />
    </>
  );
}

function formatFrequency(task: ScheduleTask): string {
  switch (task.frequency) {
    case "daily":
      return `Daily at ${task.timeOfDay}`;
    case "weekly":
      return `Every ${task.dayOfWeek ?? "week"} at ${task.timeOfDay}`;
    case "monthly":
      return `Day ${task.dayOfMonth ?? 1} at ${task.timeOfDay}`;
  }
}
