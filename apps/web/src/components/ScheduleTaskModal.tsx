import type {
  AgentSummary,
  ChatSessionSummary,
  OrchestratorScheduleDayOfWeek,
  OrchestratorScheduleFrequency,
  ScheduleTask,
  ScheduleTaskCreateRequest,
  ScheduleTaskTargetKind,
  ScheduleTaskUpdateRequest,
} from "@min-kb-app/shared";
import { useEffect, useMemo, useState } from "react";
import { Modal } from "./Modal";

type ScheduleTaskDraft = ScheduleTaskCreateRequest | ScheduleTaskUpdateRequest;

interface ScheduleTaskModalProps {
  open: boolean;
  pending: boolean;
  task?: ScheduleTask;
  chatAgents: AgentSummary[];
  orchestratorSessions: ChatSessionSummary[];
  onClose: () => void;
  onSave: (draft: ScheduleTaskDraft) => void;
}

const DAYS_OF_WEEK: Array<{
  value: OrchestratorScheduleDayOfWeek;
  label: string;
}> = [
  { value: "monday", label: "Monday" },
  { value: "tuesday", label: "Tuesday" },
  { value: "wednesday", label: "Wednesday" },
  { value: "thursday", label: "Thursday" },
  { value: "friday", label: "Friday" },
  { value: "saturday", label: "Saturday" },
  { value: "sunday", label: "Sunday" },
];

