import {
  type AgentSummary,
  type ChatRequest,
  type ChatRuntimeConfig,
  type ChatSession,
  type ChatSessionSummary,
  DEFAULT_CHAT_MODEL,
  type MemoryAnalysisResponse,
  type ModelDescriptor,
  type OrchestratorCapabilities,
  type OrchestratorSession,
  type OrchestratorSessionCreateRequest,
  type OrchestratorSessionUpdateRequest,
  type SkillDescriptor,
  type WorkspaceSummary,
} from "@min-kb-app/shared";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "./api";
import {
  loadDraft,
  loadQueue,
  loadSnapshot,
  loadUiPreferences,
  type QueuedMessage,
  saveDraft,
  saveQueue,
  saveSnapshot,
  saveUiPreferences,
} from "./cache";
import {
  buildCommandPaletteItems,
  type CommandPaletteActionItem,
  type CommandPaletteItem,
} from "./command-palette";
import { AgentRail } from "./components/AgentRail";
import { ChatTimeline } from "./components/ChatTimeline";
import { CommandPalette } from "./components/CommandPalette";
import { MemoryAnalysisModal } from "./components/MemoryAnalysisModal";
import { OrchestratorPane } from "./components/OrchestratorPane";
import { RuntimeControls } from "./components/RuntimeControls";
import { SessionSidebar } from "./components/SessionSidebar";
import { SettingsModal } from "./components/SettingsModal";
import { SidebarResizeHandle } from "./components/SidebarResizeHandle";
import {
  findModelDescriptor,
  formatReasoningEffort,
  normalizeConfigForModel,
} from "./model-config";
import {
  clampSidebarWidth,
  getVisibleModels,
  resolveTheme,
} from "./ui-preferences";

const DEFAULT_MCP_TEXT = JSON.stringify({}, null, 2);
const ORCHESTRATOR_AGENT_ID = "copilot-orchestrator";

