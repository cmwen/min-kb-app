import type {
  ModelDescriptor,
  OrchestratorCapabilities,
  OrchestratorJob,
  OrchestratorSchedule,
  OrchestratorScheduleCreateRequest,
  OrchestratorScheduleUpdateRequest,
  OrchestratorSession,
  OrchestratorSessionCreateRequest,
  OrchestratorSessionUpdateRequest,
} from "@min-kb-app/shared";
import Ansi from "ansi-to-react";
import type { ReactNode } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { API_ROOT } from "../api";
import {
  type OrchestratorScheduleDraft,
  OrchestratorScheduleModal,
} from "./OrchestratorScheduleModal";
import { SingleAttachmentPicker } from "./SingleAttachmentPicker";

interface OrchestratorPaneProps {
  capabilities?: OrchestratorCapabilities;
  session?: OrchestratorSession;
  schedules: OrchestratorSchedule[];
  models: ModelDescriptor[];
  defaultModelId: string;
  projectPathSuggestions: string[];
  pending: boolean;
  error?: string;
  onCreateSession: (request: OrchestratorSessionCreateRequest) => void;
  onUpdateSession: (request: OrchestratorSessionUpdateRequest) => void;
  onDelegate: (request: { prompt: string; attachment?: File }) => void;
  onSendInput: (input: string, submit: boolean) => void;
  onCancelJob: () => void;
  onRestartSession: () => void;
  onDeleteQueuedJob: (jobId: string) => void;
  onCreateSchedule: (request: OrchestratorScheduleCreateRequest) => void;
  onUpdateSchedule: (
    scheduleId: string,
    request: OrchestratorScheduleUpdateRequest
  ) => void;
  onDeleteSchedule: (scheduleId: string, sessionId: string) => void;
  onSessionUpdate: (session: OrchestratorSession) => void;
}

