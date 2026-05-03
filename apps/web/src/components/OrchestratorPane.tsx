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
import * as RawAnsiModule from "ansi-to-react";
import type {
  CSSProperties,
  KeyboardEvent as ReactKeyboardEvent,
  ReactNode,
  PointerEvent as ReactPointerEvent,
} from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { API_ROOT, api } from "../api";
import {
  getAdaptiveReconnectDelayMs,
  readReconnectCostHints,
} from "../mobile-reconnect";
import { findMatchingOrchestratorSessions } from "../orchestrator-duplicates";
import {
  clampOrchestratorTerminalHeight,
  DEFAULT_ORCHESTRATOR_TERMINAL_HEIGHT,
  MAX_ORCHESTRATOR_TERMINAL_HEIGHT,
  MIN_ORCHESTRATOR_TERMINAL_HEIGHT,
} from "../ui-preferences";
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
  defaultCliProvider?: string;
  defaultModelId: string;
  allSessions?: OrchestratorSession[];
  projectPathSuggestions: string[];
  pending: boolean;
  error?: string;
  onCreateSession: (request: OrchestratorSessionCreateRequest) => void;
  onUpdateSession: (request: OrchestratorSessionUpdateRequest) => void;
  onSelectSession?: (sessionId: string) => void;
  onDeleteOlderDuplicates?: (sessionIds: string[]) => void;
  onDelegate: (request: { prompt: string; attachment?: File }) => void;
  onSendInput: (input: string, submit: boolean) => void;
  onCancelJob: () => void;
  onRestartSession: () => void;
  onRetryFailedJob?: (jobId: string) => void;
  onDeleteQueuedJob: (jobId: string) => void;
  onCreateSchedule: (request: OrchestratorScheduleCreateRequest) => void;
  onUpdateSchedule: (
    scheduleId: string,
    request: OrchestratorScheduleUpdateRequest
  ) => void;
  onDeleteSchedule: (scheduleId: string, sessionId: string) => void;
  onSessionUpdate: (session: OrchestratorSession) => void;
  terminalOutputHeight?: number;
  onTerminalOutputHeightChange?: (height: number) => void;
}

const TERMINAL_HISTORY_PAGE_LINE_LIMIT = 2_000;
const INITIAL_TERMINAL_TAIL_LINE_LIMIT = 200;
type AnsiComponentProps = {
  children?: string;
  linkify?: boolean | "fuzzy";
  className?: string;
  useClasses?: boolean;
};

const Ansi = resolveAnsiComponent(RawAnsiModule);