export default function App() {
  const cachedSnapshot = useMemo(() => loadSnapshot(), []);
  const cachedUiPreferences = useMemo(() => loadUiPreferences(), []);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const [workspace, setWorkspace] = useState<WorkspaceSummary | undefined>(
    cachedSnapshot.workspace
  );
  const [agents, setAgents] = useState<AgentSummary[]>(cachedSnapshot.agents);
  const [models, setModels] = useState<ModelDescriptor[]>(
    cachedSnapshot.models
  );
  const [sessionsByAgent, setSessionsByAgent] = useState<
    Record<string, ChatSessionSummary[]>
  >(cachedSnapshot.sessionsByAgent);
  const [threadsByKey, setThreadsByKey] = useState<Record<string, ChatSession>>(
    cachedSnapshot.threadsByKey
  );
  const [skills, setSkills] = useState<SkillDescriptor[]>([]);
  const [selectedAgentId, setSelectedAgentId] = useState<string | undefined>(
    cachedSnapshot.agents[0]?.id
  );
  const [selectedSessionId, setSelectedSessionId] = useState<
    string | undefined
  >();
  const [config, setConfig] = useState<ChatRuntimeConfig>(() =>
    createDefaultConfig()
  );
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [offline, setOffline] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [queue, setQueue] = useState<QueuedMessage[]>(loadQueue());
  const [mcpText, setMcpText] = useState(DEFAULT_MCP_TEXT);
  const [mcpError, setMcpError] = useState<string | undefined>();
  const [uiPreferences, setUiPreferences] = useState(cachedUiPreferences);
  const [systemPrefersDark, setSystemPrefersDark] = useState(() =>
    typeof window !== "undefined"
      ? window.matchMedia("(prefers-color-scheme: dark)").matches
      : true
  );
  const [orchestratorCapabilities, setOrchestratorCapabilities] = useState<
    OrchestratorCapabilities | undefined
  >();
  const [orchestratorSessionsById, setOrchestratorSessionsById] = useState<
    Record<string, OrchestratorSession>
  >({});
  const [analyzingMemory, setAnalyzingMemory] = useState(false);
  const [memoryAnalysis, setMemoryAnalysis] = useState<
    MemoryAnalysisResponse | undefined
  >();

  const selectedAgent = agents.find((agent) => agent.id === selectedAgentId);
  const isOrchestratorAgent =
    selectedAgent?.kind === "orchestrator" ||
    selectedAgent?.id === ORCHESTRATOR_AGENT_ID;
  const selectedModel = findModelDescriptor(models, config.model);
  const visibleModels = useMemo(
    () => getVisibleModels(models, uiPreferences.hiddenModelIds, config.model),
    [models, uiPreferences.hiddenModelIds, config.model]
  );
  const resolvedTheme = resolveTheme(uiPreferences.theme, systemPrefersDark);
  const sessions = selectedAgentId
    ? (sessionsByAgent[selectedAgentId] ?? [])
    : [];
  const threadKey =
    selectedAgentId && selectedSessionId
      ? `${selectedAgentId}:${selectedSessionId}`
      : undefined;
  const selectedThread = threadKey ? threadsByKey[threadKey] : undefined;
  const selectedOrchestratorSession = selectedSessionId
    ? orchestratorSessionsById[selectedSessionId]
    : undefined;
  const selectedOrchestratorModel = selectedOrchestratorSession
    ? findModelDescriptor(models, selectedOrchestratorSession.model)
    : undefined;
  const visibleOrchestratorModels = useMemo(
    () =>
      getVisibleModels(
        models,
        uiPreferences.hiddenModelIds,
        selectedOrchestratorSession?.model ?? config.model
      ),
    [
      models,
      uiPreferences.hiddenModelIds,
      selectedOrchestratorSession?.model,
      config.model,
    ]
  );
  const draftKey = `${selectedAgentId ?? "no-agent"}:${selectedSessionId ?? "new"}`;
  const [draft, setDraft] = useState(() => loadDraft(draftKey));
  const enabledSkillCount = skills.filter(
    (skill) => !config.disabledSkills.includes(skill.name)
  ).length;
  const mcpServerCount = Object.keys(config.mcpServers).length;
  const hasMemorySkills = skills.some((skill) => isMemorySkillName(skill.name));
  const commandPaletteItems = useMemo(
    () =>
      buildCommandPaletteItems({
        agents,
        sessionsByAgent,
        sidebarCollapsed: uiPreferences.sidebarCollapsed,
        selectedAgentId,
        selectedSessionId,
      }),
    [
      agents,
      sessionsByAgent,
      uiPreferences.sidebarCollapsed,
      selectedAgentId,
      selectedSessionId,
    ]
  );
  const orchestratorProjectPathSuggestions = useMemo(() => {
    const suggestions = new Set<string>();
    if (orchestratorCapabilities?.defaultProjectPath) {
      suggestions.add(orchestratorCapabilities.defaultProjectPath);
    }
    for (const projectPath of orchestratorCapabilities?.recentProjectPaths ??
      []) {
      suggestions.add(projectPath);
    }
    for (const session of Object.values(orchestratorSessionsById)) {
      suggestions.add(session.projectPath);
    }
    return [...suggestions];
  }, [orchestratorCapabilities, orchestratorSessionsById]);

  useEffect(() => {
    void bootstrap();
  }, []);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const handleChange = (event: MediaQueryListEvent) => {
      setSystemPrefersDark(event.matches);
    };

    setSystemPrefersDark(mediaQuery.matches);
    mediaQuery.addEventListener("change", handleChange);
    return () => mediaQuery.removeEventListener("change", handleChange);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = resolvedTheme;
  }, [resolvedTheme]);

  useEffect(() => {
    saveSnapshot({
      workspace,
      agents,
      models,
      sessionsByAgent,
      threadsByKey,
    });
  }, [workspace, agents, models, sessionsByAgent, threadsByKey]);

  useEffect(() => {
    saveQueue(queue);
  }, [queue]);

  useEffect(() => {
    saveUiPreferences(uiPreferences);
  }, [uiPreferences]);

  useEffect(() => {
    setDraft(loadDraft(draftKey));
  }, [draftKey]);

  useEffect(() => {
    saveDraft(draftKey, draft);
  }, [draftKey, draft]);

  useEffect(() => {
    if (!selectedAgentId) {
      setSkills([]);
      return;
    }

    void refreshAgent(selectedAgentId);
  }, [selectedAgentId]);

  useEffect(() => {
    if (agents.length === 0) {
      return;
    }

    let cancelled = false;
    void (async () => {
      const results = await Promise.allSettled(
        agents.map(
          async (agent) => [agent.id, await api.listSessions(agent.id)] as const
        )
      );
      if (cancelled) {
        return;
      }

      setSessionsByAgent((current) => {
        const next = { ...current };
        for (const result of results) {
          if (result.status === "fulfilled") {
            const [agentId, agentSessions] = result.value;
            next[agentId] = agentSessions;
          }
        }
        return next;
      });
    })();

    return () => {
      cancelled = true;
    };
  }, [agents]);

  useEffect(() => {
    if (!selectedAgentId || !selectedSessionId) {
      return;
    }

    if (isOrchestratorAgent) {
      const cachedSession = orchestratorSessionsById[selectedSessionId];
      if (cachedSession) {
        return;
      }

      void openOrchestratorSession(selectedSessionId);
      return;
    }

    const nextThreadKey = `${selectedAgentId}:${selectedSessionId}`;
    const cachedThread = threadsByKey[nextThreadKey];
    if (cachedThread) {
      const runtimeConfig = normalizeConfigForModel(
        cachedThread.runtimeConfig ?? createDefaultConfig(),
        models
      );
      setConfig(runtimeConfig);
      setMcpText(JSON.stringify(runtimeConfig.mcpServers, null, 2));
      return;
    }

    void openSession(selectedAgentId, selectedSessionId);
  }, [
    selectedAgentId,
    selectedSessionId,
    isOrchestratorAgent,
    threadsByKey,
    orchestratorSessionsById,
    models,
  ]);

  useEffect(() => {
    if (models.length === 0) {
      return;
    }

    setConfig((current) => normalizeConfigForModel(current, models));
  }, [models]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      const isEditable =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        (target instanceof HTMLElement && target.isContentEditable);

      if ((event.metaKey || event.ctrlKey) && event.key === ",") {
        event.preventDefault();
        setCommandPaletteOpen(false);
        setSettingsOpen(true);
        return;
      }

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setSettingsOpen(false);
        setCommandPaletteOpen(true);
        return;
      }

      if (event.key === "Escape") {
        if (commandPaletteOpen) {
          event.preventDefault();
          setCommandPaletteOpen(false);
          return;
        }

        if (settingsOpen) {
          event.preventDefault();
          setSettingsOpen(false);
        }
        return;
      }

      if (
        !isEditable &&
        event.altKey &&
        event.shiftKey &&
        event.key.toLowerCase() === "n"
      ) {
        event.preventDefault();
        handleNewSession();
        return;
      }

      if (!isEditable && event.key === "/") {
        event.preventDefault();
        focusComposer();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [commandPaletteOpen, settingsOpen, models]);

  async function bootstrap() {
    try {
      const [workspaceResponse, agentsResponse, modelsResponse, capabilities] =
        await Promise.all([
          api.getWorkspace(),
          api.listAgents(),
          api.listModels(),
          api.getOrchestratorCapabilities(),
        ]);
      setWorkspace(workspaceResponse);
      setAgents(agentsResponse);
      setModels(modelsResponse);
      setOrchestratorCapabilities(capabilities);
      setConfig((current) => normalizeConfigForModel(current, modelsResponse));
      setOffline(false);
      if (!selectedAgentId && agentsResponse[0]) {
        setSelectedAgentId(agentsResponse[0].id);
      }
    } catch (loadError) {
      setOffline(true);
      setError(getErrorMessage(loadError));
    }
  }

  async function refreshAgent(agentId: string) {
    try {
      const selectedAgentSummary = agents.find((agent) => agent.id === agentId);
      const nextSessions = await api.listSessions(agentId);
      const nextSkills =
        selectedAgentSummary?.kind === "orchestrator" ||
        agentId === ORCHESTRATOR_AGENT_ID
          ? []
          : await api.listSkills(agentId);
      setSessionsByAgent((current) => ({
        ...current,
        [agentId]: nextSessions,
      }));
      setSkills(nextSkills);
      if (!selectedSessionId && nextSessions[0]) {
        setSelectedSessionId(nextSessions[0].sessionId);
      }
      setOffline(false);
    } catch (loadError) {
      setOffline(true);
      setError(getErrorMessage(loadError));
    }
  }

  async function openSession(agentId: string, sessionId: string) {
    try {
      const thread = await api.getSession(agentId, sessionId);
      const nextThreadKey = `${agentId}:${sessionId}`;
      setThreadsByKey((current) => ({ ...current, [nextThreadKey]: thread }));
      const runtimeConfig = normalizeConfigForModel(
        thread.runtimeConfig ?? createDefaultConfig(),
        models
      );
      setConfig(runtimeConfig);
      setMcpText(JSON.stringify(runtimeConfig.mcpServers, null, 2));
      setOffline(false);
    } catch (loadError) {
      setOffline(true);
      setError(getErrorMessage(loadError));
    }
  }

  async function openOrchestratorSession(sessionId: string) {
    try {
      const session = await api.getOrchestratorSession(sessionId);
      setOrchestratorSessionsById((current) => ({
        ...current,
        [sessionId]: session,
      }));
      setOffline(false);
    } catch (loadError) {
      setOffline(true);
      setError(getErrorMessage(loadError));
    }
  }

  function handleSelectAgent(agentId: string) {
    setSelectedAgentId(agentId);
    setSelectedSessionId(undefined);
    setConfig(normalizeConfigForModel(createDefaultConfig(), models));
    setMcpText(DEFAULT_MCP_TEXT);
    setError(undefined);
    setMemoryAnalysis(undefined);
  }

  function handleSelectSession(agentId: string, sessionId: string) {
    setSelectedAgentId(agentId);
    setSelectedSessionId(sessionId);
    setError(undefined);
  }

  function handleNewSession() {
    setSelectedSessionId(undefined);
    setConfig(normalizeConfigForModel(createDefaultConfig(), models));
    setMcpText(DEFAULT_MCP_TEXT);
    setError(undefined);
    if (!isOrchestratorAgent) {
      focusComposer();
    }
  }

  function handleToggleSkill(skillName: string) {
    setConfig((current) => ({
      ...current,
      disabledSkills: current.disabledSkills.includes(skillName)
        ? current.disabledSkills.filter((item) => item !== skillName)
        : [...current.disabledSkills, skillName],
    }));
  }

  function handleToggleModelVisibility(modelId: string) {
    setUiPreferences((current) => {
      const hidden = current.hiddenModelIds.includes(modelId);
      if (hidden) {
        return {
          ...current,
          hiddenModelIds: current.hiddenModelIds.filter(
            (item) => item !== modelId
          ),
        };
      }

      const visibleCount = models.filter(
        (model) => !current.hiddenModelIds.includes(model.id)
      ).length;
      if (visibleCount <= 1) {
        return current;
      }

      return {
        ...current,
        hiddenModelIds: [...current.hiddenModelIds, modelId],
      };
    });
  }

  function handleMcpTextChange(value: string) {
    setMcpText(value);
    try {
      const parsed = JSON.parse(value) as ChatRuntimeConfig["mcpServers"];
      setConfig((current) =>
        normalizeConfigForModel({ ...current, mcpServers: parsed }, models)
      );
      setMcpError(undefined);
    } catch {
      setMcpError("MCP JSON must be valid before sending a message.");
    }
  }

  async function handleSend() {
    if (!selectedAgentId || !draft.trim() || busy || mcpError) {
      return;
    }

    const request: ChatRequest = {
      title: selectedSessionId ? undefined : buildTitleFromPrompt(draft),
      prompt: draft,
      config,
    };

    setBusy(true);
    setError(undefined);

    try {
      const response = await api.sendMessage(
        selectedAgentId,
        selectedSessionId,
        request
      );
      storeThread(response.thread);
      setSelectedSessionId(response.thread.sessionId);
      setDraft("");
      setOffline(false);
    } catch (sendError) {
      setError(getErrorMessage(sendError));
      if (isOfflineError(sendError)) {
        setOffline(true);
        setQueue((current) => [
          ...current,
          {
            id: crypto.randomUUID(),
            agentId: selectedAgentId,
            sessionId: selectedSessionId,
            title: request.title,
            request,
            createdAt: new Date().toISOString(),
          },
        ]);
      }
    } finally {
      setBusy(false);
    }
  }

  async function handleRetryQueuedMessage(message: QueuedMessage) {
    try {
      const response = await api.sendMessage(
        message.agentId,
        message.sessionId,
        message.request
      );
      storeThread(response.thread);
      setSelectedAgentId(message.agentId);
      setSelectedSessionId(response.thread.sessionId);
      setQueue((current) => current.filter((item) => item.id !== message.id));
      setOffline(false);
    } catch (retryError) {
      setError(getErrorMessage(retryError));
    }
  }

  async function handleCreateOrchestratorSession(
    request: OrchestratorSessionCreateRequest
  ) {
    setBusy(true);
    setError(undefined);
    try {
      const session = await api.createOrchestratorSession(request);
      setOrchestratorSessionsById((current) => ({
        ...current,
        [session.sessionId]: session,
      }));
      setSessionsByAgent((current) => ({
        ...current,
        [ORCHESTRATOR_AGENT_ID]: [
          buildOrchestratorListSummary(session),
          ...(current[ORCHESTRATOR_AGENT_ID] ?? []).filter(
            (item) => item.sessionId !== session.sessionId
          ),
        ],
      }));
      setSelectedSessionId(session.sessionId);
      setOffline(false);
    } catch (createError) {
      setError(getErrorMessage(createError));
    } finally {
      setBusy(false);
    }
  }

  async function handleUpdateOrchestratorSession(
    request: OrchestratorSessionUpdateRequest
  ) {
    if (!selectedSessionId) {
      return;
    }

    setBusy(true);
    setError(undefined);
    try {
      const session = await api.updateOrchestratorSession(
        selectedSessionId,
        request
      );
      storeOrchestratorSession(session);
      setOffline(false);
    } catch (updateError) {
      setError(getErrorMessage(updateError));
    } finally {
      setBusy(false);
    }
  }

  async function handleDelegateOrchestratorPrompt(prompt: string) {
    if (!selectedSessionId) {
      return;
    }

    setBusy(true);
    setError(undefined);
    try {
      const session = await api.delegateOrchestratorJob(selectedSessionId, {
        prompt,
      });
      storeOrchestratorSession(session);
      setOffline(false);
    } catch (delegateError) {
      setError(getErrorMessage(delegateError));
    } finally {
      setBusy(false);
    }
  }

  async function handleSendOrchestratorInput(input: string, submit: boolean) {
    if (!selectedSessionId) {
      return;
    }

    setBusy(true);
    setError(undefined);
    try {
      const session = await api.sendOrchestratorInput(selectedSessionId, {
        input,
        submit,
      });
      storeOrchestratorSession(session);
      setOffline(false);
    } catch (inputError) {
      setError(getErrorMessage(inputError));
    } finally {
      setBusy(false);
    }
  }

  async function handleCancelOrchestratorJob() {
    if (!selectedSessionId) {
      return;
    }

    setBusy(true);
    setError(undefined);
    try {
      const session = await api.cancelOrchestratorJob(selectedSessionId);
      storeOrchestratorSession(session);
      setOffline(false);
    } catch (cancelError) {
      setError(getErrorMessage(cancelError));
    } finally {
      setBusy(false);
    }
  }

  async function handleAnalyzeMemory() {
    if (!selectedAgentId || !selectedSessionId) {
      return;
    }

    setAnalyzingMemory(true);
    setError(undefined);
    try {
      const result = await api.analyzeMemory(
        selectedAgentId,
        selectedSessionId,
        {
          config,
        }
      );
      setMemoryAnalysis(result);
      setOffline(false);
    } catch (analysisError) {
      setError(getErrorMessage(analysisError));
    } finally {
      setAnalyzingMemory(false);
    }
  }

  function handleCommandPaletteSelect(item: CommandPaletteItem) {
    setCommandPaletteOpen(false);

    switch (item.kind) {
      case "action":
        handleCommandAction(item);
        return;
      case "agent":
        handleSelectAgent(item.agentId);
        return;
      case "session":
        handleSelectSession(item.agentId, item.sessionId);
        return;
    }
  }

  function handleCommandAction(item: CommandPaletteActionItem) {
    switch (item.actionId) {
      case "new-session":
        handleNewSession();
        return;
      case "open-settings":
        setSettingsOpen(true);
        return;
      case "focus-composer":
        focusComposer();
        return;
      case "toggle-sidebar":
        setUiPreferences((current) => ({
          ...current,
          sidebarCollapsed: !current.sidebarCollapsed,
        }));
        return;
    }
  }

  function handleComposerKeyDown(
    event: ReactKeyboardEvent<HTMLTextAreaElement>
  ) {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();
      void handleSend();
    }
  }

  function focusComposer() {
    window.requestAnimationFrame(() => composerRef.current?.focus());
  }

  function storeThread(thread: ChatSession) {
    const nextThreadKey = `${thread.agentId}:${thread.sessionId}`;
    setThreadsByKey((current) => ({
      ...current,
      [nextThreadKey]: thread,
    }));
    setSessionsByAgent((current) => {
      const existing = current[thread.agentId] ?? [];
      const withoutCurrent = existing.filter(
        (session) => session.sessionId !== thread.sessionId
      );
      return {
        ...current,
        [thread.agentId]: [buildSessionSummary(thread), ...withoutCurrent],
      };
    });
  }

  function storeOrchestratorSession(session: OrchestratorSession) {
    setOrchestratorSessionsById((current) => ({
      ...current,
      [session.sessionId]: session,
    }));
    setSessionsByAgent((current) => {
      const existing = current[ORCHESTRATOR_AGENT_ID] ?? [];
      const withoutCurrent = existing.filter(
        (item) => item.sessionId !== session.sessionId
      );
      return {
        ...current,
        [ORCHESTRATOR_AGENT_ID]: [
          buildOrchestratorListSummary(session),
          ...withoutCurrent,
        ],
      };
    });
  }

  return (
    <div
      className={
        uiPreferences.sidebarCollapsed
          ? "app-shell sidebar-collapsed"
          : "app-shell"
      }
    >
      <AgentRail
        agents={agents}
        selectedAgentId={selectedAgentId}
        offline={offline}
        onSelect={handleSelectAgent}
        onNewSession={handleNewSession}
        onOpenSettings={() => {
          setCommandPaletteOpen(false);
          setSettingsOpen(true);
        }}
      />
      <div className="workspace-shell">
        {!uiPreferences.sidebarCollapsed ? (
          <>
            <div
              className="session-sidebar-shell"
              style={{ width: `${uiPreferences.sidebarWidth}px` }}
            >
              <SessionSidebar
                agent={selectedAgent}
                sessions={sessions}
                selectedSessionId={selectedSessionId}
                sessionLabel={isOrchestratorAgent ? "session" : "chat"}
                newSessionLabel={
                  isOrchestratorAgent ? "New session" : "New chat"
                }
                emptyMessage={
                  isOrchestratorAgent
                    ? "No orchestrator sessions yet."
                    : "No sessions yet for this agent."
                }
                onSelect={(sessionId) => {
                  if (!selectedAgentId) {
                    return;
                  }
                  handleSelectSession(selectedAgentId, sessionId);
                }}
                onNewSession={handleNewSession}
                onToggleCollapse={() =>
                  setUiPreferences((current) => ({
                    ...current,
                    sidebarCollapsed: true,
                  }))
                }
              />
            </div>
            <SidebarResizeHandle
              width={uiPreferences.sidebarWidth}
              onWidthChange={(width) =>
                setUiPreferences((current) => ({
                  ...current,
                  sidebarWidth: clampSidebarWidth(width),
                  sidebarCollapsed: false,
                }))
              }
            />
          </>
        ) : null}

        <main className="chat-pane" aria-busy={busy || analyzingMemory}>
          <header className="chat-pane-header">
            <div>
              <div className="eyebrow">
                {isOrchestratorAgent ? "Orchestrator" : "Conversation"}
              </div>
              <h2>
                {isOrchestratorAgent
                  ? (selectedOrchestratorSession?.title ??
                    selectedAgent?.title ??
                    "min-kb-app")
                  : (selectedThread?.title ??
                    selectedAgent?.title ??
                    "min-kb-app")}
              </h2>
              <p>
                {isOrchestratorAgent
                  ? selectedOrchestratorSession
                    ? `Model: ${
                        selectedOrchestratorModel?.displayName ??
                        selectedOrchestratorSession.model
                      } • ${selectedOrchestratorSession.jobs.length} delegated job${
                        selectedOrchestratorSession.jobs.length === 1 ? "" : "s"
                      } • ${selectedOrchestratorSession.status}`
                    : orchestratorCapabilities
                      ? `Default project path: ${orchestratorCapabilities.defaultProjectPath}`
                      : "Waiting for orchestrator capabilities."
                  : workspace
                    ? `Store: ${workspace.storeRoot}`
                    : "Waiting for the runtime to resolve the min-kb-store root."}
              </p>
            </div>
            <div className="header-actions">
              <div className="shortcut-hint">
                {isOrchestratorAgent
                  ? "Cmd/Ctrl+K switch - Alt+Shift+N new session"
                  : "Cmd/Ctrl+K switch - Cmd/Ctrl+Enter send"}
              </div>
              <div className="header-button-row">
                {!isOrchestratorAgent ? (
                  <button
                    type="button"
                    className="ghost-button"
                    onClick={() => void handleAnalyzeMemory()}
                    disabled={
                      !selectedSessionId ||
                      !selectedThread ||
                      !hasMemorySkills ||
                      busy ||
                      analyzingMemory
                    }
                    title={
                      hasMemorySkills
                        ? "Analyze this chat with GPT-4.1 and memory skills"
                        : "No memory-related skills detected for this agent"
                    }
                  >
                    {analyzingMemory ? "Analyzing..." : "Analyze memory"}
                  </button>
                ) : null}
                <button
                  type="button"
                  className="ghost-button"
                  onClick={() => {
                    setSettingsOpen(false);
                    setCommandPaletteOpen(true);
                  }}
                >
                  Switch
                </button>
                <button
                  type="button"
                  className="ghost-button sidebar-toggle-button"
                  onClick={() =>
                    setUiPreferences((current) => ({
                      ...current,
                      sidebarCollapsed: !current.sidebarCollapsed,
                    }))
                  }
                >
                  {uiPreferences.sidebarCollapsed ? "Show chats" : "Hide chats"}
                </button>
              </div>
            </div>
          </header>

          {!isOrchestratorAgent ? (
            <RuntimeControls
              models={models}
              visibleModels={visibleModels}
              skills={skills}
              config={config}
              mcpText={mcpText}
              mcpError={mcpError}
              onModelChange={(model) =>
                setConfig((current) =>
                  normalizeConfigForModel({ ...current, model }, models)
                )
              }
              onReasoningEffortChange={(reasoningEffort) =>
                setConfig((current) =>
                  normalizeConfigForModel(
                    { ...current, reasoningEffort },
                    models
                  )
                )
              }
              onSkillToggle={handleToggleSkill}
              onMcpTextChange={handleMcpTextChange}
            />
          ) : null}

          {queue.length > 0 ? (
            <section className="queue-banner">
              <strong>{queue.length} queued message(s)</strong>
              <div className="queue-list">
                {queue.map((message) => (
                  <button
                    type="button"
                    key={message.id}
                    className="queued-item"
                    onClick={() => void handleRetryQueuedMessage(message)}
                  >
                    Retry {message.agentId} -{" "}
                    {new Date(message.createdAt).toLocaleTimeString()}
                  </button>
                ))}
              </div>
            </section>
          ) : null}

          {isOrchestratorAgent ? (
            <OrchestratorPane
              capabilities={orchestratorCapabilities}
              session={selectedOrchestratorSession}
              models={visibleOrchestratorModels}
              defaultModelId={config.model}
              projectPathSuggestions={orchestratorProjectPathSuggestions}
              pending={busy}
              error={error}
              onCreateSession={(request) =>
                void handleCreateOrchestratorSession(request)
              }
              onUpdateSession={(request) =>
                void handleUpdateOrchestratorSession(request)
              }
              onDelegate={(prompt) =>
                void handleDelegateOrchestratorPrompt(prompt)
              }
              onSendInput={(input, submit) =>
                void handleSendOrchestratorInput(input, submit)
              }
              onCancelJob={() => void handleCancelOrchestratorJob()}
              onSessionUpdate={(session) => storeOrchestratorSession(session)}
            />
          ) : (
            <>
              <ChatTimeline
                thread={selectedThread}
                pending={busy}
                error={error}
              />

              <div className="composer-shell">
                <textarea
                  ref={composerRef}
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  onKeyDown={handleComposerKeyDown}
                  placeholder={
                    selectedAgentId
                      ? "Send a message..."
                      : "Choose an agent first..."
                  }
                  rows={5}
                  aria-label="Message composer"
                />
                <div className="composer-footer">
                  <div className="composer-meta">
                    <span>
                      Model: {selectedModel?.displayName ?? config.model}
                    </span>
                    {config.reasoningEffort ? (
                      <span>
                        Reasoning:{" "}
                        {formatReasoningEffort(config.reasoningEffort)}
                      </span>
                    ) : null}
                    <span>Skills: {enabledSkillCount}</span>
                    <span>MCP: {mcpServerCount}</span>
                  </div>
                  <button
                    type="button"
                    className="primary-button"
                    onClick={() => void handleSend()}
                    disabled={
                      !selectedAgentId ||
                      !draft.trim() ||
                      busy ||
                      Boolean(mcpError)
                    }
                  >
                    {busy ? "Sending..." : "Send"}
                  </button>
                </div>
              </div>
            </>
          )}
        </main>
      </div>

      <SettingsModal
        open={settingsOpen}
        theme={uiPreferences.theme}
        resolvedTheme={resolvedTheme}
        models={models}
        hiddenModelIds={uiPreferences.hiddenModelIds}
        selectedModelId={config.model}
        onClose={() => setSettingsOpen(false)}
        onThemeChange={(theme) =>
          setUiPreferences((current) => ({
            ...current,
            theme,
          }))
        }
        onToggleModelVisibility={handleToggleModelVisibility}
        onShowAllModels={() =>
          setUiPreferences((current) => ({
            ...current,
            hiddenModelIds: [],
          }))
        }
      />

      <CommandPalette
        open={commandPaletteOpen}
        items={commandPaletteItems}
        onClose={() => setCommandPaletteOpen(false)}
        onSelect={handleCommandPaletteSelect}
      />

      <MemoryAnalysisModal
        open={Boolean(memoryAnalysis)}
        result={memoryAnalysis}
        onClose={() => setMemoryAnalysis(undefined)}
      />
    </div>
  );
}

