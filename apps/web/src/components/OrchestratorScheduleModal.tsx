import type {
  CopilotCustomAgent,
  OrchestratorSchedule,
  OrchestratorScheduleDayOfWeek,
  OrchestratorScheduleFrequency,
} from "@min-kb-app/shared";
import { useEffect, useMemo, useState } from "react";
import { Modal } from "./Modal";

export interface OrchestratorScheduleDraft {
  title: string;
  prompt: string;
  frequency: OrchestratorScheduleFrequency;
  timeOfDay: string;
  timezone: string;
  dayOfWeek?: OrchestratorScheduleDayOfWeek;
  dayOfMonth?: number;
  customAgentId?: string | null;
  emailTo?: string;
  enabled: boolean;
}

interface OrchestratorScheduleModalProps {
  open: boolean;
  pending: boolean;
  schedule?: OrchestratorSchedule;
  availableCustomAgents: CopilotCustomAgent[];
  emailDeliveryAvailable: boolean;
  emailFromAddress?: string;
  onClose: () => void;
  onSave: (draft: OrchestratorScheduleDraft) => void;
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

export function OrchestratorScheduleModal(
  props: OrchestratorScheduleModalProps
) {
  const [title, setTitle] = useState("");
  const [prompt, setPrompt] = useState("");
  const [frequency, setFrequency] =
    useState<OrchestratorScheduleFrequency>("daily");
  const [timeOfDay, setTimeOfDay] = useState("08:00");
  const [timezone, setTimezone] = useState(getDefaultTimeZone);
  const [dayOfWeek, setDayOfWeek] =
    useState<OrchestratorScheduleDayOfWeek>("monday");
  const [dayOfMonth, setDayOfMonth] = useState("1");
  const [customAgentId, setCustomAgentId] = useState("");
  const [emailTo, setEmailTo] = useState("");
  const [enabled, setEnabled] = useState(true);

  useEffect(() => {
    if (!props.open) {
      return;
    }
    if (props.schedule) {
      setTitle(props.schedule.title);
      setPrompt(props.schedule.prompt);
      setFrequency(props.schedule.frequency);
      setTimeOfDay(props.schedule.timeOfDay);
      setTimezone(props.schedule.timezone);
      setDayOfWeek(props.schedule.dayOfWeek ?? "monday");
      setDayOfMonth(String(props.schedule.dayOfMonth ?? 1));
      setCustomAgentId(props.schedule.customAgentId ?? "");
      setEmailTo(props.schedule.emailTo ?? "");
      setEnabled(props.schedule.enabled);
      return;
    }
    setTitle("");
    setPrompt("");
    setFrequency("daily");
    setTimeOfDay("08:00");
    setTimezone(getDefaultTimeZone());
    setDayOfWeek("monday");
    setDayOfMonth("1");
    setCustomAgentId("");
    setEmailTo("");
    setEnabled(true);
  }, [props.open, props.schedule]);

  const canSave = useMemo(() => {
    if (props.pending) {
      return false;
    }
    if (!title.trim() || !prompt.trim() || !timezone.trim() || !timeOfDay) {
      return false;
    }
    if (frequency === "weekly" && !dayOfWeek) {
      return false;
    }
    if (frequency === "monthly") {
      const numericDay = Number.parseInt(dayOfMonth, 10);
      if (!Number.isFinite(numericDay) || numericDay < 1 || numericDay > 31) {
        return false;
      }
    }
    if (emailTo.trim() && !props.emailDeliveryAvailable) {
      return false;
    }
    return true;
  }, [
    dayOfMonth,
    dayOfWeek,
    emailTo,
    frequency,
    props.emailDeliveryAvailable,
    props.pending,
    prompt,
    timeOfDay,
    timezone,
    title,
  ]);

  return (
    <Modal
      open={props.open}
      title={
        props.schedule
          ? "Edit recurring task schedule"
          : "Create recurring task schedule"
      }
      description="Automate a Copilot task for this orchestrator session, then optionally email the output when it finishes."
      className="schedule-modal"
      onClose={props.onClose}
    >
      <div className="settings-grid">
        <section className="settings-card">
          <div>
            <div className="eyebrow">Schedule details</div>
            <h3>What should run</h3>
            <p className="panel-caption">
              Give the recurring task a clear title, then describe the exact
              prompt to delegate.
            </p>
          </div>
          <label className="field-group">
            <span>Schedule title</span>
            <input
              data-autofocus="true"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="E.g. Daily XYZ news summary"
            />
          </label>
          <label className="field-group">
            <span>Task prompt</span>
            <textarea
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              rows={8}
              placeholder="Summarize the latest news from XYZ, highlight the top five updates, and end with a short executive summary."
            />
            <small className="field-note">
              This prompt runs with the session model and selected custom agent.
            </small>
          </label>
          <label className="field-group">
            <span>Custom agent</span>
            <select
              value={customAgentId}
              onChange={(event) => setCustomAgentId(event.target.value)}
              disabled={props.availableCustomAgents.length === 0}
            >
              <option value="">Use the session default</option>
              {props.availableCustomAgents.map((agent) => (
                <option key={agent.id} value={agent.id}>
                  {agent.name}
                </option>
              ))}
            </select>
          </label>
        </section>

        <section className="settings-card">
          <div>
            <div className="eyebrow">Timing</div>
            <h3>When it should run</h3>
            <p className="panel-caption">
              Schedules run in the server using the selected timezone.
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
              placeholder="America/New_York"
              spellCheck={false}
            />
            <small className="field-note">
              Defaults to the browser timezone so “every morning” lines up with
              what you expect.
            </small>
          </label>
          <label className="checkbox-row settings-checkbox">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(event) => setEnabled(event.target.checked)}
            />
            <div>
              <strong>Enable schedule immediately</strong>
              <span>
                Paused schedules stay saved without triggering new jobs.
              </span>
            </div>
          </label>
        </section>

        <section className="settings-card settings-section-full">
          <div>
            <div className="eyebrow">Delivery</div>
            <h3>Email the result</h3>
            <p className="panel-caption">
              When the scheduled job finishes, the runtime can email the
              captured output.
            </p>
          </div>
          <label className="field-group">
            <span>Email recipient</span>
            <input
              value={emailTo}
              onChange={(event) => setEmailTo(event.target.value)}
              placeholder={
                props.emailDeliveryAvailable
                  ? "name@example.com"
                  : "SMTP is not configured on this runtime"
              }
              type="email"
              disabled={!props.emailDeliveryAvailable}
            />
            <small className="field-note">
              {props.emailDeliveryAvailable
                ? `Emails are sent from ${props.emailFromAddress ?? "the runtime SMTP sender"}. Leave this blank to keep the schedule in-app only.`
                : "Set the runtime MIN_KB_APP_SMTP_* environment variables to unlock email delivery."}
            </small>
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
              customAgentId: customAgentId || null,
              emailTo: emailTo.trim() || undefined,
              enabled,
            })
          }
        >
          {props.pending
            ? props.schedule
              ? "Saving..."
              : "Creating..."
            : props.schedule
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