export function OrchestratorPane(props: OrchestratorPaneProps) {
  const [title, setTitle] = useState("");
  const [projectPath, setProjectPath] = useState(
    props.capabilities?.defaultProjectPath ?? ""
  );
  const [modelId, setModelId] = useState(props.defaultModelId);
  const [projectPurpose, setProjectPurpose] = useState("");
  const [initialPrompt, setInitialPrompt] = useState("");
  const [delegatePrompt, setDelegatePrompt] = useState("");
  const [delegateAttachment, setDelegateAttachment] = useState<
    File | undefined
  >();
  const [terminalInput, setTerminalInput] = useState("");
  const [sessionTitle, setSessionTitle] = useState(props.session?.title ?? "");
  const [sessionModelId, setSessionModelId] = useState(
    props.session?.model ?? props.defaultModelId
  );
  const [sessionCustomAgentId, setSessionCustomAgentId] = useState(
    props.session?.selectedCustomAgentId ?? ""
  );
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [queueOpen, setQueueOpen] = useState(false);
  const [scheduleModalOpen, setScheduleModalOpen] = useState(false);
  const [editingSchedule, setEditingSchedule] = useState<
    OrchestratorSchedule | undefined
  >();
  const [terminalOutput, setTerminalOutput] = useState(
    props.session?.terminalTail ?? ""
  );
  const [streamState, setStreamState] = useState<"idle" | "live" | "closed">(
    "idle"
  );
  const [streamReconnectToken, setStreamReconnectToken] = useState(0);
  const terminalRef = useRef<HTMLDivElement>(null);
  const sessionUpdateRef = useRef(props.onSessionUpdate);
  const streamOffsetRef = useRef(props.session?.logSize ?? 0);
  const reconnectTimeoutRef = useRef<number | undefined>(undefined);
  const projectPathDatalistId = "orchestrator-project-paths";
  const modelOptions = useMemo(() => {
    if (props.models.length > 0) {
      return props.models;
    }
    return [
      {
        id: props.session?.model ?? props.defaultModelId,
        displayName: props.session?.model ?? props.defaultModelId,
        supportedReasoningEfforts: [],
      },
    ];
  }, [props.defaultModelId, props.models, props.session?.model]);
  const selectedNewSessionModel = useMemo(
    () => modelOptions.find((model) => model.id === modelId),
    [modelId, modelOptions]
  );
  const selectedSavedSessionModel = useMemo(() => {
    const currentSessionModel = props.session?.model;
    if (!currentSessionModel) {
      return undefined;
    }
    return modelOptions.find((model) => model.id === currentSessionModel);
  }, [modelOptions, props.session?.model]);
  const selectedSessionDraftModel = useMemo(() => {
    if (!props.session) {
      return undefined;
    }
    return modelOptions.find((model) => model.id === sessionModelId);
  }, [modelOptions, props.session, sessionModelId]);
  const selectedSavedCustomAgent = useMemo(
    () =>
      props.session?.availableCustomAgents.find(
        (agent) => agent.id === props.session?.selectedCustomAgentId
      ),
    [props.session]
  );
  const selectedSessionDraftCustomAgent = useMemo(
    () =>
      props.session?.availableCustomAgents.find(
        (agent) => agent.id === sessionCustomAgentId
      ),
    [props.session, sessionCustomAgentId]
  );
  const activeJob = useMemo(
    () => props.session?.jobs.find((job) => job.status === "running"),
    [props.session?.jobs]
  );
  const queuedJobs = useMemo(
    () =>
      [...(props.session?.jobs ?? [])]
        .filter((job) => job.status === "queued")
        .sort((left, right) =>
          left.submittedAt.localeCompare(right.submittedAt)
        ),
    [props.session?.jobs]
  );
  const recentCompletedJobs = useMemo(
    () =>
      (props.session?.jobs ?? [])
        .filter((job) => job.status === "completed" || job.status === "failed")
        .slice(0, 4),
    [props.session?.jobs]
  );
  const visibleJobs = useMemo(
    () => [
      ...(activeJob ? [activeJob] : []),
      ...queuedJobs,
      ...recentCompletedJobs,
    ],
    [activeJob, queuedJobs, recentCompletedJobs]
  );
  const completedJobCount = props.session?.jobs.filter(
    (job) => job.status === "completed"
  ).length;
  const failedJobCount = props.session?.jobs.filter(
    (job) => job.status === "failed"
  ).length;
  const enabledScheduleCount = props.schedules.filter(
    (schedule) => schedule.enabled
  ).length;
  const delegateButtonLabel = activeJob
    ? "Queue next prompt"
    : "Delegate prompt";
  const delegateButtonCompactLabel = activeJob ? "Queue next" : "Delegate";
  const queuePanelId = props.session
    ? `${props.session.sessionId}-task-queue`
    : "orchestrator-task-queue";
  const queueToggleLabel = queueOpen ? "Hide task queue" : "Open task queue";
  const scheduleSectionId = props.session
    ? `${props.session.sessionId}-schedules`
    : "orchestrator-schedules";

  useEffect(() => {
    const defaultProjectPath = props.capabilities?.defaultProjectPath;
    if (defaultProjectPath) {
      setProjectPath((current) =>
        current.trim().length > 0 ? current : defaultProjectPath
      );
    }
  }, [props.capabilities?.defaultProjectPath]);

  useEffect(() => {
    const fallbackModelId = props.defaultModelId || modelOptions[0]?.id;
    if (!fallbackModelId) {
      return;
    }
    setModelId((current) => {
      if (
        current.trim().length > 0 &&
        modelOptions.some((model) => model.id === current)
      ) {
        return current;
      }
      return fallbackModelId;
    });
  }, [props.defaultModelId, modelOptions]);

  useEffect(() => {
    setDelegatePrompt("");
    setDelegateAttachment(undefined);
    setTerminalInput("");
    setTerminalOutput(props.session?.terminalTail ?? "");
    setQueueOpen(false);
    setScheduleModalOpen(false);
    setEditingSchedule(undefined);
  }, [props.session?.sessionId]);

  useEffect(() => {
    if (!props.session) {
      setSessionTitle("");
      setSessionModelId(props.defaultModelId);
      setSessionCustomAgentId("");
      setSettingsOpen(false);
      return;
    }
    setSessionTitle(props.session.title);
    setSessionModelId(props.session.model);
    setSessionCustomAgentId(props.session.selectedCustomAgentId ?? "");
  }, [
    props.defaultModelId,
    props.session?.selectedCustomAgentId,
    props.session?.model,
    props.session?.sessionId,
    props.session?.title,
  ]);

  useEffect(() => {
    const terminalTail = props.session?.terminalTail;
    if (!terminalTail) {
      return;
    }
    setTerminalOutput((current) =>
      current.length === 0 || terminalTail.length > current.length
        ? terminalTail
        : current
    );
  }, [props.session?.terminalTail, props.session?.logSize]);

  useEffect(() => {
    const terminal = terminalRef.current;
    if (!terminal) {
      return;
    }
    terminal.scrollTop = terminal.scrollHeight;
  }, [terminalOutput]);

  useEffect(() => {
    sessionUpdateRef.current = props.onSessionUpdate;
  }, [props.onSessionUpdate]);

  useEffect(() => {
    streamOffsetRef.current = props.session?.logSize ?? 0;
  }, [props.session?.sessionId]);

  useEffect(() => {
    return () => {
      if (reconnectTimeoutRef.current !== undefined) {
        window.clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = undefined;
      }
    };
  }, []);

  useEffect(() => {
    if (!props.session) {
      setStreamState("idle");
      return;
    }

    const eventSource = new EventSource(
      `${API_ROOT}/api/orchestrator/sessions/${props.session.sessionId}/stream?offset=${streamOffsetRef.current}`
    );
    const handleOutput = (event: MessageEvent<string>) => {
      const payload = JSON.parse(event.data) as {
        chunk: string;
        nextOffset: number;
      };
      streamOffsetRef.current = payload.nextOffset;
      if (payload.chunk.length > 0) {
        setTerminalOutput((current) => `${current}${payload.chunk}`);
      }
    };
    const handleHeartbeat = (event: MessageEvent<string>) => {
      const payload = JSON.parse(event.data) as {
        offset: number;
      };
      streamOffsetRef.current = payload.offset;
    };
    const handleSession = (event: MessageEvent<string>) => {
      const payload = JSON.parse(event.data) as OrchestratorSession;
      sessionUpdateRef.current(payload);
    };
    const handleError = () => {
      eventSource.close();
      setStreamState("closed");
      if (reconnectTimeoutRef.current !== undefined) {
        window.clearTimeout(reconnectTimeoutRef.current);
      }
      reconnectTimeoutRef.current = window.setTimeout(() => {
        reconnectTimeoutRef.current = undefined;
        setStreamReconnectToken((current) => current + 1);
      }, 1_000);
    };

    setStreamState("live");
    eventSource.addEventListener("output", handleOutput as EventListener);
    eventSource.addEventListener("heartbeat", handleHeartbeat as EventListener);
    eventSource.addEventListener("session", handleSession as EventListener);
    eventSource.onerror = handleError;
    return () => {
      if (reconnectTimeoutRef.current !== undefined) {
        window.clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = undefined;
      }
      eventSource.removeEventListener("output", handleOutput as EventListener);
      eventSource.removeEventListener(
        "heartbeat",
        handleHeartbeat as EventListener
      );
      eventSource.removeEventListener(
        "session",
        handleSession as EventListener
      );
      eventSource.close();
      setStreamState("closed");
    };
  }, [props.session?.sessionId, streamReconnectToken]);

  const capabilityMessage = useMemo(() => {
    if (!props.capabilities) {
      return "Loading orchestrator capabilities…";
    }
    if (props.capabilities.available) {
      return props.capabilities.emailDeliveryAvailable
        ? `tmux session ${props.capabilities.tmuxSessionName} is ready for delegation and runtime email delivery is configured.`
        : `tmux session ${props.capabilities.tmuxSessionName} is ready for delegation.`;
    }
    if (!props.capabilities.tmuxInstalled) {
      return "tmux is not available on this machine.";
    }
    if (!props.capabilities.copilotInstalled) {
      return "The `copilot` CLI is not available on this machine.";
    }
    return "The orchestrator feature is unavailable.";
  }, [props.capabilities]);
  const sessionDetailsDirty =
    !!props.session &&
    (sessionTitle.trim() !== props.session.title ||
      sessionModelId !== props.session.model ||
      sessionCustomAgentId !== (props.session.selectedCustomAgentId ?? ""));
  const canSaveSessionDetails =
    !!props.session &&
    !props.pending &&
    sessionTitle.trim().length > 0 &&
    sessionModelId.trim().length > 0 &&
    sessionDetailsDirty;
  const settingsPanelId = props.session
    ? `${props.session.sessionId}-session-settings`
    : "orchestrator-session-settings";

  function handleOpenCreateSchedule() {
    setEditingSchedule(undefined);
    setScheduleModalOpen(true);
  }

  function handleEditSchedule(schedule: OrchestratorSchedule) {
    setEditingSchedule(schedule);
    setScheduleModalOpen(true);
  }

  function handleSaveSchedule(draft: OrchestratorScheduleDraft) {
    if (!props.session) {
      return;
    }
    if (editingSchedule) {
      props.onUpdateSchedule(editingSchedule.scheduleId, {
        title: draft.title,
        prompt: draft.prompt,
        frequency: draft.frequency,
        timeOfDay: draft.timeOfDay,
        timezone: draft.timezone,
        dayOfWeek: draft.dayOfWeek,
        dayOfMonth: draft.dayOfMonth,
        customAgentId: draft.customAgentId ?? null,
        emailTo: draft.emailTo ?? null,
        enabled: draft.enabled,
      });
    } else {
      props.onCreateSchedule({
        sessionId: props.session.sessionId,
        title: draft.title,
        prompt: draft.prompt,
        frequency: draft.frequency,
        timeOfDay: draft.timeOfDay,
        timezone: draft.timezone,
        dayOfWeek: draft.dayOfWeek,
        dayOfMonth: draft.dayOfMonth,
        customAgentId: draft.customAgentId ?? null,
        emailTo: draft.emailTo,
        enabled: draft.enabled,
      });
    }
    setScheduleModalOpen(false);
    setEditingSchedule(undefined);
  }

  if (!props.session) {
    return (
      <section className="orchestrator-pane">
        <div className="orchestrator-intro settings-card">
          <div>
            <div className="eyebrow">Async delegation</div>
            <h3>Create an orchestrator session</h3>
            <p>
              Queue work into a tmux window that runs `copilot --yolo -p` with
              your chosen model, then monitor the terminal output here.
            </p>
          </div>
          <div className="field-note">{capabilityMessage}</div>
        </div>

        <div className="settings-card orchestrator-form">
          <label className="field-group">
            <span>Session title</span>
            <input
              data-autofocus="true"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Optional label for this delegation session"
            />
          </label>
          <label className="field-group">
            <span>Project path</span>
            <input
              value={projectPath}
              onChange={(event) => setProjectPath(event.target.value)}
              placeholder="/absolute/path/to/project"
              spellCheck={false}
              list={
                props.projectPathSuggestions.length > 0
                  ? projectPathDatalistId
                  : undefined
              }
            />
            {props.projectPathSuggestions.length > 0 ? (
              <small className="field-note">
                Suggestions include the default path and recent orchestrator
                sessions.
              </small>
            ) : null}
          </label>
          {props.projectPathSuggestions.length > 0 ? (
            <datalist id={projectPathDatalistId}>
              {props.projectPathSuggestions.map((suggestion) => (
                <option key={suggestion} value={suggestion} />
              ))}
            </datalist>
          ) : null}
          <label className="field-group">
            <span>Model</span>
            <select
              value={modelId}
              onChange={(event) => setModelId(event.target.value)}
            >
              {modelOptions.map((model) => (
                <option key={model.id} value={model.id}>
                  {model.displayName}
                </option>
              ))}
            </select>
            <small className="field-note">
              This becomes the default model for prompts delegated in this
              orchestrator session.
            </small>
          </label>
          <label className="field-group">
            <span>Project purpose</span>
            <textarea
              value={projectPurpose}
              onChange={(event) => setProjectPurpose(event.target.value)}
              rows={4}
              placeholder="What is this project for, and what should the delegated Copilot session keep in mind?"
            />
          </label>
          <label className="field-group">
            <span>Initial prompt</span>
            <textarea
              value={initialPrompt}
              onChange={(event) => setInitialPrompt(event.target.value)}
              rows={6}
              placeholder="Optional first task to queue as soon as the session is created."
            />
          </label>
          {props.error ? (
            <div className="error-row" role="alert">
              {props.error}
            </div>
          ) : null}
          <div className="composer-footer">
            <div className="composer-meta">
              <span>
                Model: {selectedNewSessionModel?.displayName ?? modelId}
              </span>
              <span>tmux-backed</span>
              <span>Async only</span>
            </div>
            <button
              type="button"
              className="primary-button"
              disabled={
                props.pending ||
                !projectPath.trim() ||
                !projectPurpose.trim() ||
                !modelId.trim() ||
                !props.capabilities?.available
              }
              onClick={() =>
                props.onCreateSession({
                  title: title.trim() || undefined,
                  projectPath: projectPath.trim(),
                  projectPurpose: projectPurpose.trim(),
                  model: modelId,
                  prompt: initialPrompt.trim() || undefined,
                })
              }
            >
              {props.pending ? "Creating..." : "Create session"}
            </button>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="orchestrator-pane orchestrator-console">
      <div className="settings-card orchestrator-session-strip">
        <div className="orchestrator-session-strip-header">
          <div className="orchestrator-session-overview">
            <div className="eyebrow">Orchestrator session</div>
            <div className="orchestrator-session-heading">
              <strong>{props.session.title}</strong>
              <span className="scope-chip">{props.session.status}</span>
            </div>
            <div className="panel-caption">{props.session.projectPurpose}</div>
            <div className="orchestrator-session-meta">
              <span>{props.session.projectPath}</span>
              <span>
                Model:{" "}
                {selectedSavedSessionModel?.displayName ?? props.session.model}
              </span>
              <span>
                Custom agent: {selectedSavedCustomAgent?.name ?? "None"}
              </span>
              {props.session.availableCustomAgents.length > 0 ? (
                <span>
                  {props.session.availableCustomAgents.length} custom agent
                  {props.session.availableCustomAgents.length === 1 ? "" : "s"}
                </span>
              ) : null}
              <span>
                {props.session.jobs.length} delegated job
                {props.session.jobs.length === 1 ? "" : "s"}
              </span>
              {queuedJobs.length > 0 ? (
                <span>
                  {queuedJobs.length} queued task
                  {queuedJobs.length === 1 ? "" : "s"}
                </span>
              ) : null}
              <span>
                {activeJob
                  ? `Running: ${activeJob.promptPreview}`
                  : `Stream ${streamState === "live" ? "connected" : streamState}`}
              </span>
            </div>
          </div>
          <div className="orchestrator-session-actions">
            <button
              type="button"
              className="ghost-button"
              aria-label={settingsOpen ? "Hide settings" : "Session settings"}
              aria-expanded={settingsOpen}
              aria-controls={settingsPanelId}
              onClick={() => setSettingsOpen((current) => !current)}
            >
              <ButtonContent
                icon={<SettingsIcon />}
                label={settingsOpen ? "Hide settings" : "Session settings"}
                compactLabel="Settings"
              />
            </button>
            {props.session.activeJobId ? (
              <button
                type="button"
                className="ghost-button"
                aria-label={props.pending ? "Cancelling..." : "Cancel job"}
                disabled={props.pending}
                onClick={props.onCancelJob}
              >
                <ButtonContent
                  icon={<CancelIcon />}
                  label={props.pending ? "Cancelling..." : "Cancel job"}
                  compactLabel={props.pending ? "Cancelling..." : "Cancel"}
                />
              </button>
            ) : null}
          </div>
        </div>
        {settingsOpen ? (
          <div id={settingsPanelId} className="orchestrator-settings-panel">
            <div className="eyebrow">Session settings</div>
            <div className="orchestrator-settings-grid">
              <label className="field-group">
                <span>Project name</span>
                <input
                  value={sessionTitle}
                  onChange={(event) => setSessionTitle(event.target.value)}
                  placeholder="Name this orchestrator session"
                />
              </label>
              <label className="field-group">
                <span>Copilot model</span>
                <select
                  value={sessionModelId}
                  onChange={(event) => setSessionModelId(event.target.value)}
                >
                  {modelOptions.map((model) => (
                    <option key={model.id} value={model.id}>
                      {model.displayName}
                    </option>
                  ))}
                </select>
                <small className="field-note">
                  Running jobs keep their current command. New delegated prompts
                  use the saved model.
                </small>
              </label>
              <label className="field-group">
                <span>Custom agent</span>
                <select
                  value={sessionCustomAgentId}
                  onChange={(event) =>
                    setSessionCustomAgentId(event.target.value)
                  }
                  disabled={props.session.availableCustomAgents.length === 0}
                >
                  <option value="">No custom agent</option>
                  {props.session.availableCustomAgents.map((agent) => (
                    <option key={agent.id} value={agent.id}>
                      {agent.name}
                    </option>
                  ))}
                </select>
                <small className="field-note">
                  {props.session.availableCustomAgents.length > 0
                    ? "The selected custom agent is passed to future delegated Copilot CLI runs."
                    : "No `.agent.md` files were discovered in the project path when this session was created."}
                </small>
              </label>
            </div>
            <div className="panel-caption">
              Saved runtime: {props.session.tmuxSessionName}:
              {props.session.tmuxWindowName} • {props.session.tmuxPaneId}
            </div>
            <div className="composer-footer">
              <div className="composer-meta">
                <span>
                  Model:{" "}
                  {selectedSessionDraftModel?.displayName ?? sessionModelId}
                </span>
                <span>
                  Custom agent:{" "}
                  {selectedSessionDraftCustomAgent?.name ?? "None"}
                </span>
                <span>Applies to future delegated jobs</span>
              </div>
              <button
                type="button"
                className="primary-button"
                aria-label="Save details"
                disabled={!canSaveSessionDetails}
                onClick={() =>
                  props.onUpdateSession({
                    title: sessionTitle.trim(),
                    model: sessionModelId,
                    selectedCustomAgentId: sessionCustomAgentId || null,
                  })
                }
              >
                <ButtonContent
                  icon={<SaveIcon />}
                  label="Save details"
                  compactLabel="Save"
                />
              </button>
            </div>
          </div>
        ) : null}
      </div>

      <div className="settings-card orchestrator-job-stack">
        <div className="orchestrator-job-stack-header">
          <button
            type="button"
            className="orchestrator-job-stack-toggle"
            aria-label={queueToggleLabel}
            aria-expanded={queueOpen}
            aria-controls={queuePanelId}
            onClick={() => setQueueOpen((current) => !current)}
          >
            <span className="orchestrator-job-stack-toggle-copy">
              <span className="eyebrow">Task queue</span>
              <strong>
                {activeJob
                  ? "Current run plus any queued follow-up work"
                  : "Most recent delegated tasks"}
              </strong>
            </span>
            <span className="orchestrator-job-stack-toggle-affordance">
              <span className="panel-caption">
                {queueOpen ? "Hide" : "Open"}
              </span>
              <QueueChevronIcon open={queueOpen} />
            </span>
          </button>
          <div className="orchestrator-job-stack-stats">
            <span className="orchestrator-job-counter">
              {activeJob ? 1 : 0} running
            </span>
            <span className="orchestrator-job-counter">
              {queuedJobs.length} queued
            </span>
            <span className="orchestrator-job-counter">
              {completedJobCount ?? 0} completed
            </span>
            <span className="orchestrator-job-counter">
              {failedJobCount ?? 0} failed
            </span>
          </div>
        </div>
        {queueOpen ? (
          <div id={queuePanelId} className="orchestrator-job-stack-panel">
            {visibleJobs.length > 0 ? (
              <div className="orchestrator-job-list">
                {visibleJobs.map((job) => (
                  <article
                    key={job.jobId}
                    className={`orchestrator-job-item orchestrator-job-item-${job.status}`}
                  >
                    <div className="orchestrator-job-row">
                      <div className="orchestrator-job-title">
                        <span className="scope-chip">
                          {humanizeJobStatus(job.status)}
                        </span>
                        <strong>{job.promptPreview}</strong>
                        {job.attachment ? (
                          <span className="panel-caption">
                            {job.attachment.name}
                          </span>
                        ) : null}
                      </div>
                      <span className="panel-caption">
                        {formatJobTimestamp(job)}
                      </span>
                    </div>
                    <div className="orchestrator-job-row">
                      <span className="panel-caption">
                        {describeJobProgress(job)}
                      </span>
                      <span className="orchestrator-job-actions">
                        <span className="panel-caption">
                          {job.promptMode === "file"
                            ? "Prompt file"
                            : "Inline prompt"}
                        </span>
                        {job.status === "queued" ? (
                          <button
                            type="button"
                            className="ghost-button danger-button queued-job-delete-button"
                            onClick={() => props.onDeleteQueuedJob(job.jobId)}
                            disabled={props.pending}
                          >
                            Remove
                          </button>
                        ) : null}
                      </span>
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <div className="panel-caption">
                Delegated prompts appear here so you can see what is running,
                what is queued, and what already finished.
              </div>
            )}
          </div>
        ) : null}
      </div>

      <div className="settings-card orchestrator-schedule-stack">
        <div className="orchestrator-job-stack-header">
          <div className="orchestrator-job-stack-toggle-copy">
            <span className="eyebrow">Recurring schedules</span>
            <strong>
              Automate prompts for this session and optionally email the
              captured output.
            </strong>
          </div>
          <div className="orchestrator-job-stack-stats">
            <span className="orchestrator-job-counter">
              {enabledScheduleCount} active
            </span>
            <span className="orchestrator-job-counter">
              {props.schedules.length - enabledScheduleCount} paused
            </span>
            <button
              type="button"
              className="ghost-button"
              onClick={handleOpenCreateSchedule}
              disabled={props.pending}
            >
              Create schedule
            </button>
          </div>
        </div>
        <div id={scheduleSectionId} className="orchestrator-job-stack-panel">
          {props.schedules.length > 0 ? (
            <div className="orchestrator-job-list">
              {props.schedules.map((schedule) => (
                <article
                  key={schedule.scheduleId}
                  className={`orchestrator-job-item orchestrator-schedule-item ${schedule.enabled ? "orchestrator-schedule-item-enabled" : "orchestrator-schedule-item-paused"}`}
                >
                  <div className="orchestrator-job-row">
                    <div className="orchestrator-job-title">
                      <span className="scope-chip">
                        {schedule.enabled ? "Active" : "Paused"}
                      </span>
                      <strong>{schedule.title}</strong>
                    </div>
                    <span className="panel-caption">
                      Next run {formatTimestamp(schedule.nextRunAt)}
                    </span>
                  </div>
                  <div className="panel-caption orchestrator-schedule-summary">
                    {describeSchedule(schedule)}
                  </div>
                  <div className="panel-caption orchestrator-schedule-prompt">
                    {schedule.prompt}
                  </div>
                  <div className="orchestrator-job-row">
                    <span className="panel-caption">
                      {schedule.emailTo
                        ? `Emails ${schedule.emailTo}`
                        : "In-app only"}
                      {" • "}
                      {schedule.totalRuns} total run
                      {schedule.totalRuns === 1 ? "" : "s"}
                      {schedule.failedRuns > 0
                        ? ` • ${schedule.failedRuns} failed`
                        : ""}
                      {schedule.lastJobStatus
                        ? ` • Last status ${humanizeJobStatus(schedule.lastJobStatus)}`
                        : ""}
                    </span>
                    <span className="orchestrator-job-actions">
                      <button
                        type="button"
                        className="ghost-button"
                        onClick={() =>
                          props.onUpdateSchedule(schedule.scheduleId, {
                            title: schedule.title,
                            prompt: schedule.prompt,
                            frequency: schedule.frequency,
                            timeOfDay: schedule.timeOfDay,
                            timezone: schedule.timezone,
                            dayOfWeek: schedule.dayOfWeek,
                            dayOfMonth: schedule.dayOfMonth,
                            customAgentId: schedule.customAgentId ?? null,
                            emailTo: schedule.emailTo ?? null,
                            enabled: !schedule.enabled,
                          })
                        }
                        disabled={props.pending}
                      >
                        {schedule.enabled ? "Pause" : "Resume"}
                      </button>
                      <button
                        type="button"
                        className="ghost-button"
                        onClick={() => handleEditSchedule(schedule)}
                        disabled={props.pending}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className="ghost-button danger-button"
                        onClick={() =>
                          props.onDeleteSchedule(
                            schedule.scheduleId,
                            schedule.sessionId
                          )
                        }
                        disabled={props.pending}
                      >
                        Delete
                      </button>
                    </span>
                  </div>
                  {schedule.lastEmailError ? (
                    <div className="panel-caption orchestrator-schedule-error">
                      Last email attempt failed: {schedule.lastEmailError}
                    </div>
                  ) : null}
                </article>
              ))}
            </div>
          ) : (
            <div className="panel-caption">
              Create a recurring prompt for routines like a morning news
              summary, a scheduled code review, or a daily status email.
            </div>
          )}
        </div>
      </div>

      <div className="terminal-shell">
        <div className="terminal-toolbar">
          <div>
            <strong>tmux output</strong>
            <div className="panel-caption">
              {props.session.tmuxSessionName}:{props.session.tmuxWindowName} •{" "}
              {props.session.tmuxPaneId}
            </div>
          </div>
          <div className="terminal-toolbar-actions">
            <span className="panel-caption orchestrator-toolbar-status">
              Primary workspace
            </span>
            <button
              type="button"
              className="ghost-button"
              aria-label="Start a new tmux session"
              disabled={props.pending}
              onClick={props.onRestartSession}
            >
              <ButtonContent
                icon={<RestartIcon />}
                label="New tmux session"
                compactLabel="New tmux"
              />
            </button>
          </div>
        </div>
        <div className="terminal-toolbar-note field-note">
          Starting a new tmux session closes the current pane. Previous tmux
          output will no longer be available here.
        </div>
        <div className="terminal-output" ref={terminalRef}>
          <Ansi linkify={false}>
            {terminalOutput || "[min-kb-app] Waiting for tmux output...\n"}
          </Ansi>
        </div>
      </div>

      {props.error ? (
        <div className="error-row" role="alert">
          {props.error}
        </div>
      ) : null}

      <div className="orchestrator-control-grid">
        <div className="settings-card orchestrator-primary-action">
          <label className="field-group grow">
            <span>Delegate a Copilot task</span>
            <SingleAttachmentPicker
              file={delegateAttachment}
              pending={props.pending}
              onChange={setDelegateAttachment}
            />
            <textarea
              value={delegatePrompt}
              onChange={(event) => setDelegatePrompt(event.target.value)}
              rows={5}
              placeholder={
                activeJob
                  ? "Add the next task. It will wait for the current run to finish."
                  : "Queue another async prompt for the Copilot CLI window."
              }
            />
          </label>
          <div className="composer-footer">
            <div className="composer-meta">
              <span>
                {`Uses \`copilot --model ${props.session.model}${props.session.selectedCustomAgentId ? ` --agent ${props.session.selectedCustomAgentId}` : ""} --yolo -p\``}
              </span>
              <span>
                Custom agent: {selectedSavedCustomAgent?.name ?? "None"}
              </span>
              <span>
                {activeJob
                  ? `${queuedJobs.length} already queued • starts automatically when the pane is free`
                  : "Starts immediately in the current tmux pane"}
              </span>
            </div>
            <button
              type="button"
              className="primary-button"
              aria-label={props.pending ? "Queueing..." : delegateButtonLabel}
              disabled={
                props.pending || (!delegatePrompt.trim() && !delegateAttachment)
              }
              onClick={() => {
                props.onDelegate({
                  prompt: delegatePrompt.trim(),
                  attachment: delegateAttachment,
                });
                setDelegatePrompt("");
                setDelegateAttachment(undefined);
              }}
            >
              <ButtonContent
                icon={<DelegateIcon />}
                label={props.pending ? "Queueing..." : delegateButtonLabel}
                compactLabel={
                  props.pending ? "Queueing..." : delegateButtonCompactLabel
                }
              />
            </button>
          </div>
        </div>

        <div className="settings-card">
          <label className="field-group grow">
            <span>Send raw terminal input</span>
            <textarea
              value={terminalInput}
              onChange={(event) => setTerminalInput(event.target.value)}
              rows={4}
              placeholder="Send text directly into the tmux pane."
            />
          </label>
          <div className="composer-footer">
            <div className="composer-meta">
              <span>Enter submits</span>
            </div>
            <div className="header-button-row">
              <button
                type="button"
                className="ghost-button"
                aria-label="Send text only"
                disabled={props.pending || !terminalInput.trim()}
                onClick={() => {
                  props.onSendInput(terminalInput, false);
                  setTerminalInput("");
                }}
              >
                <ButtonContent
                  icon={<SendIcon />}
                  label="Send text only"
                  compactLabel="Send"
                />
              </button>
              <button
                type="button"
                className="primary-button"
                aria-label="Send and press Enter"
                disabled={props.pending || !terminalInput.trim()}
                onClick={() => {
                  props.onSendInput(terminalInput, true);
                  setTerminalInput("");
                }}
              >
                <ButtonContent
                  icon={<EnterIcon />}
                  label="Send and press Enter"
                  compactLabel="Send + Enter"
                />
              </button>
            </div>
          </div>
        </div>
      </div>

      <OrchestratorScheduleModal
        open={scheduleModalOpen}
        pending={props.pending}
        schedule={editingSchedule}
        availableCustomAgents={props.session.availableCustomAgents}
        emailDeliveryAvailable={!!props.capabilities?.emailDeliveryAvailable}
        emailFromAddress={props.capabilities?.emailFromAddress}
        onClose={() => {
          setScheduleModalOpen(false);
          setEditingSchedule(undefined);
        }}
        onSave={handleSaveSchedule}
      />
    </section>
  );
}

function ButtonContent(props: {
  icon: ReactNode;
  label: string;
  compactLabel?: string;
}) {
  return (
    <span className="orchestrator-action-content">
      <span className="orchestrator-button-icon" aria-hidden="true">
        {props.icon}
      </span>
      <span className="orchestrator-button-label">{props.label}</span>
      {props.compactLabel ? (
        <span className="orchestrator-button-label-compact" aria-hidden="true">
          {props.compactLabel}
        </span>
      ) : null}
    </span>
  );
}

function QueueChevronIcon(props: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      focusable="false"
      aria-hidden="true"
      className={
        props.open
          ? "orchestrator-job-stack-chevron open"
          : "orchestrator-job-stack-chevron"
      }
    >
      <path
        fill="currentColor"
        d="m7.41 8.59 4.59 4.58 4.59-4.58L18 10l-6 6-6-6 1.41-1.41Z"
      />
    </svg>
  );
}

function humanizeJobStatus(status: OrchestratorJob["status"]): string {
  switch (status) {
    case "queued":
      return "Queued";
    case "running":
      return "Running";
    case "completed":
      return "Completed";
    case "failed":
      return "Failed";
  }
}

function describeJobProgress(job: OrchestratorJob): string {
  switch (job.status) {
    case "queued":
      return `Queued ${formatTimestamp(job.submittedAt)}`;
    case "running":
      return `Started ${formatTimestamp(job.startedAt ?? job.submittedAt)}`;
    case "completed":
      return `Finished ${formatTimestamp(job.completedAt ?? job.submittedAt)}`;
    case "failed":
      return `Failed ${formatTimestamp(job.completedAt ?? job.submittedAt)}`;
  }
}

function describeSchedule(schedule: OrchestratorSchedule): string {
  const base =
    schedule.frequency === "daily"
      ? `Every day at ${schedule.timeOfDay}`
      : schedule.frequency === "weekly"
        ? `Every ${humanizeDayOfWeek(schedule.dayOfWeek)} at ${schedule.timeOfDay}`
        : `Every month on day ${schedule.dayOfMonth ?? 1} at ${schedule.timeOfDay}`;
  return `${base} (${schedule.timezone})`;
}

function formatJobTimestamp(job: OrchestratorJob): string {
  switch (job.status) {
    case "queued":
      return `Submitted ${formatTimestamp(job.submittedAt)}`;
    case "running":
      return `Running since ${formatTimestamp(job.startedAt ?? job.submittedAt)}`;
    case "completed":
      return `Completed ${formatTimestamp(job.completedAt ?? job.submittedAt)}`;
    case "failed":
      return `Failed ${formatTimestamp(job.completedAt ?? job.submittedAt)}`;
  }
}

function formatTimestamp(timestamp: string): string {
  const value = new Date(timestamp);
  if (Number.isNaN(value.getTime())) {
    return timestamp;
  }
  return value.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function humanizeDayOfWeek(day: OrchestratorSchedule["dayOfWeek"]): string {
  if (!day) {
    return "Monday";
  }
  return `${day.slice(0, 1).toUpperCase()}${day.slice(1)}`;
}

function SettingsIcon() {
  return (
    <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
      <path
        fill="currentColor"
        d="M19.14 12.94c.04-.31.06-.63.06-.94s-.02-.63-.07-.94l2.03-1.58a.5.5 0 0 0 .12-.64l-1.92-3.32a.5.5 0 0 0-.6-.22l-2.39.96a7.32 7.32 0 0 0-1.63-.94l-.36-2.54A.5.5 0 0 0 13.9 2h-3.8a.5.5 0 0 0-.49.42l-.36 2.54c-.58.23-1.13.54-1.63.94l-2.39-.96a.5.5 0 0 0-.6.22L2.71 8.48a.5.5 0 0 0 .12.64L4.86 10.7c-.05.31-.08.64-.08.97s.03.65.08.97l-2.03 1.58a.5.5 0 0 0-.12.64l1.92 3.32c.13.22.39.31.6.22l2.39-.96c.5.39 1.05.71 1.63.94l.36 2.54c.04.24.25.42.49.42h3.8c.24 0 .45-.18.49-.42l.36-2.54c.58-.23 1.13-.55 1.63-.94l2.39.96c.22.09.47 0 .6-.22l1.92-3.32a.5.5 0 0 0-.12-.64l-2.02-1.58ZM12 15.5A3.5 3.5 0 1 1 12 8a3.5 3.5 0 0 1 0 7.5Z"
      />
    </svg>
  );
}

function CancelIcon() {
  return (
    <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
      <path
        fill="currentColor"
        d="M12 2.5A9.5 9.5 0 1 0 21.5 12 9.51 9.51 0 0 0 12 2.5Zm4.15 12.24-1.41 1.41L12 13.41l-2.74 2.74-1.41-1.41L10.59 12 7.85 9.26l1.41-1.41L12 10.59l2.74-2.74 1.41 1.41L13.41 12Z"
      />
    </svg>
  );
}

function DelegateIcon() {
  return (
    <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
      <path fill="currentColor" d="M13 3 4 14h6l-1 7 9-11h-6l1-7Z" />
    </svg>
  );
}

function SendIcon() {
  return (
    <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
      <path fill="currentColor" d="M3 20.5v-7l8-1.5-8-1.5v-7L21 12 3 20.5Z" />
    </svg>
  );
}

function EnterIcon() {
  return (
    <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
      <path
        fill="currentColor"
        d="M19 4h-2v8H7.83l2.58-2.59L9 8l-5 5 5 5 1.41-1.41L7.83 14H19V4Z"
      />
    </svg>
  );
}

function SaveIcon() {
  return (
    <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
      <path
        fill="currentColor"
        d="M17 3H5a2 2 0 0 0-2 2v14.01A1.99 1.99 0 0 0 5 21h14a2 2 0 0 0 2-1.99V7Zm-5 16a3 3 0 1 1 3-3 3 3 0 0 1-3 3Zm3-10H5V5h10Z"
      />
    </svg>
  );
}

function RestartIcon() {
  return (
    <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
      <path
        fill="currentColor"
        d="M12 5a7 7 0 1 1-6.71 9h2.1A5 5 0 1 0 8.46 8.46L11 11H4V4l3.04 3.04A6.97 6.97 0 0 1 12 5Z"
      />
    </svg>
  );
}