function createDefaultConfig(): ChatRuntimeConfig {
  return {
    model: DEFAULT_CHAT_MODEL,
    disabledSkills: [],
    mcpServers: {},
  };
}

function buildSessionSummary(thread: ChatSession): ChatSessionSummary {
  return {
    sessionId: thread.sessionId,
    agentId: thread.agentId,
    title: thread.title,
    startedAt: thread.startedAt,
    summary: thread.summary,
    manifestPath: thread.manifestPath,
    turnCount: thread.turnCount,
    lastTurnAt: thread.lastTurnAt,
    runtimeConfig: thread.runtimeConfig,
  };
}

function buildOrchestratorListSummary(
  session: OrchestratorSession
): ChatSessionSummary {
  return {
    sessionId: session.sessionId,
    agentId: session.agentId,
    title: session.title,
    startedAt: session.startedAt,
    summary: `${session.projectPurpose} • ${session.status}`,
    manifestPath: session.manifestPath,
    turnCount: session.jobs.length,
    lastTurnAt: session.updatedAt,
  };
}

function buildTitleFromPrompt(prompt: string): string {
  return prompt.trim().split(/\s+/).slice(0, 6).join(" ") || "New session";
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error";
}

function isOfflineError(error: unknown): boolean {
  return (
    error instanceof TypeError ||
    (error instanceof Error && error.message.includes("Failed to fetch"))
  );
}

function isMemorySkillName(name: string): boolean {
  return /memory|working-memory|short-term|long-term/i.test(name);
}