export function OrchestratorPane(props: OrchestratorPaneProps) {
  const defaultCliProvider =
    props.defaultCliProvider ??
    props.capabilities?.defaultCliProvider ??
    "copilot";
  const [title, setTitle] = useState("");
  const [projectPath, setProjectPath] = useState(
    props.capabilities?.defaultProjectPath ?? ""
  );
  const [cliProvider, setCliProvider] = useState(defaultCliProvider);
  const [modelId, setModelId] = useState(props.defaultModelId);
  const [projectPurpose, setProjectPurpose] = useState("");
  const [initialPrompt, setInitialPrompt] = useState("");
  const [delegatePrompt, setDelegatePrompt] = useState("");
  const [delegateAttachment, setDelegateAttachment] = useState<
    File | undefined
  >();
  const [terminalInput, setTerminalInput] = useState("");
  const [sessionTitle, setSessionTitle] = useState(props.session?.title ?? "");
  const [sessionCliProvider, setSessionCliProvider] = useState(
    props.session?.cliProvider ?? defaultCliProvider
  );
  const [sessionModelId, setSessionModelId] = useState(
    props.session?.model ?? props.defaultModelId
  );
  const [sessionCustomAgentId, setSessionCustomAgentId] = useState(
    props.session?.selectedCustomAgentId ?? ""
  );
  const [executionMode, setExecutionMode] = useState(
    props.session?.executionMode ?? "standard"
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
  const [terminalStartOffset, setTerminalStartOffset] = useState(() =>
    getTerminalTailStartOffset(props.session)
  );
  const [loadingMoreOutput, setLoadingMoreOutput] = useState(false);
  const [terminalHistoryError, setTerminalHistoryError] = useState<
    string | undefined
  >();
  const [streamReconnectToken, setStreamReconnectToken] = useState(0);
  const terminalRef = useRef<HTMLDivElement>(null);
  const sessionUpdateRef = useRef(props.onSessionUpdate);
  const streamOffsetRef = useRef(props.session?.logSize ?? 0);
  const reconnectTimeoutRef = useRef<number | undefined>(undefined);
  const streamReconnectAttemptRef = useRef(0);
  const pageVisibleRef = useRef(
    typeof document === "undefined"
      ? true
      : document.visibilityState !== "hidden"
  );
  const scrollBehaviorRef = useRef<"bottom" | "preserve">("bottom");
  const scrollSnapshotRef = useRef<{
    scrollTop: number;
    scrollHeight: number;
  } | null>(null);
  const projectPathDatalistId = "orchestrator-project-paths";
  const availableCliProviders = props.capabilities?.cliProviders ?? [];
  const selectedCreateCliProvider = useMemo(
    () =>
      availableCliProviders.find((provider) => provider.id === cliProvider) ??
      availableCliProviders[0],
    [availableCliProviders, cliProvider]
  );
  const selectedSavedSessionCliProvider = useMemo(
    () =>
      availableCliProviders.find(
        (provider) => provider.id === (props.session?.cliProvider ?? "")
      ) ?? availableCliProviders[0],
    [availableCliProviders, props.session?.cliProvider]
  );
  const selectedSessionDraftCliProvider = useMemo(
    () =>
      availableCliProviders.find(
        (provider) => provider.id === sessionCliProvider
      ) ?? availableCliProviders[0],
    [availableCliProviders, sessionCliProvider]
  );
  const modelOptions = useMemo(() => {
    const activeCliProvider = props.session ? sessionCliProvider : cliProvider;
    const providerModels = props.models.filter(
      (model) => model.runtimeProvider === activeCliProvider
    );
    if (providerModels.length > 0) {
      return providerModels;
    }
    return [
      {
        id: props.session?.model ?? props.defaultModelId,
        displayName: props.session?.model ?? props.defaultModelId,
        runtimeProvider: activeCliProvider,
        supportedReasoningEfforts: [],
      },
    ];
  }, [
    cliProvider,
    props.defaultModelId,
    props.models,
    props.session,
    props.session?.model,
    sessionCliProvider,
  ]);
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
  const duplicateComparisonSessions = useMemo(
    () =>
      props.session
        ? [
            props.session,
            ...(props.allSessions ?? []).filter(
              (session) => session.sessionId !== props.session?.sessionId
            ),
          ]
        : (props.allSessions ?? []),
    [props.allSessions, props.session]
  );
  const matchingSessions = useMemo(
    () =>
      findMatchingOrchestratorSessions(duplicateComparisonSessions, {
        projectPath: props.session?.projectPath ?? projectPath,
        projectPurpose: props.session?.projectPurpose ?? projectPurpose,
      }),
    [
      duplicateComparisonSessions,
      projectPath,
      projectPurpose,
      props.session?.projectPath,
      props.session?.projectPurpose,
    ]
  );
  const latestMatchingSession = matchingSessions[0];
  const olderMatchingSessions = latestMatchingSession
    ? matchingSessions.filter(
        (session) => session.sessionId !== latestMatchingSession.sessionId
      )
    : [];
  const hasCreateDuplicate = !props.session && matchingSessions.length > 0;
  const selectedSessionHasDuplicates =
    !!props.session && matchingSessions.length > 1;
  const selectedSessionIsLatestDuplicate =
    !!props.session &&
    latestMatchingSession?.sessionId === props.session.sessionId &&
    olderMatchingSessions.length > 0;
  const latestOtherDuplicate =
    props.session &&
    latestMatchingSession?.sessionId !== props.session.sessionId
      ? latestMatchingSession
      : undefined;

  useEffect(() => {
    const defaultProjectPath = props.capabilities?.defaultProjectPath;
    if (defaultProjectPath) {
      setProjectPath((current) =>
        current.trim().length > 0 ? current : defaultProjectPath
      );
    }
  }, [props.capabilities?.defaultProjectPath]);

  useEffect(() => {
    setCliProvider((current) =>
      current.trim().length > 0 ? current : defaultCliProvider
    );
  }, [defaultCliProvider]);

  useEffect(() => {
    const fallbackModelId = modelOptions[0]?.id ?? props.defaultModelId;
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
    scrollBehaviorRef.current = "bottom";
    setTerminalOutput(props.session?.terminalTail ?? "");
    setTerminalStartOffset(getTerminalTailStartOffset(props.session));
    setLoadingMoreOutput(false);
    setTerminalHistoryError(undefined);
    setQueueOpen(false);
    setScheduleModalOpen(false);
    setEditingSchedule(undefined);
  }, [props.session?.sessionId]);

  useEffect(() => {
    if (!props.session) {
      setSessionTitle("");
      setSessionCliProvider(defaultCliProvider);
      setSessionModelId(props.defaultModelId);
      setSessionCustomAgentId("");
      setExecutionMode("standard");
      setSettingsOpen(false);
      return;
    }
    setSessionTitle(props.session.title);
    setSessionCliProvider(props.session.cliProvider ?? defaultCliProvider);
    setSessionModelId(props.session.model);
    setSessionCustomAgentId(props.session.selectedCustomAgentId ?? "");
    setExecutionMode(props.session.executionMode ?? "standard");
  }, [
    defaultCliProvider,
    props.defaultModelId,
    props.session?.cliProvider,
    props.session?.executionMode,
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
    setTerminalOutput((current) => {
      if (current.length === 0 || terminalTail.length > current.length) {
        scrollBehaviorRef.current = "bottom";
        return terminalTail;
      }
      return current;
    });
  }, [props.session?.terminalTail, props.session?.logSize]);

  useEffect(() => {
    const terminal = terminalRef.current;
    if (!terminal) {
      return;
    }
    if (scrollBehaviorRef.current === "preserve" && scrollSnapshotRef.current) {
      terminal.scrollTop =
        scrollSnapshotRef.current.scrollTop +
        (terminal.scrollHeight - scrollSnapshotRef.current.scrollHeight);
    } else {
      terminal.scrollTop = terminal.scrollHeight;
    }
    scrollBehaviorRef.current = "bottom";
    scrollSnapshotRef.current = null;
  }, [terminalOutput]);

  useEffect(() => {
    sessionUpdateRef.current = props.onSessionUpdate;
  }, [props.onSessionUpdate]);

  useEffect(() => {
    streamOffsetRef.current = props.session?.logSize ?? 0;
    streamReconnectAttemptRef.current = 0;
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
    const reconnectNow = () => {
      if (!props.session || streamState !== "closed") {
        return;
      }
      if (reconnectTimeoutRef.current !== undefined) {
        window.clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = undefined;
      }
      streamReconnectAttemptRef.current = 0;
      setStreamReconnectToken((current) => current + 1);
    };
    const handleVisibilityChange = () => {
      pageVisibleRef.current = document.visibilityState !== "hidden";
      if (pageVisibleRef.current) {
        reconnectNow();
      }
    };
    const handleOnline = () => {
      reconnectNow();
    };

    handleVisibilityChange();
    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("online", handleOnline);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("online", handleOnline);
    };
  }, [props.session, streamState]);

  useEffect(() => {
    if (!props.session) {
      setStreamState("idle");
      return;
    }
    if (typeof EventSource === "undefined") {
      setStreamState("closed");
      return;
    }

    const eventSource = new EventSource(
      `${API_ROOT}/api/orchestrator/sessions/${props.session.sessionId}/stream?offset=${streamOffsetRef.current}`
    );
    const handleOutput = (event: MessageEvent<string>) => {
      streamReconnectAttemptRef.current = 0;
      const payload = JSON.parse(event.data) as {
        chunk: string;
        nextOffset: number;
      };
      streamOffsetRef.current = payload.nextOffset;
      if (payload.chunk.length > 0) {
        scrollBehaviorRef.current = "bottom";
        setTerminalOutput((current) => `${current}${payload.chunk}`);
      }
    };
    const handleHeartbeat = (event: MessageEvent<string>) => {
      streamReconnectAttemptRef.current = 0;
      const payload = JSON.parse(event.data) as {
        offset: number;
      };
      streamOffsetRef.current = payload.offset;
    };
    const handleSession = (event: MessageEvent<string>) => {
      streamReconnectAttemptRef.current = 0;
      const payload = JSON.parse(event.data) as OrchestratorSession;
      sessionUpdateRef.current(payload);
    };
    const handleError = () => {
      eventSource.close();
      setStreamState("closed");
      if (reconnectTimeoutRef.current !== undefined) {
        window.clearTimeout(reconnectTimeoutRef.current);
      }
      const delayMs = getAdaptiveReconnectDelayMs({
        ...readReconnectCostHints(),
        attempt: streamReconnectAttemptRef.current,
        pageVisible: pageVisibleRef.current,
      });
      streamReconnectAttemptRef.current += 1;
      reconnectTimeoutRef.current = window.setTimeout(() => {
        reconnectTimeoutRef.current = undefined;
        setStreamReconnectToken((current) => current + 1);
      }, delayMs);
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

  const canLoadMoreOutput = !!props.session && terminalStartOffset > 0;

  async function handleLoadMoreOutput() {
    if (!props.session || loadingMoreOutput || terminalStartOffset <= 0) {
      return;
    }

    setLoadingMoreOutput(true);
    setTerminalHistoryError(undefined);

    try {
      const terminal = terminalRef.current;
      if (terminal) {
        scrollSnapshotRef.current = {
          scrollTop: terminal.scrollTop,
          scrollHeight: terminal.scrollHeight,
        };
        scrollBehaviorRef.current = "preserve";
      }
      const historyChunk = await api.getOrchestratorTerminalHistory(
        props.session.sessionId,
        terminalStartOffset
      );
      if (historyChunk.chunk.length > 0) {
        setTerminalOutput((current) => `${historyChunk.chunk}${current}`);
      } else {
        scrollBehaviorRef.current = "bottom";
        scrollSnapshotRef.current = null;
      }
      setTerminalStartOffset(historyChunk.startOffset);
    } catch (error) {
      scrollBehaviorRef.current = "bottom";
      scrollSnapshotRef.current = null;
      setTerminalHistoryError(
        error instanceof Error
          ? error.message
          : "Failed to load older tmux output."
      );
    } finally {
      setLoadingMoreOutput(false);
    }
  }

  const capabilityMessage = useMemo(() => {
    if (!props.capabilities) {
      return "Loading orchestrator capabilities…";
    }
    if (props.capabilities.available) {
      const providerNames = (props.capabilities.cliProviders ?? [])
        .map((provider) => provider.displayName)
        .join(" or ");
      return props.capabilities.emailDeliveryAvailable
        ? `tmux session ${props.capabilities.tmuxSessionName} is ready for ${providerNames} delegation and runtime email delivery is configured.`
        : `tmux session ${props.capabilities.tmuxSessionName} is ready for ${providerNames} delegation.`;
    }
    if (!props.capabilities.tmuxInstalled) {
      return "tmux is not available on this machine.";
    }
    if (
      !props.capabilities.copilotInstalled &&
      !props.capabilities.geminiInstalled
    ) {
      return "Neither the `copilot` CLI nor the `gemini` CLI is available on this machine.";
    }
    if (!props.capabilities.copilotInstalled) {
      return "The `copilot` CLI is not available on this machine.";
    }
    if (!props.capabilities.geminiInstalled) {
      return "The `gemini` CLI is not available on this machine.";
    }
    return "The orchestrator feature is unavailable.";
  }, [props.capabilities]);
  const sessionDetailsDirty =
    !!props.session &&
    (sessionTitle.trim() !== props.session.title ||
      sessionCliProvider !== props.session.cliProvider ||
      sessionModelId !== props.session.model ||
      sessionCustomAgentId !== (props.session.selectedCustomAgentId ?? "") ||
      executionMode !== props.session.executionMode);
  const canSaveSessionDetails =
    !!props.session &&
    !props.pending &&
    sessionTitle.trim().length > 0 &&
    sessionModelId.trim().length > 0 &&
    sessionDetailsDirty;
  const settingsPanelId = props.session
    ? `${props.session.sessionId}-session-settings`
    : "orchestrator-session-settings";
  const terminalOutputStyle = {
    "--terminal-output-height": `${props.terminalOutputHeight ?? DEFAULT_ORCHESTRATOR_TERMINAL_HEIGHT}px`,
  } as CSSProperties;

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
              Queue work into a tmux window that runs Copilot or Gemini with
              your chosen model, then monitor the terminal output here.
            </p>
          </div>
          <div className="field-note">{capabilityMessage}</div>
        </div>

        <div className="settings-card orchestrator-form">
          <label className="field-group">
            <span>CLI provider</span>
            <select
              value={cliProvider}
              onChange={(event) => {
                setCliProvider(event.target.value);
                setExecutionMode("standard");
              }}
            >
              {availableCliProviders.map((provider) => (
                <option key={provider.id} value={provider.id}>
                  {provider.displayName}
                </option>
              ))}
            </select>
            {selectedCreateCliProvider?.description ? (
              <small className="field-note">
                {selectedCreateCliProvider.description}
              </small>
            ) : null}
          </label>
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
              placeholder="What is this project for, and what should the delegated CLI session keep in mind?"
            />
          </label>
          {hasCreateDuplicate && latestMatchingSession ? (
            <div className="field-note" role="status">
              A matching orchestrator session already exists from{" "}
              {formatTimestamp(
                latestMatchingSession.updatedAt ??
                  latestMatchingSession.startedAt
              )}
              . Open it to keep working in one place, or create another session
              anyway.
              {props.onSelectSession ? (
                <>
                  {" "}
                  <button
                    type="button"
                    className="ghost-button"
                    onClick={() =>
                      props.onSelectSession?.(latestMatchingSession.sessionId)
                    }
                  >
                    Open latest existing session
                  </button>
                </>
              ) : null}
            </div>
          ) : null}
          <label className="field-group">
            <span>Execution mode</span>
            <select
              value={executionMode}
              disabled={
                !selectedCreateCliProvider?.capabilities.supportsExecutionMode
              }
              onChange={(event) =>
                setExecutionMode(
                  event.target.value === "fleet" ? "fleet" : "standard"
                )
              }
            >
              <option value="standard">Standard</option>
              {selectedCreateCliProvider?.capabilities.supportsExecutionMode ? (
                <option value="fleet">Fleet</option>
              ) : null}
            </select>
            <small className="field-note">
              {selectedCreateCliProvider?.capabilities.supportsExecutionMode
                ? 'Fleet runs delegated Copilot CLI jobs with `-p "/fleet ..."` so Copilot can parallelize work non-interactively.'
                : `${
                    selectedCreateCliProvider?.displayName ?? "This provider"
                  } only supports standard delegated runs.`}
            </small>
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
                Provider:{" "}
                {selectedCreateCliProvider?.displayName ?? cliProvider}
              </span>
              <span>
                Model: {selectedNewSessionModel?.displayName ?? modelId}
              </span>
              <span>
                Mode: {executionMode === "fleet" ? "Fleet" : "Standard"}
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
                  cliProvider,
                  model: modelId,
                  executionMode,
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
            {selectedSessionHasDuplicates ? (
              <div className="field-note" role="status">
                {selectedSessionIsLatestDuplicate
                  ? `${olderMatchingSessions.length} older matching session${
                      olderMatchingSessions.length === 1 ? "" : "s"
                    } still use this same project path and purpose.`
                  : `A newer matching session was updated ${formatTimestamp(
                      latestOtherDuplicate?.updatedAt ??
                        latestOtherDuplicate?.startedAt ??
                        props.session.updatedAt
                    )}.`}
                {latestOtherDuplicate && props.onSelectSession ? (
                  <>
                    {" "}
                    <button
                      type="button"
                      className="ghost-button"
                      onClick={() =>
                        props.onSelectSession?.(latestOtherDuplicate.sessionId)
                      }
                    >
                      Open latest duplicate
                    </button>
                  </>
                ) : null}
                {selectedSessionIsLatestDuplicate &&
                props.onDeleteOlderDuplicates ? (
                  <>
                    {" "}
                    <button
                      type="button"
                      className="ghost-button danger-button"
                      onClick={() =>
                        props.onDeleteOlderDuplicates?.(
                          olderMatchingSessions.map(
                            (session) => session.sessionId
                          )
                        )
                      }
                    >
                      Remove {olderMatchingSessions.length} older duplicate
                      {olderMatchingSessions.length === 1 ? "" : "s"}
                    </button>
                  </>
                ) : null}
              </div>
            ) : null}
            <div className="orchestrator-session-meta">
              <span>{props.session.projectPath}</span>
              <span>
                Provider:{" "}
                {selectedSavedSessionCliProvider?.displayName ??
                  props.session.cliProvider}
              </span>
              <span>
                Model:{" "}
                {selectedSavedSessionModel?.displayName ?? props.session.model}
              </span>
              <span>
                Custom agent: {selectedSavedCustomAgent?.name ?? "None"}
              </span>
              <span>
                Mode:{" "}
                {props.session.executionMode === "fleet" ? "Fleet" : "Standard"}
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
        <div
          id={settingsPanelId}
          className="collapsible-region orchestrator-settings-panel-shell"
          data-state={settingsOpen ? "open" : "closed"}
          aria-hidden={!settingsOpen}
        >
          <div className="collapsible-region-inner orchestrator-settings-panel">
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
                <span>CLI provider</span>
                <select
                  value={sessionCliProvider}
                  onChange={(event) => {
                    setSessionCliProvider(event.target.value);
                    setSessionCustomAgentId("");
                    setExecutionMode("standard");
                  }}
                >
                  {availableCliProviders.map((provider) => (
                    <option key={provider.id} value={provider.id}>
                      {provider.displayName}
                    </option>
                  ))}
                </select>
                {selectedSessionDraftCliProvider?.description ? (
                  <small className="field-note">
                    {selectedSessionDraftCliProvider.description}
                  </small>
                ) : null}
              </label>
              <label className="field-group">
                <span>Model</span>
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
                  disabled={
                    props.session.availableCustomAgents.length === 0 ||
                    !selectedSessionDraftCliProvider?.capabilities
                      .supportsCustomAgents
                  }
                >
                  <option value="">No custom agent</option>
                  {props.session.availableCustomAgents.map((agent) => (
                    <option key={agent.id} value={agent.id}>
                      {agent.name}
                    </option>
                  ))}
                </select>
                <small className="field-note">
                  {!selectedSessionDraftCliProvider?.capabilities
                    .supportsCustomAgents
                    ? `${
                        selectedSessionDraftCliProvider?.displayName ??
                        "This provider"
                      } does not support Copilot custom agents.`
                    : props.session.availableCustomAgents.length > 0
                      ? "The selected custom agent is passed to future delegated Copilot CLI runs."
                      : "No `.agent.md` files were discovered in the project path when this session was created."}
                </small>
              </label>
              <label className="field-group">
                <span>Execution mode</span>
                <select
                  value={executionMode}
                  disabled={
                    !selectedSessionDraftCliProvider?.capabilities
                      .supportsExecutionMode
                  }
                  onChange={(event) =>
                    setExecutionMode(
                      event.target.value === "fleet" ? "fleet" : "standard"
                    )
                  }
                >
                  <option value="standard">Standard</option>
                  {selectedSessionDraftCliProvider?.capabilities
                    .supportsExecutionMode ? (
                    <option value="fleet">Fleet</option>
                  ) : null}
                </select>
                <small className="field-note">
                  {selectedSessionDraftCliProvider?.capabilities
                    .supportsExecutionMode
                    ? 'Fleet runs future delegated Copilot CLI jobs with `-p "/fleet ..."` for non-interactive parallel execution.'
                    : `${
                        selectedSessionDraftCliProvider?.displayName ??
                        "This provider"
                      } only supports standard delegated runs.`}
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
                  Provider:{" "}
                  {selectedSessionDraftCliProvider?.displayName ??
                    sessionCliProvider}
                </span>
                <span>
                  Model:{" "}
                  {selectedSessionDraftModel?.displayName ?? sessionModelId}
                </span>
                <span>
                  Custom agent:{" "}
                  {selectedSessionDraftCustomAgent?.name ?? "None"}
                </span>
                <span>
                  Mode: {executionMode === "fleet" ? "Fleet" : "Standard"}
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
                    cliProvider: sessionCliProvider,
                    model: sessionModelId,
                    selectedCustomAgentId: sessionCustomAgentId || null,
                    executionMode,
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
        </div>
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
        <div
          id={queuePanelId}
          className="collapsible-region orchestrator-job-stack-panel-shell"
          data-state={queueOpen ? "open" : "closed"}
          aria-hidden={!queueOpen}
        >
          <div className="collapsible-region-inner orchestrator-job-stack-panel">
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
                        {job.status === "failed" && canRetryJob(job) ? (
                          <button
                            type="button"
                            className="ghost-button"
                            onClick={() => props.onRetryFailedJob?.(job.jobId)}
                            disabled={props.pending || !props.onRetryFailedJob}
                          >
                            Retry
                          </button>
                        ) : null}
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
        </div>
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
            {canLoadMoreOutput ? (
              <button
                type="button"
                className="ghost-button"
                aria-label={
                  loadingMoreOutput
                    ? "Loading older output"
                    : "Load 2k more lines"
                }
                disabled={props.pending || loadingMoreOutput}
                onClick={() => void handleLoadMoreOutput()}
              >
                <ButtonContent
                  icon={<ScrollIcon />}
                  label={
                    loadingMoreOutput ? "Loading..." : "Load 2k more lines"
                  }
                  compactLabel="Load more"
                />
              </button>
            ) : null}
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
          {canLoadMoreOutput
            ? `Showing the latest ${INITIAL_TERMINAL_TAIL_LINE_LIMIT.toLocaleString()} lines. Load more to prepend older tmux output in ${TERMINAL_HISTORY_PAGE_LINE_LIMIT.toLocaleString()}-line pages.`
            : "Showing all tmux output currently saved for this pane."}{" "}
          Starting a new tmux session closes the current pane. Previous tmux
          output will no longer be available here.
        </div>
        {props.session.systemNotice ? (
          <div className="terminal-toolbar-note field-note" role="status">
            {props.session.systemNotice}
          </div>
        ) : null}
        {terminalHistoryError ? (
          <div className="terminal-toolbar-note">
            <div className="inline-error-banner" role="alert">
              {terminalHistoryError}
            </div>
          </div>
        ) : null}
        <div
          className="terminal-output"
          ref={terminalRef}
          style={terminalOutputStyle}
        >
          <Ansi linkify={false}>
            {terminalOutput || "[min-kb-app] Waiting for tmux output...\n"}
          </Ansi>
        </div>
        <div className="terminal-resize-footer">
          <TerminalResizeHandle
            height={
              props.terminalOutputHeight ?? DEFAULT_ORCHESTRATOR_TERMINAL_HEIGHT
            }
            onHeightChange={props.onTerminalOutputHeightChange}
          />
          <span className="panel-caption">
            Drag or use arrow keys to resize the tmux output and keep the
            delegate controls in view.
          </span>
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
          <div className="composer-footer orchestrator-delegate-footer">
            <div className="composer-meta">
              <span className="orchestrator-command-hint">
                Uses{" "}
                <code>
                  {`copilot --model ${props.session.model}${props.session.selectedCustomAgentId ? ` --agent ${props.session.selectedCustomAgentId}` : ""} --yolo -p ${props.session.executionMode === "fleet" ? "'/fleet ...'" : "..."}`}
                </code>
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

function getTerminalTailStartOffset(session?: OrchestratorSession): number {
  if (!session) {
    return 0;
  }

  return Math.max(
    0,
    session.logSize - new TextEncoder().encode(session.terminalTail).length
  );
}

function resolveAnsiComponent(
  moduleExport: unknown
): (props: AnsiComponentProps) => ReactNode {
  if (typeof moduleExport === "function") {
    return moduleExport as (props: AnsiComponentProps) => ReactNode;
  }
  if (!moduleExport || typeof moduleExport !== "object") {
    throw new Error("ansi-to-react did not export a React component.");
  }

  const levelOneDefault =
    "default" in moduleExport ? moduleExport.default : undefined;
  if (typeof levelOneDefault === "function") {
    return levelOneDefault as (props: AnsiComponentProps) => ReactNode;
  }
  if (
    levelOneDefault &&
    typeof levelOneDefault === "object" &&
    "default" in levelOneDefault &&
    typeof levelOneDefault.default === "function"
  ) {
    return levelOneDefault.default as (props: AnsiComponentProps) => ReactNode;
  }

  throw new Error("ansi-to-react did not export a React component.");
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

function TerminalResizeHandle(props: {
  height: number;
  onHeightChange?: (height: number) => void;
}) {
  function handlePointerDown(event: ReactPointerEvent<HTMLButtonElement>) {
    const onHeightChange = props.onHeightChange;
    if (!onHeightChange) {
      return;
    }

    event.preventDefault();
    const element = event.currentTarget;
    const startY = event.clientY;
    const startHeight = props.height;
    element.setPointerCapture(event.pointerId);

    const handlePointerMove = (moveEvent: PointerEvent) => {
      onHeightChange(
        clampOrchestratorTerminalHeight(
          startHeight + moveEvent.clientY - startY
        )
      );
    };
    const handlePointerFinish = (finishEvent: PointerEvent) => {
      element.removeEventListener("pointermove", handlePointerMove);
      element.removeEventListener("pointerup", handlePointerFinish);
      element.removeEventListener("pointercancel", handlePointerFinish);
      if (element.hasPointerCapture(finishEvent.pointerId)) {
        element.releasePointerCapture(finishEvent.pointerId);
      }
    };

    element.addEventListener("pointermove", handlePointerMove);
    element.addEventListener("pointerup", handlePointerFinish);
    element.addEventListener("pointercancel", handlePointerFinish);
  }

  function handleKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>) {
    const onHeightChange = props.onHeightChange;
    if (!onHeightChange) {
      return;
    }

    switch (event.key) {
      case "ArrowUp":
        event.preventDefault();
        onHeightChange(clampOrchestratorTerminalHeight(props.height - 24));
        break;
      case "ArrowDown":
        event.preventDefault();
        onHeightChange(clampOrchestratorTerminalHeight(props.height + 24));
        break;
      case "Home":
        event.preventDefault();
        onHeightChange(MIN_ORCHESTRATOR_TERMINAL_HEIGHT);
        break;
      case "End":
        event.preventDefault();
        onHeightChange(MAX_ORCHESTRATOR_TERMINAL_HEIGHT);
        break;
      default:
        break;
    }
  }

  return (
    <button
      type="button"
      className="terminal-resize-handle"
      aria-label="Resize tmux output"
      title="Drag to resize. Use arrow keys to resize when focused. Double-click to reset."
      disabled={!props.onHeightChange}
      onDoubleClick={() =>
        props.onHeightChange?.(DEFAULT_ORCHESTRATOR_TERMINAL_HEIGHT)
      }
      onPointerDown={handlePointerDown}
      onKeyDown={handleKeyDown}
    />
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

function canRetryJob(job: OrchestratorJob): boolean {
  return (
    typeof job.prompt === "string" ||
    typeof job.promptPath === "string" ||
    typeof job.attachment !== "undefined"
  );
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

function ScrollIcon() {
  return (
    <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
      <path
        fill="currentColor"
        d="M7 3h7a5 5 0 0 1 0 10H9v4.17l1.59-1.58L12 17l-4 4-4-4 1.41-1.41L7 17.17V3Zm2 8h5a3 3 0 1 0 0-6H9v6Z"
      />
    </svg>
  );
}
