import type {
  ModelDescriptor,
  OrchestratorCapabilities,
  OrchestratorSession,
  OrchestratorSessionCreateRequest,
  OrchestratorSessionUpdateRequest,
} from "@min-kb-app/shared";
import Ansi from "ansi-to-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { API_ROOT } from "../api";

interface OrchestratorPaneProps {
  capabilities?: OrchestratorCapabilities;
  session?: OrchestratorSession;
  models: ModelDescriptor[];
  defaultModelId: string;
  projectPathSuggestions: string[];
  pending: boolean;
  error?: string;
  onCreateSession: (request: OrchestratorSessionCreateRequest) => void;
  onUpdateSession: (request: OrchestratorSessionUpdateRequest) => void;
  onDelegate: (prompt: string) => void;
  onSendInput: (input: string, submit: boolean) => void;
  onCancelJob: () => void;
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
  const [terminalInput, setTerminalInput] = useState("");
  const [sessionTitle, setSessionTitle] = useState(props.session?.title ?? "");
  const [sessionModelId, setSessionModelId] = useState(
    props.session?.model ?? props.defaultModelId
  );
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [terminalOutput, setTerminalOutput] = useState(
    props.session?.terminalTail ?? ""
  );
  const [streamState, setStreamState] = useState<"idle" | "live" | "closed">(
    "idle"
  );
  const terminalRef = useRef<HTMLDivElement>(null);
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
    setTerminalInput("");
    setTerminalOutput(props.session?.terminalTail ?? "");
  }, [props.session?.sessionId]);

  useEffect(() => {
    if (!props.session) {
      setSessionTitle("");
      setSessionModelId(props.defaultModelId);
      setSettingsOpen(false);
      return;
    }
    setSessionTitle(props.session.title);
    setSessionModelId(props.session.model);
  }, [
    props.defaultModelId,
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
    if (!props.session) {
      setStreamState("idle");
      return;
    }

    const eventSource = new EventSource(
      `${API_ROOT}/api/orchestrator/sessions/${props.session.sessionId}/stream?offset=${props.session.logSize}`
    );
    const handleOutput = (event: MessageEvent<string>) => {
      const payload = JSON.parse(event.data) as {
        chunk: string;
        nextOffset: number;
      };
      if (payload.chunk.length > 0) {
        setTerminalOutput((current) => `${current}${payload.chunk}`);
      }
    };
    const handleSession = (event: MessageEvent<string>) => {
      const payload = JSON.parse(event.data) as OrchestratorSession;
      props.onSessionUpdate(payload);
    };
    const handleError = () => {
      setStreamState("closed");
    };

    setStreamState("live");
    eventSource.addEventListener("output", handleOutput as EventListener);
    eventSource.addEventListener("session", handleSession as EventListener);
    eventSource.onerror = handleError;
    return () => {
      eventSource.removeEventListener("output", handleOutput as EventListener);
      eventSource.removeEventListener(
        "session",
        handleSession as EventListener
      );
      eventSource.close();
      setStreamState("closed");
    };
  }, [props.onSessionUpdate, props.session?.logSize, props.session?.sessionId]);

  const capabilityMessage = useMemo(() => {
    if (!props.capabilities) {
      return "Loading orchestrator capabilities…";
    }
    if (props.capabilities.available) {
      return `tmux session ${props.capabilities.tmuxSessionName} is ready for delegation.`;
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
      sessionModelId !== props.session.model);
  const canSaveSessionDetails =
    !!props.session &&
    !props.pending &&
    sessionTitle.trim().length > 0 &&
    sessionModelId.trim().length > 0 &&
    sessionDetailsDirty;
  const settingsPanelId = props.session
    ? `${props.session.sessionId}-session-settings`
    : "orchestrator-session-settings";

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
              {props.session.jobs.length} delegated job
              {props.session.jobs.length === 1 ? "" : "s"}
            </span>
            <span>
              {props.session.activeJobId
                ? `Active job: ${props.session.activeJobId}`
                : `Stream ${streamState === "live" ? "connected" : streamState}`}
            </span>
          </div>
        </div>
        <div className="orchestrator-session-actions">
          <button
            type="button"
            className="ghost-button"
            aria-expanded={settingsOpen}
            aria-controls={settingsPanelId}
            onClick={() => setSettingsOpen((current) => !current)}
          >
            {settingsOpen ? "Hide settings" : "Session settings"}
          </button>
          {props.session.activeJobId ? (
            <button
              type="button"
              className="ghost-button"
              disabled={props.pending}
              onClick={props.onCancelJob}
            >
              {props.pending ? "Cancelling..." : "Cancel job"}
            </button>
          ) : null}
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
          <span className="panel-caption">Primary workspace</span>
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
            <textarea
              value={delegatePrompt}
              onChange={(event) => setDelegatePrompt(event.target.value)}
              rows={5}
              placeholder="Queue another async prompt for the Copilot CLI window."
            />
          </label>
          <div className="composer-footer">
            <div className="composer-meta">
              <span>
                {`Uses \`copilot --model ${props.session.model} --yolo -p\``}
              </span>
              <span>Queues immediately</span>
            </div>
            <button
              type="button"
              className="primary-button"
              disabled={props.pending || !delegatePrompt.trim()}
              onClick={() => {
                props.onDelegate(delegatePrompt);
                setDelegatePrompt("");
              }}
            >
              {props.pending ? "Queueing..." : "Delegate prompt"}
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
              <span>Submit sends Enter</span>
            </div>
            <div className="header-button-row">
              <button
                type="button"
                className="ghost-button"
                disabled={props.pending || !terminalInput.trim()}
                onClick={() => {
                  props.onSendInput(terminalInput, false);
                  setTerminalInput("");
                }}
              >
                Send text
              </button>
              <button
                type="button"
                className="primary-button"
                disabled={props.pending || !terminalInput.trim()}
                onClick={() => {
                  props.onSendInput(terminalInput, true);
                  setTerminalInput("");
                }}
              >
                Send input
              </button>
            </div>
          </div>
        </div>
      </div>

      {settingsOpen ? (
        <div
          id={settingsPanelId}
          className="settings-card orchestrator-settings-panel"
        >
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
              <span>Applies to future delegated jobs</span>
            </div>
            <button
              type="button"
              className="primary-button"
              disabled={!canSaveSessionDetails}
              onClick={() =>
                props.onUpdateSession({
                  title: sessionTitle.trim(),
                  model: sessionModelId,
                })
              }
            >
              Save details
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