export function ScheduleTaskModal(props: ScheduleTaskModalProps) {
  const [targetKind, setTargetKind] = useState<ScheduleTaskTargetKind>("chat");
  const [agentId, setAgentId] = useState("");
  const [orchestratorSessionId, setOrchestratorSessionId] = useState("");
  const [title, setTitle] = useState("");
  const [prompt, setPrompt] = useState("");
  const [frequency, setFrequency] =
    useState<OrchestratorScheduleFrequency>("daily");
  const [timeOfDay, setTimeOfDay] = useState("08:00");
  const [timezone, setTimezone] = useState(getDefaultTimeZone);
  const [dayOfWeek, setDayOfWeek] =
    useState<OrchestratorScheduleDayOfWeek>("monday");
  const [dayOfMonth, setDayOfMonth] = useState("1");
  const [enabled, setEnabled] = useState(true);

  useEffect(() => {
    if (!props.open) {
      return;
    }
    if (props.task) {
      setTargetKind(props.task.targetKind);
      setAgentId(props.task.agentId ?? "");
      setOrchestratorSessionId(props.task.orchestratorSessionId ?? "");
      setTitle(props.task.title);
      setPrompt(props.task.prompt);
      setFrequency(props.task.frequency);
      setTimeOfDay(props.task.timeOfDay);
      setTimezone(props.task.timezone);
      setDayOfWeek(props.task.dayOfWeek ?? "monday");
      setDayOfMonth(String(props.task.dayOfMonth ?? 1));
      setEnabled(props.task.enabled);
      return;
    }
    setTargetKind("chat");
    setAgentId(props.chatAgents[0]?.id ?? "");
    setOrchestratorSessionId(props.orchestratorSessions[0]?.sessionId ?? "");
    setTitle("");
    setPrompt("");
    setFrequency("daily");
    setTimeOfDay("08:00");
    setTimezone(getDefaultTimeZone());
    setDayOfWeek("monday");
    setDayOfMonth("1");
    setEnabled(true);
  }, [props.chatAgents, props.open, props.orchestratorSessions, props.task]);

  const canSave = useMemo(() => {
    if (
      props.pending ||
      (targetKind === "chat"
        ? !agentId.trim()
        : !orchestratorSessionId.trim()) ||
      !title.trim() ||
      !prompt.trim() ||
      !timezone.trim()
    ) {
      return false;
    }
    if (frequency === "monthly") {
      const numericDay = Number.parseInt(dayOfMonth, 10);
      return Number.isFinite(numericDay) && numericDay >= 1 && numericDay <= 31;
    }
    return true;
  }, [
    agentId,
    dayOfMonth,
    frequency,
    orchestratorSessionId,
    prompt,
    props.pending,
    targetKind,
    timezone,
    title,
  ]);

  return (
    <Modal
      open={props.open}
      title={props.task ? "Edit scheduled task" : "Create scheduled task"}
      description="Scheduled tasks run a real chat agent on a cadence using the same agent skills and chat behavior."
      className="schedule-modal"
      onClose={props.onClose}
    >
      <div className="settings-grid">
        <section className="settings-card">
          <div>
            <div className="eyebrow">Target</div>
            <h3>What should run</h3>
            <p className="panel-caption">
              Pick a chat agent or an orchestrated session for this recurring
              task.
            </p>
          </div>
          <label className="field-group">
            <span>Target type</span>
            <select
              data-autofocus="true"
              value={targetKind}
              onChange={(event) =>
                setTargetKind(event.target.value as ScheduleTaskTargetKind)
              }
            >
              <option value="chat">Chat agent</option>
              <option value="orchestrator">Orchestrated session</option>
            </select>
          </label>
          {targetKind === "chat" ? (
            <label className="field-group">
              <span>Target agent</span>
              <select
                value={agentId}
                onChange={(event) => setAgentId(event.target.value)}
              >
                {props.chatAgents.map((agent) => (
                  <option key={agent.id} value={agent.id}>
                    {agent.title}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <label className="field-group">
              <span>Orchestrated session</span>
              <select
                value={orchestratorSessionId}
                onChange={(event) =>
                  setOrchestratorSessionId(event.target.value)
                }
              >
                {props.orchestratorSessions.map((session) => (
                  <option key={session.sessionId} value={session.sessionId}>
                    {session.title}
                  </option>
                ))}
              </select>
              <small className="field-note">
                Use this to schedule recurring work in an existing orchestrated
                session, like committing changes and pushing to remote.
              </small>
            </label>
          )}
          <label className="field-group">
            <span>Schedule title</span>
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Daily product summary"
            />
          </label>
          <label className="field-group">
            <span>Prompt</span>
            <textarea
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              rows={8}
              placeholder="Review the latest project activity and summarize what matters most."
            />
            <small className="field-note">
              Chat schedules continue the same backing chat thread. Orchestrated
              schedules delegate back into the selected orchestrator session.
            </small>
          </label>
        </section>

        <section className="settings-card">
          <div>
            <div className="eyebrow">Cadence</div>
            <h3>When it should run</h3>
            <p className="panel-caption">
              Scheduled tasks run in the server using the selected timezone.
            </p>
          </div>
          <label className="field-group">
            <span>Frequency</span>
            <select
              value={frequency}
              onChange={(event) =>
                setFrequency(
                  event.target.value as OrchestratorScheduleFrequency
                )
              }
            >
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
            </select>
          </label>
          <label className="field-group">
            <span>Run at</span>
            <input
              type="time"
              value={timeOfDay}
              onChange={(event) => setTimeOfDay(event.target.value)}
            />
          </label>
          {frequency === "weekly" ? (
            <label className="field-group">
              <span>Day of week</span>
              <select
                value={dayOfWeek}
                onChange={(event) =>
                  setDayOfWeek(
                    event.target.value as OrchestratorScheduleDayOfWeek
                  )
                }
              >
                {DAYS_OF_WEEK.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          {frequency === "monthly" ? (
            <label className="field-group">
              <span>Day of month</span>
              <input
                type="number"
                min={1}
                max={31}
                value={dayOfMonth}
                onChange={(event) => setDayOfMonth(event.target.value)}
              />
            </label>
          ) : null}
          <label className="field-group">
            <span>Timezone</span>
            <input
              value={timezone}
              onChange={(event) => setTimezone(event.target.value)}
              spellCheck={false}
              placeholder="America/New_York"
            />
          </label>
          <label className="checkbox-row settings-checkbox">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(event) => setEnabled(event.target.checked)}
            />
            <div>
              <strong>Enable immediately</strong>
              <span>
                Paused schedules stay saved without triggering new runs.
              </span>
            </div>
          </label>
        </section>
      </div>

      <div className="modal-footer">
        <button type="button" className="ghost-button" onClick={props.onClose}>
          Cancel
        </button>
        <button
          type="button"
          className="primary-button"
          disabled={!canSave}
          onClick={() =>
            props.onSave({
              targetKind,
              agentId: targetKind === "chat" ? agentId : undefined,
              orchestratorSessionId:
                targetKind === "orchestrator"
                  ? orchestratorSessionId
                  : undefined,
              title: title.trim(),
              prompt: prompt.trim(),
              frequency,
              timeOfDay,
              timezone: timezone.trim(),
              dayOfWeek: frequency === "weekly" ? dayOfWeek : undefined,
              dayOfMonth:
                frequency === "monthly"
                  ? Number.parseInt(dayOfMonth, 10)
                  : undefined,
              enabled,
            })
          }
        >
          {props.pending
            ? props.task
              ? "Saving..."
              : "Creating..."
            : props.task
              ? "Save schedule"
              : "Create schedule"}
        </button>
      </div>
    </Modal>
  );
}

function getDefaultTimeZone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}
