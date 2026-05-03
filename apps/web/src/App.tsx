import {
  type AgentSummary,
  type ChatProviderDescriptor,
  type ChatRequest,
  type ChatRuntimeConfig,
  type ChatSession,
  type ChatSessionSummary,
  createDefaultChatRuntimeConfig,
  type MemoryAnalysisResponse,
  type ModelDescriptor,
  mergeChatRuntimeConfigs,
  type OrchestratorCapabilities,
  type OrchestratorSchedule,
  type OrchestratorScheduleCreateRequest,
  type OrchestratorScheduleUpdateRequest,
  type OrchestratorSession,
  type OrchestratorSessionCreateRequest,
  type OrchestratorSessionUpdateRequest,
  type ScheduleTask,
  type ScheduleTaskCreateRequest,
  type ScheduleTaskUpdateRequest,
  type SkillDescriptor,
  type WorkspaceSummary,
} from "@min-kb-app/shared";
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "./api";
import { toAttachmentUpload } from "./attachments";
import {
  clearDraft,
  loadAppState,
  loadCompletionNotificationDeliveries,
  loadDraft,
  loadQueue,
  loadSessionNotificationAcks,
  loadSnapshot,
  loadUiPreferences,
  type QueuedMessage,
  saveAppState,
  saveCompletionNotificationDeliveries,
  saveDraft,
  saveQueue,
  saveSessionNotificationAcks,
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
import { DangerConfirmModal } from "./components/DangerConfirmModal";
import { MemoryAnalysisModal } from "./components/MemoryAnalysisModal";
import { OrchestratorPane } from "./components/OrchestratorPane";
import { RuntimeControls } from "./components/RuntimeControls";
import { SchedulePane } from "./components/SchedulePane";
import { SessionSidebar } from "./components/SessionSidebar";
import { SettingsModal } from "./components/SettingsModal";
import { SidebarResizeHandle } from "./components/SidebarResizeHandle";
import { SingleAttachmentPicker } from "./components/SingleAttachmentPicker";
import {
  getAdaptivePollDelayMs,
  readReconnectCostHints,
} from "./mobile-reconnect";
import {
  findModelDescriptor,
  formatReasoningEffort,
  normalizeConfigForModel,
} from "./model-config";
import {
  acknowledgeSessionNotification,
  getSessionNotificationKey,
  listAgentNotificationIds,
  listSessionNotificationIds,
} from "./session-notifications";
import {
  type BrowserNotificationPermission,
  type CompletionObservationState,
  deliverCompletionNotification,
  evaluateCompletionNotifications,
  getBrowserNotificationPermission,
  requestBrowserNotificationPermission,
} from "./task-completion-notifications";
import {
  clampOrchestratorTerminalHeight,
  clampSidebarWidth,
  getVisibleModels,
  resolveTheme,
} from "./ui-preferences";

const ORCHESTRATOR_AGENT_ID = "copilot-orchestrator";
const SCHEDULE_AGENT_ID = "copilot-schedule";
const MAX_CACHED_THREAD_COUNT = 3;
const MAX_CACHED_THREAD_TURNS = 30;
const HEADER_VALUE_MAX_LENGTH = 48;

type DangerAction =
  | {
      kind: "chat-session";
      agentId: string;
      sessionId: string;
      title: string;
      turnCount: number;
      lastActivity?: string;
    }
  | {
      kind: "orchestrator-session";
      sessionId: string;
      title: string;
      queuedJobCount: number;
      delegatedJobCount: number;
      status: OrchestratorSession["status"];
    }
  | {
      kind: "orchestrator-duplicates";
      title: string;
      keptSessionId: string;
      duplicateSessionIds: string[];
    }
  | {
      kind: "orchestrator-session-restart";
      sessionId: string;
      title: string;
      queuedJobCount: number;
      delegatedJobCount: number;
      status: OrchestratorSession["status"];
      runningJobPromptPreview?: string;
    }
  | {
      kind: "orchestrator-job";
      sessionId: string;
      jobId: string;
      promptPreview: string;
      submittedAt: string;
    }
  | {
      kind: "schedule-task";
      scheduleId: string;
      title: string;
      agentId: string;
      lastRunStatus: ScheduleTask["lastRunStatus"];
    };

interface PendingAssistantSnapshot {
  assistantText: string;
  thinkingText: string;
}

function createEmptyPendingAssistantSnapshot(): PendingAssistantSnapshot {
  return {
    assistantText: "",
    thinkingText: "",
  };
}

export default function App() {
  const cachedSnapshot = useMemo(() => loadSnapshot(), []);
  const cachedAppState = useMemo(() => loadAppState(), []);
  const cachedUiPreferences = useMemo(() => loadUiPreferences(), []);
  const cachedSessionNotificationAcks = useMemo(
    () => loadSessionNotificationAcks(),
    []
  );
  const cachedCompletionNotificationDeliveries = useMemo(
    () => loadCompletionNotificationDeliveries(),
    []
  );
  const initialSelectedAgentId =
    cachedAppState.selectedAgentId ?? cachedSnapshot.agents[0]?.id;
  const initialSelectedAgent = cachedSnapshot.agents.find(
    (agent) => agent.id === initialSelectedAgentId
  );
  const initialConfig = useMemo(
    () =>
      normalizeConfigForModel(
        cachedAppState.preferNewSession
          ? cachedAppState.draftConfig
          : createDefaultConfig(
              initialSelectedAgent,
              cachedUiPreferences,
              cachedSnapshot.models
            ),
        cachedSnapshot.models
      ),
    [
      cachedAppState.draftConfig,
      cachedAppState.preferNewSession,
      cachedSnapshot.models,
      initialSelectedAgent,
    ]
  );
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const completionObservationRef = useRef<CompletionObservationState>({});
  const pageVisibleRef = useRef(
    typeof document === "undefined"
      ? true
      : document.visibilityState !== "hidden"
  );
  const windowFocusedRef = useRef(
    typeof document === "undefined" ? true : document.hasFocus()
  );
  const sessionRefreshTimeoutRef = useRef<number | undefined>(undefined);
  const sessionRefreshInFlightRef = useRef(false);
  const queuedImmediateSessionRefreshRef = useRef(false);
  const sessionRefreshFailureCountRef = useRef(0);
  const triggerSessionRefreshRef = useRef<(() => void) | undefined>(undefined);
  const threadsByKeyRef = useRef<Record<string, ChatSession>>(
    cachedSnapshot.threadsByKey
  );
  const [workspace, setWorkspace] = useState<WorkspaceSummary | undefined>(
    cachedSnapshot.workspace
  );
  const [agents, setAgents] = useState<AgentSummary[]>(cachedSnapshot.agents);
  const [providers, setProviders] = useState<ChatProviderDescriptor[]>(
    cachedSnapshot.providers
  );
  const [defaultProvider, setDefaultProvider] = useState<string>(
    cachedSnapshot.defaultProvider
  );
  const [models, setModels] = useState<ModelDescriptor[]>(
    cachedSnapshot.models
  );
  const [sessionsByAgent, setSessionsByAgent] = useState<
    Record<string, ChatSessionSummary[]>
  >(cachedSnapshot.sessionsByAgent);
  const [threadsByKey, setThreadsByKey] = useState<Record<string, ChatSession>>(
    cachedSnapshot.threadsByKey
  );
  const [staleThreadKeys, setStaleThreadKeys] = useState<Record<string, true>>(
    () =>
      Object.fromEntries(
        Object.keys(cachedSnapshot.threadsByKey).map((threadKey) => [
          threadKey,
          true,
        ])
      )
  );
  const [skills, setSkills] = useState<SkillDescriptor[]>([]);
  const [selectedAgentId, setSelectedAgentId] = useState<string | undefined>(
    initialSelectedAgentId
  );
  const [selectedSessionId, setSelectedSessionId] = useState<
    string | undefined
  >(cachedAppState.selectedSessionId);
  const [preferNewSession, setPreferNewSession] = useState(
    cachedAppState.preferNewSession
  );
  const [config, setConfig] = useState<ChatRuntimeConfig>(() => initialConfig);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [offline, setOffline] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [pendingAssistantSnapshot, setPendingAssistantSnapshot] =
    useState<PendingAssistantSnapshot>(createEmptyPendingAssistantSnapshot);
  const [queue, setQueue] = useState<QueuedMessage[]>(loadQueue());
  const [mcpText, setMcpText] = useState(() =>
    cachedAppState.preferNewSession
      ? cachedAppState.draftMcpText
      : JSON.stringify(initialConfig.mcpServers, null, 2)
  );
  const [mcpError, setMcpError] = useState<string | undefined>();
  const [uiPreferences, setUiPreferences] = useState(cachedUiPreferences);
  const [sessionNotificationAcks, setSessionNotificationAcks] = useState(
    cachedSessionNotificationAcks
  );
  const [
    completionNotificationDeliveries,
    setCompletionNotificationDeliveries,
  ] = useState(cachedCompletionNotificationDeliveries);
  const [browserNotificationPermission, setBrowserNotificationPermission] =
    useState<BrowserNotificationPermission>(() =>
      getBrowserNotificationPermission()
    );
  const [mobileViewport, setMobileViewport] = useState(() =>
    typeof window !== "undefined"
      ? window.matchMedia("(max-width: 920px)").matches
      : false
  );
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
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
  const [
    orchestratorSchedulesBySessionId,
    setOrchestratorSchedulesBySessionId,
  ] = useState<Record<string, OrchestratorSchedule[]>>({});
  const [scheduleTasksById, setScheduleTasksById] = useState<
    Record<string, ScheduleTask>
  >({});
  const [analyzingMemory, setAnalyzingMemory] = useState(false);
  const [memoryAnalysisOpen, setMemoryAnalysisOpen] = useState(false);
  const [memoryAnalysis, setMemoryAnalysis] = useState<
    MemoryAnalysisResponse | undefined
  >();
  const [dangerAction, setDangerAction] = useState<DangerAction | undefined>();
  const [deletePending, setDeletePending] = useState(false);
  const [deferInitialSessionLoad, setDeferInitialSessionLoad] = useState(
    Boolean(
      cachedAppState.selectedAgentId &&
        cachedAppState.selectedSessionId &&
        !cachedAppState.preferNewSession
    )
  );
  const [sessionLoadPending, setSessionLoadPending] = useState(false);
  const [sessionLoadTarget, setSessionLoadTarget] = useState<string>();

  const selectedAgent = agents.find((agent) => agent.id === selectedAgentId);
  const isOrchestratorAgent =
    selectedAgent?.kind === "orchestrator" ||
    selectedAgent?.id === ORCHESTRATOR_AGENT_ID;
  const isScheduleAgent =
    selectedAgent?.kind === "schedule" ||
    selectedAgent?.id === SCHEDULE_AGENT_ID;
  const selectedModel = findModelDescriptor(
    models,
    config.model,
    config.provider
  );
  const selectedDefaultChatModel = findModelDescriptor(
    models,
    uiPreferences.defaultChatModelId,
    uiPreferences.defaultChatProvider
  );
  const buildDefaultConfig = (agent?: AgentSummary) =>
    createDefaultConfig(agent, uiPreferences, models);
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
  const selectedScheduleTask = selectedSessionId
    ? scheduleTasksById[selectedSessionId]
    : undefined;
  const selectedScheduledOrchestratorSession =
    selectedScheduleTask?.targetKind === "orchestrator" &&
    selectedScheduleTask.orchestratorSessionId
      ? orchestratorSessionsById[selectedScheduleTask.orchestratorSessionId]
      : undefined;
  const selectedOrchestratorSchedules = selectedSessionId
    ? (orchestratorSchedulesBySessionId[selectedSessionId] ?? [])
    : [];
  const selectedScheduleThreadKey = selectedScheduleTask
    ? selectedScheduleTask.targetKind === "chat" &&
      selectedScheduleTask.agentId &&
      selectedScheduleTask.chatSessionId
      ? `${selectedScheduleTask.agentId}:${selectedScheduleTask.chatSessionId}`
      : undefined
    : undefined;
  const selectedScheduleThread = selectedScheduleThreadKey
    ? threadsByKey[selectedScheduleThreadKey]
    : undefined;
  const selectedSessionSummary =
    selectedAgentId && selectedSessionId
      ? (sessionsByAgent[selectedAgentId] ?? []).find(
          (session) => session.sessionId === selectedSessionId
        )
      : undefined;
  const selectedOrchestratorQueuedJobCount =
    selectedOrchestratorSession?.jobs.filter((job) => job.status === "queued")
      .length ?? 0;
  const selectedOrchestratorModel = selectedOrchestratorSession
    ? findModelDescriptor(
        models,
        selectedOrchestratorSession.model,
        selectedOrchestratorSession.cliProvider
      )
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
  const [chatAttachment, setChatAttachment] = useState<File | undefined>();
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
  const notificationSessionIds = useMemo(
    () => listSessionNotificationIds(sessions, sessionNotificationAcks),
    [sessionNotificationAcks, sessions]
  );
  const notificationAgentIds = useMemo(
    () => listAgentNotificationIds(sessionsByAgent, sessionNotificationAcks),
    [sessionNotificationAcks, sessionsByAgent]
  );
  const selectedAgentHasNotifications =
    selectedAgentId !== undefined && notificationAgentIds.has(selectedAgentId);
  const sidebarVisible = mobileViewport
    ? mobileSidebarOpen
    : !uiPreferences.sidebarCollapsed;
  const scheduleTargetLabel =
    selectedScheduleTask?.targetKind === "orchestrator"
      ? (selectedScheduledOrchestratorSession?.title ??
        selectedScheduleTask.orchestratorSessionId)
      : selectedScheduleTask?.agentId
        ? (agents.find((agent) => agent.id === selectedScheduleTask.agentId)
            ?.title ?? selectedScheduleTask.agentId)
        : undefined;
  const chatHeaderSummary = isOrchestratorAgent
    ? selectedOrchestratorSession
      ? [
          formatHeaderSummaryValue(
            "Model",
            selectedOrchestratorModel?.displayName ??
              selectedOrchestratorSession.model
          ),
          formatHeaderSummaryValue(
            "Jobs",
            `${selectedOrchestratorSession.jobs.length}`
          ),
          selectedOrchestratorQueuedJobCount > 0
            ? formatHeaderSummaryValue(
                "Queued",
                `${selectedOrchestratorQueuedJobCount}`
              )
            : undefined,
          formatHeaderSummaryValue(
            "Status",
            selectedOrchestratorSession.status
          ),
        ]
          .filter(Boolean)
          .join(" • ")
      : orchestratorCapabilities
        ? formatHeaderSummaryValue(
            "Project",
            orchestratorCapabilities.defaultProjectPath
          )
        : "Waiting for orchestrator capabilities."
    : isScheduleAgent
      ? selectedScheduleTask
        ? [
            formatHeaderSummaryValue(
              selectedScheduleTask.targetKind === "orchestrator"
                ? "Session"
                : "Agent",
              scheduleTargetLabel
            ),
            formatHeaderSummaryValue(
              "Next",
              new Date(selectedScheduleTask.nextRunAt).toLocaleString()
            ),
            formatHeaderSummaryValue(
              "Status",
              selectedScheduleTask.lastRunStatus
            ),
          ]
            .filter(Boolean)
            .join(" • ")
        : "Choose a scheduled task or create a new one."
      : workspace
        ? formatHeaderSummaryValue("Store", workspace.storeRoot)
        : "Waiting for the runtime to resolve the min-kb-store root.";
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
    const mediaQuery = window.matchMedia("(max-width: 920px)");
    const handleChange = (event: MediaQueryListEvent) => {
      setMobileViewport(event.matches);
      if (!event.matches) {
        setMobileSidebarOpen(false);
      }
    };

    setMobileViewport(mediaQuery.matches);
    mediaQuery.addEventListener("change", handleChange);
    return () => mediaQuery.removeEventListener("change", handleChange);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = resolvedTheme;
  }, [resolvedTheme]);

  useEffect(() => {
    threadsByKeyRef.current = threadsByKey;
  }, [threadsByKey]);

  useEffect(() => {
    saveSnapshot({
      workspace,
      agents,
      providers,
      defaultProvider,
      models,
      sessionsByAgent,
      threadsByKey: compactThreadsForSnapshot(threadsByKey),
    });
  }, [
    workspace,
    agents,
    providers,
    defaultProvider,
    models,
    sessionsByAgent,
    threadsByKey,
  ]);

  useEffect(() => {
    saveQueue(queue);
  }, [queue]);

  useEffect(() => {
    saveUiPreferences(uiPreferences);
  }, [uiPreferences]);

  useEffect(() => {
    saveSessionNotificationAcks(sessionNotificationAcks);
  }, [sessionNotificationAcks]);

  useEffect(() => {
    saveCompletionNotificationDeliveries(completionNotificationDeliveries);
  }, [completionNotificationDeliveries]);

  useEffect(() => {
    saveAppState({
      selectedAgentId,
      selectedSessionId: preferNewSession ? undefined : selectedSessionId,
      preferNewSession,
      draftConfig: config,
      draftMcpText: mcpText,
    });
  }, [config, mcpText, preferNewSession, selectedAgentId, selectedSessionId]);

  useEffect(() => {
    setDraft(loadDraft(draftKey));
    setChatAttachment(undefined);
  }, [draftKey]);

  useEffect(() => {
    saveDraft(draftKey, draft);
  }, [draftKey, draft]);

  useEffect(() => {
    if (!selectedSessionSummary) {
      return;
    }

    setSessionNotificationAcks((current) =>
      acknowledgeSessionNotification(selectedSessionSummary, current)
    );
  }, [
    selectedSessionSummary?.agentId,
    selectedSessionSummary?.completionStatus,
    selectedSessionSummary?.lastTurnAt,
    selectedSessionSummary?.sessionId,
    selectedSessionSummary?.startedAt,
  ]);

  useEffect(() => {
    const triggerImmediateSessionRefresh = () => {
      sessionRefreshFailureCountRef.current = 0;
      triggerSessionRefreshRef.current?.();
    };
    const handleVisibilityChange = () => {
      pageVisibleRef.current = document.visibilityState !== "hidden";
      setBrowserNotificationPermission(getBrowserNotificationPermission());
      if (pageVisibleRef.current) {
        triggerImmediateSessionRefresh();
      }
    };
    const handleFocus = () => {
      windowFocusedRef.current = document.hasFocus();
      setBrowserNotificationPermission(getBrowserNotificationPermission());
      triggerImmediateSessionRefresh();
    };
    const handleBlur = () => {
      windowFocusedRef.current = false;
    };
    const handleOnline = () => {
      setOffline(false);
      triggerImmediateSessionRefresh();
    };
    const handlePageShow = () => {
      triggerImmediateSessionRefresh();
    };

    handleVisibilityChange();
    windowFocusedRef.current = document.hasFocus();
    setBrowserNotificationPermission(getBrowserNotificationPermission());
    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("focus", handleFocus);
    window.addEventListener("blur", handleBlur);
    window.addEventListener("online", handleOnline);
    window.addEventListener("pageshow", handlePageShow);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("focus", handleFocus);
      window.removeEventListener("blur", handleBlur);
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("pageshow", handlePageShow);
    };
  }, []);

  useEffect(() => {
    const evaluation = evaluateCompletionNotifications({
      sessionsByAgent,
      observedCompletions: completionObservationRef.current,
      deliveredCompletions: completionNotificationDeliveries,
      preferences: uiPreferences.completionNotifications,
      selectedAgentId,
      selectedSessionId,
      pageVisible: pageVisibleRef.current,
      windowFocused: windowFocusedRef.current,
    });
    completionObservationRef.current = evaluation.nextObservedCompletions;
    if (evaluation.notifications.length === 0) {
      return;
    }

    let cancelled = false;
    void (async () => {
      const deliveredKeys = new Set<string>();
      for (const notification of evaluation.notifications) {
        try {
          const delivered = await deliverCompletionNotification(notification);
          if (delivered) {
            deliveredKeys.add(notification.key);
          }
        } catch (deliveryError) {
          if (!cancelled) {
            setError(getErrorMessage(deliveryError));
          }
        }
      }

      if (cancelled || deliveredKeys.size === 0) {
        return;
      }

      setCompletionNotificationDeliveries((current) => {
        let changed = false;
        const next = { ...current };
        for (const notification of evaluation.notifications) {
          if (!deliveredKeys.has(notification.key)) {
            continue;
          }
          if (next[notification.key] === notification.completedAt) {
            continue;
          }
          next[notification.key] = notification.completedAt;
          changed = true;
        }
        return changed ? next : current;
      });
    })();

    return () => {
      cancelled = true;
    };
  }, [
    completionNotificationDeliveries,
    selectedAgentId,
    selectedSessionId,
    sessionsByAgent,
    uiPreferences.completionNotifications,
  ]);

  useEffect(() => {
    if (!selectedAgentId) {
      setSkills([]);
      return;
    }

    if (!agents.some((agent) => agent.id === selectedAgentId)) {
      return;
    }

    void refreshAgent(selectedAgentId);
  }, [agents, selectedAgentId]);

  useEffect(() => {
    if (agents.length === 0) {
      triggerSessionRefreshRef.current = undefined;
      return;
    }

    let cancelled = false;
    const clearScheduledRefresh = () => {
      if (sessionRefreshTimeoutRef.current !== undefined) {
        window.clearTimeout(sessionRefreshTimeoutRef.current);
        sessionRefreshTimeoutRef.current = undefined;
      }
    };
    const scheduleNextRefresh = (attempt: number) => {
      clearScheduledRefresh();
      if (cancelled) {
        return;
      }
      const delayMs = getAdaptivePollDelayMs({
        ...readReconnectCostHints(),
        attempt,
        pageVisible: pageVisibleRef.current,
      });
      sessionRefreshTimeoutRef.current = window.setTimeout(() => {
        sessionRefreshTimeoutRef.current = undefined;
        void refreshSessionsInBackground();
      }, delayMs);
    };
    const refreshSessionsInBackground = async () => {
      if (cancelled) {
        return;
      }
      if (sessionRefreshInFlightRef.current) {
        queuedImmediateSessionRefreshRef.current = true;
        return;
      }

      sessionRefreshInFlightRef.current = true;
      try {
        const results = await Promise.allSettled(
          agents.map(
            async (agent) =>
              [agent.id, await api.listSessions(agent.id)] as const
          )
        );
        if (cancelled) {
          return;
        }

        const succeeded = results.filter(
          (
            result
          ): result is PromiseFulfilledResult<
            readonly [string, ChatSessionSummary[]]
          > => result.status === "fulfilled"
        );
        const failed = results.filter(
          (result): result is PromiseRejectedResult =>
            result.status === "rejected"
        );
        const staleThreadKeys = new Set<string>();

        if (succeeded.length > 0) {
          setSessionsByAgent((current) => {
            const next = { ...current };
            for (const [agentId, agentSessions] of succeeded.map(
              (result) => result.value
            )) {
              const previousSessions = current[agentId] ?? [];
              const previousSessionsById = new Map(
                previousSessions.map((session) => [session.sessionId, session])
              );
              for (const session of agentSessions) {
                const previousSession = previousSessionsById.get(
                  session.sessionId
                );
                if (
                  previousSession &&
                  didSessionSummaryChange(previousSession, session) &&
                  threadsByKeyRef.current[
                    getThreadKey(session.agentId, session.sessionId)
                  ]
                ) {
                  staleThreadKeys.add(
                    getThreadKey(session.agentId, session.sessionId)
                  );
                }
              }
              next[agentId] = agentSessions;
            }
            return next;
          });
        }

        if (staleThreadKeys.size > 0) {
          setStaleThreadKeys((current) => {
            const next = { ...current };
            for (const threadKey of staleThreadKeys) {
              next[threadKey] = true;
            }
            return next;
          });
        }

        if (failed.length === 0) {
          sessionRefreshFailureCountRef.current = 0;
          setOffline(false);
          setError(undefined);
        } else if (succeeded.length === 0) {
          sessionRefreshFailureCountRef.current += 1;
          setOffline(true);
          setError(getErrorMessage(failed[0]?.reason));
        } else {
          sessionRefreshFailureCountRef.current = 0;
          setOffline(false);
        }
      } finally {
        sessionRefreshInFlightRef.current = false;
        if (!cancelled && queuedImmediateSessionRefreshRef.current) {
          queuedImmediateSessionRefreshRef.current = false;
          void refreshSessionsInBackground();
        } else if (!cancelled) {
          scheduleNextRefresh(sessionRefreshFailureCountRef.current);
        }
      }
    };

    triggerSessionRefreshRef.current = () => {
      clearScheduledRefresh();
      if (sessionRefreshInFlightRef.current) {
        queuedImmediateSessionRefreshRef.current = true;
        return;
      }
      void refreshSessionsInBackground();
    };

    if (Object.keys(sessionsByAgent).length === 0) {
      void refreshSessionsInBackground();
    } else {
      scheduleNextRefresh(sessionRefreshFailureCountRef.current);
    }

    return () => {
      cancelled = true;
      triggerSessionRefreshRef.current = undefined;
      clearScheduledRefresh();
    };
  }, [agents]);

  useEffect(() => {
    if (!selectedAgentId || !selectedSessionId) {
      return;
    }

    if (!(selectedAgentId in sessionsByAgent)) {
      return;
    }

    const selectedSessionStillExists = (
      sessionsByAgent[selectedAgentId] ?? []
    ).some((session) => session.sessionId === selectedSessionId);
    if (!selectedSessionStillExists) {
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

    if (isScheduleAgent) {
      const cachedTask = scheduleTasksById[selectedSessionId];
      if (cachedTask) {
        return;
      }

      void openScheduledTask(selectedSessionId);
      return;
    }

    const nextThreadKey = `${selectedAgentId}:${selectedSessionId}`;
    const cachedThread = threadsByKey[nextThreadKey];
    if (cachedThread) {
      const runtimeConfig = normalizeConfigForModel(
        cachedThread.runtimeConfig ?? buildDefaultConfig(selectedAgent),
        models
      );
      setConfig(runtimeConfig);
      setMcpText(JSON.stringify(runtimeConfig.mcpServers, null, 2));
      if (
        staleThreadKeys[nextThreadKey] &&
        !(sessionLoadPending && sessionLoadTarget === nextThreadKey)
      ) {
        void openSession(selectedAgentId, selectedSessionId);
      }
      return;
    }

    if (deferInitialSessionLoad) {
      return;
    }

    if (sessionLoadPending && sessionLoadTarget === nextThreadKey) {
      return;
    }

    void openSession(selectedAgentId, selectedSessionId);
  }, [
    deferInitialSessionLoad,
    selectedAgentId,
    selectedSessionId,
    isOrchestratorAgent,
    isScheduleAgent,
    sessionsByAgent,
    threadsByKey,
    orchestratorSessionsById,
    scheduleTasksById,
    models,
    staleThreadKeys,
    sessionLoadPending,
    sessionLoadTarget,
  ]);

  useEffect(() => {
    if (!isOrchestratorAgent || !selectedSessionId) {
      return;
    }
    void refreshOrchestratorSchedules(selectedSessionId);
  }, [isOrchestratorAgent, selectedSessionId]);

  useEffect(() => {
    if (!isScheduleAgent || !selectedScheduleTask) {
      return;
    }
    if (
      selectedScheduleTask.targetKind !== "chat" ||
      selectedScheduleTask.totalRuns === 0 ||
      !selectedScheduleTask.agentId ||
      !selectedScheduleTask.chatSessionId
    ) {
      return;
    }
    const nextThreadKey = `${selectedScheduleTask.agentId}:${selectedScheduleTask.chatSessionId}`;
    if (threadsByKey[nextThreadKey]) {
      return;
    }
    void openSession(
      selectedScheduleTask.agentId,
      selectedScheduleTask.chatSessionId
    );
  }, [isScheduleAgent, selectedScheduleTask, threadsByKey]);

  useEffect(() => {
    if (
      !isScheduleAgent ||
      !selectedScheduleTask ||
      selectedScheduleTask.targetKind !== "orchestrator" ||
      !selectedScheduleTask.orchestratorSessionId
    ) {
      return;
    }
    if (orchestratorSessionsById[selectedScheduleTask.orchestratorSessionId]) {
      return;
    }
    void openOrchestratorSession(selectedScheduleTask.orchestratorSessionId);
  }, [isScheduleAgent, orchestratorSessionsById, selectedScheduleTask]);

  useEffect(() => {
    if (models.length === 0) {
      return;
    }

    setConfig((current) => normalizeConfigForModel(current, models));
  }, [models]);

  useEffect(() => {
    if (models.length === 0) {
      return;
    }
    const preferredModel =
      selectedDefaultChatModel ??
      findModelDescriptor(models, config.model, config.provider) ??
      models[0];
    if (
      !preferredModel ||
      (preferredModel.id === uiPreferences.defaultChatModelId &&
        preferredModel.runtimeProvider === uiPreferences.defaultChatProvider)
    ) {
      return;
    }
    setUiPreferences((current) => ({
      ...current,
      defaultChatProvider: preferredModel.runtimeProvider,
      defaultChatModelId: preferredModel.id,
    }));
  }, [
    config.model,
    config.provider,
    models,
    selectedDefaultChatModel,
    uiPreferences.defaultChatModelId,
    uiPreferences.defaultChatProvider,
  ]);

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
          return;
        }

        if (dangerAction) {
          event.preventDefault();
          if (!deletePending) {
            setDangerAction(undefined);
          }
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
  }, [commandPaletteOpen, dangerAction, deletePending, settingsOpen, models]);

  async function bootstrap() {
    try {
      const [workspaceResponse, agentsResponse, modelCatalog, capabilities] =
        await Promise.all([
          api.getWorkspace(),
          api.listAgents(),
          api.listModels(),
          api.getOrchestratorCapabilities(),
        ]);
      const orchestratorSessions = await api.listOrchestratorSessions();
      setWorkspace(workspaceResponse);
      setAgents(agentsResponse);
      setProviders(modelCatalog.providers);
      setDefaultProvider(modelCatalog.defaultProvider);
      setModels(modelCatalog.models);
      setOrchestratorCapabilities(capabilities);
      setOrchestratorSessionsById(
        Object.fromEntries(
          orchestratorSessions.map((session) => [session.sessionId, session])
        )
      );
      setConfig((current) =>
        normalizeConfigForModel(
          {
            ...current,
            provider: current.provider || modelCatalog.defaultProvider,
          },
          modelCatalog.models
        )
      );
      setOffline(false);
      const selectedAgentStillExists = selectedAgentId
        ? agentsResponse.some((agent) => agent.id === selectedAgentId)
        : false;
      if (!selectedAgentStillExists) {
        setSelectedAgentId(agentsResponse[0]?.id);
        setSelectedSessionId(undefined);
        setPreferNewSession(false);
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
        selectedAgentSummary?.kind !== "chat" ||
        agentId === ORCHESTRATOR_AGENT_ID ||
        agentId === SCHEDULE_AGENT_ID
          ? []
          : await api.listSkills(agentId);
      setSessionsByAgent((current) => ({
        ...current,
        [agentId]: nextSessions,
      }));
      setSkills(nextSkills);
      if (selectedAgentId === agentId) {
        const nextSelectedSession = selectedSessionId
          ? nextSessions.find(
              (session) => session.sessionId === selectedSessionId
            )
          : undefined;

        if (selectedSessionId && !nextSelectedSession) {
          const fallbackSession = preferNewSession
            ? undefined
            : nextSessions[0];
          setSelectedSessionId(fallbackSession?.sessionId);
          setPreferNewSession(!fallbackSession);
          if (!fallbackSession) {
            const defaultConfig = normalizeConfigForModel(
              buildDefaultConfig(selectedAgent),
              models
            );
            setConfig(defaultConfig);
            setMcpText(JSON.stringify(defaultConfig.mcpServers, null, 2));
            setMcpError(undefined);
          }
        } else if (!selectedSessionId && !preferNewSession && nextSessions[0]) {
          setSelectedSessionId(nextSessions[0].sessionId);
        }
      }
      setOffline(false);
    } catch (loadError) {
      setOffline(true);
      setError(getErrorMessage(loadError));
    }
  }

  async function openSession(agentId: string, sessionId: string) {
    setDeferInitialSessionLoad(false);
    setSessionLoadPending(true);
    setSessionLoadTarget(`${agentId}:${sessionId}`);
    try {
      const thread = await api.getSession(agentId, sessionId);
      const nextThreadKey = `${agentId}:${sessionId}`;
      setThreadsByKey((current) => ({ ...current, [nextThreadKey]: thread }));
      setStaleThreadKeys((current) => {
        if (!(nextThreadKey in current)) {
          return current;
        }
        const next = { ...current };
        delete next[nextThreadKey];
        return next;
      });
      const runtimeConfig = normalizeConfigForModel(
        thread.runtimeConfig ??
          buildDefaultConfig(
            agents.find((candidate) => candidate.id === agentId)
          ),
        models
      );
      setConfig(runtimeConfig);
      setMcpText(JSON.stringify(runtimeConfig.mcpServers, null, 2));
      setOffline(false);
      setError(undefined);
    } catch (loadError) {
      setOffline(false);
      setError(getErrorMessage(loadError));
    } finally {
      setSessionLoadPending(false);
      setSessionLoadTarget((current) =>
        current === `${agentId}:${sessionId}` ? undefined : current
      );
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

  async function openScheduledTask(scheduleId: string) {
    try {
      const task = await api.getScheduledTask(scheduleId);
      setScheduleTasksById((current) => ({
        ...current,
        [scheduleId]: task,
      }));
      if (
        task.targetKind === "orchestrator" &&
        task.orchestratorSessionId &&
        !orchestratorSessionsById[task.orchestratorSessionId]
      ) {
        void openOrchestratorSession(task.orchestratorSessionId);
      }
      setOffline(false);
    } catch (loadError) {
      setOffline(true);
      setError(getErrorMessage(loadError));
    }
  }

  async function refreshOrchestratorSchedules(sessionId: string) {
    try {
      const schedules = await api.listOrchestratorSchedules(sessionId);
      setOrchestratorSchedulesBySessionId((current) => ({
        ...current,
        [sessionId]: schedules,
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
    setMobileSidebarOpen(false);
    setPreferNewSession(false);
    setDeferInitialSessionLoad(false);
    setSessionLoadPending(false);
    setSessionLoadTarget(undefined);
    const defaultConfig = normalizeConfigForModel(
      buildDefaultConfig(agents.find((agent) => agent.id === agentId)),
      models
    );
    setConfig(defaultConfig);
    setMcpText(JSON.stringify(defaultConfig.mcpServers, null, 2));
    setMcpError(undefined);
    setError(undefined);
    setPendingAssistantSnapshot(createEmptyPendingAssistantSnapshot());
    setMemoryAnalysis(undefined);
    setMemoryAnalysisOpen(false);
  }

  function handleSelectSession(agentId: string, sessionId: string) {
    setSelectedAgentId(agentId);
    setSelectedSessionId(sessionId);
    setMobileSidebarOpen(false);
    setPreferNewSession(false);
    setDeferInitialSessionLoad(false);
    setError(undefined);
    setPendingAssistantSnapshot(createEmptyPendingAssistantSnapshot());
    setMemoryAnalysis(undefined);
    setMemoryAnalysisOpen(false);
    if (
      agentId !== ORCHESTRATOR_AGENT_ID &&
      agentId !== SCHEDULE_AGENT_ID &&
      !threadsByKey[`${agentId}:${sessionId}`]
    ) {
      void openSession(agentId, sessionId);
    }
  }

  function handleNewSession() {
    setSelectedSessionId(undefined);
    setMobileSidebarOpen(false);
    setPreferNewSession(true);
    setDeferInitialSessionLoad(false);
    const defaultConfig = normalizeConfigForModel(
      buildDefaultConfig(selectedAgent),
      models
    );
    setConfig(defaultConfig);
    setMcpText(JSON.stringify(defaultConfig.mcpServers, null, 2));
    setMcpError(undefined);
    setError(undefined);
    setPendingAssistantSnapshot(createEmptyPendingAssistantSnapshot());
    setSessionLoadPending(false);
    setSessionLoadTarget(undefined);
    setMemoryAnalysis(undefined);
    setMemoryAnalysisOpen(false);
    if (!isOrchestratorAgent && !isScheduleAgent) {
      focusComposer();
    }
  }

  function handleToggleSidebar() {
    if (mobileViewport) {
      setMobileSidebarOpen((current) => !current);
      return;
    }
    setUiPreferences((current) => ({
      ...current,
      sidebarCollapsed: !current.sidebarCollapsed,
    }));
  }

  async function handleRequestBrowserNotifications() {
    const permission = await requestBrowserNotificationPermission();
    setBrowserNotificationPermission(permission);
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
    if (
      !selectedAgentId ||
      (!draft.trim() && !chatAttachment) ||
      busy ||
      mcpError
    ) {
      return;
    }

    const request: ChatRequest = {
      title: selectedSessionId
        ? undefined
        : buildTitleFromPrompt(draft || chatAttachment?.name || ""),
      prompt: draft,
      config,
      attachment: chatAttachment
        ? await toAttachmentUpload(chatAttachment)
        : undefined,
    };

    setBusy(true);
    setError(undefined);
    setPendingAssistantSnapshot(createEmptyPendingAssistantSnapshot());

    try {
      const response = await api.sendMessageStream(
        selectedAgentId,
        selectedSessionId,
        request,
        (event) => {
          if (event.type === "thread") {
            storeThread(event.thread);
            setSelectedSessionId(event.thread.sessionId);
            setPreferNewSession(false);
            return;
          }
          if (event.type === "assistant_snapshot") {
            setPendingAssistantSnapshot({
              assistantText: event.assistantText ?? "",
              thinkingText: event.thinkingText ?? "",
            });
          }
        }
      );
      storeThread(response.thread);
      setSelectedSessionId(response.thread.sessionId);
      setPreferNewSession(false);
      setDraft("");
      setChatAttachment(undefined);
      setPendingAssistantSnapshot(createEmptyPendingAssistantSnapshot());
      setOffline(false);
    } catch (sendError) {
      setError(getErrorMessage(sendError));
      setPendingAssistantSnapshot(createEmptyPendingAssistantSnapshot());
      if (isOfflineError(sendError)) {
        setOffline(true);
        if (request.attachment) {
          setError(
            "Attachment retries are not queued offline yet. Please resend when the runtime is reachable."
          );
        } else {
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
      setPreferNewSession(false);
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
      setPreferNewSession(false);
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

  async function handleDelegateOrchestratorPrompt(request: {
    prompt: string;
    attachment?: File;
  }) {
    if (!selectedSessionId) {
      return;
    }

    setBusy(true);
    setError(undefined);
    try {
      const session = await api.delegateOrchestratorJob(selectedSessionId, {
        prompt: request.prompt,
        attachment: request.attachment
          ? await toAttachmentUpload(request.attachment)
          : undefined,
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

  async function handleRetryOrchestratorJob(jobId: string) {
    if (!selectedSessionId) {
      return;
    }

    setBusy(true);
    setError(undefined);
    try {
      const session = await api.retryOrchestratorJob(selectedSessionId, jobId);
      storeOrchestratorSession(session);
      setOffline(false);
    } catch (retryError) {
      setError(getErrorMessage(retryError));
    } finally {
      setBusy(false);
    }
  }

  async function handleCreateOrchestratorSchedule(
    request: OrchestratorScheduleCreateRequest
  ) {
    setBusy(true);
    setError(undefined);
    try {
      const schedule = await api.createOrchestratorSchedule(request);
      setOrchestratorSchedulesBySessionId((current) => ({
        ...current,
        [schedule.sessionId]: [
          schedule,
          ...(current[schedule.sessionId] ?? []).filter(
            (item) => item.scheduleId !== schedule.scheduleId
          ),
        ].sort((left, right) => left.nextRunAt.localeCompare(right.nextRunAt)),
      }));
      setOffline(false);
    } catch (scheduleError) {
      setError(getErrorMessage(scheduleError));
    } finally {
      setBusy(false);
    }
  }

  async function handleUpdateOrchestratorSchedule(
    scheduleId: string,
    request: OrchestratorScheduleUpdateRequest
  ) {
    setBusy(true);
    setError(undefined);
    try {
      const schedule = await api.updateOrchestratorSchedule(
        scheduleId,
        request
      );
      setOrchestratorSchedulesBySessionId((current) => ({
        ...current,
        [schedule.sessionId]: [
          ...(current[schedule.sessionId] ?? []).filter(
            (item) => item.scheduleId !== schedule.scheduleId
          ),
          schedule,
        ].sort((left, right) => left.nextRunAt.localeCompare(right.nextRunAt)),
      }));
      setOffline(false);
    } catch (scheduleError) {
      setError(getErrorMessage(scheduleError));
    } finally {
      setBusy(false);
    }
  }

  async function handleDeleteOrchestratorSchedule(
    scheduleId: string,
    sessionId: string
  ) {
    setBusy(true);
    setError(undefined);
    try {
      await api.deleteOrchestratorSchedule(scheduleId);
      setOrchestratorSchedulesBySessionId((current) => ({
        ...current,
        [sessionId]: (current[sessionId] ?? []).filter(
          (item) => item.scheduleId !== scheduleId
        ),
      }));
      setOffline(false);
    } catch (scheduleError) {
      setError(getErrorMessage(scheduleError));
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

  async function handleCreateScheduledTask(request: ScheduleTaskCreateRequest) {
    setBusy(true);
    setError(undefined);
    try {
      const task = await api.createScheduledTask(request);
      storeScheduledTask(task);
      setSelectedSessionId(task.scheduleId);
      setPreferNewSession(false);
      setOffline(false);
    } catch (taskError) {
      setError(getErrorMessage(taskError));
    } finally {
      setBusy(false);
    }
  }

  async function handleUpdateScheduledTask(
    scheduleId: string,
    request: ScheduleTaskUpdateRequest
  ) {
    setBusy(true);
    setError(undefined);
    try {
      const task = await api.updateScheduledTask(scheduleId, request);
      storeScheduledTask(task);
      setOffline(false);
    } catch (taskError) {
      setError(getErrorMessage(taskError));
    } finally {
      setBusy(false);
    }
  }

  async function handleRunScheduledTask(scheduleId: string) {
    setBusy(true);
    setError(undefined);
    try {
      const task = await api.runScheduledTaskNow(scheduleId);
      storeScheduledTask(task);
      setOffline(false);
    } catch (taskError) {
      setError(getErrorMessage(taskError));
    } finally {
      setBusy(false);
    }
  }

  async function handleAnalyzeMemory() {
    if (!selectedAgentId || !selectedSessionId) {
      return;
    }

    setMemoryAnalysis(undefined);
    setMemoryAnalysisOpen(true);
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
      setMemoryAnalysisOpen(false);
      setError(getErrorMessage(analysisError));
    } finally {
      setAnalyzingMemory(false);
    }
  }

  function promptDeleteSelectedSession() {
    if (!selectedAgentId || !selectedSessionId) {
      return;
    }

    if (isOrchestratorAgent) {
      if (!selectedOrchestratorSession) {
        return;
      }
      setDangerAction({
        kind: "orchestrator-session",
        sessionId: selectedOrchestratorSession.sessionId,
        title: selectedOrchestratorSession.title,
        queuedJobCount: selectedOrchestratorQueuedJobCount,
        delegatedJobCount: selectedOrchestratorSession.jobs.length,
        status: selectedOrchestratorSession.status,
      });
      return;
    }

    if (isScheduleAgent) {
      if (!selectedScheduleTask) {
        return;
      }
      setDangerAction({
        kind: "schedule-task",
        scheduleId: selectedScheduleTask.scheduleId,
        title: selectedScheduleTask.title,
        agentId:
          selectedScheduleTask.targetKind === "orchestrator"
            ? (selectedScheduledOrchestratorSession?.title ??
              selectedScheduleTask.orchestratorSessionId ??
              "Orchestrator session")
            : (selectedScheduleTask.agentId ?? "Chat agent"),
        lastRunStatus: selectedScheduleTask.lastRunStatus,
      });
      return;
    }

    const selectedSummary = sessions.find(
      (session) => session.sessionId === selectedSessionId
    );
    if (!selectedThread && !selectedSummary) {
      return;
    }

    setDangerAction({
      kind: "chat-session",
      agentId: selectedAgentId,
      sessionId: selectedSessionId,
      title: selectedThread?.title ?? selectedSummary?.title ?? "Chat session",
      turnCount:
        selectedThread?.turns.length ?? selectedSummary?.turnCount ?? 0,
      lastActivity:
        selectedThread?.turns.at(-1)?.createdAt ??
        selectedSummary?.lastTurnAt ??
        selectedThread?.startedAt ??
        selectedSummary?.startedAt,
    });
  }

  function promptRestartSelectedOrchestratorSession() {
    if (!selectedOrchestratorSession) {
      return;
    }

    const runningJob = selectedOrchestratorSession.jobs.find(
      (job) => job.status === "running"
    );
    setDangerAction({
      kind: "orchestrator-session-restart",
      sessionId: selectedOrchestratorSession.sessionId,
      title: selectedOrchestratorSession.title,
      queuedJobCount: selectedOrchestratorQueuedJobCount,
      delegatedJobCount: selectedOrchestratorSession.jobs.length,
      status: selectedOrchestratorSession.status,
      runningJobPromptPreview: runningJob?.promptPreview,
    });
  }

  function promptDeleteOlderOrchestratorDuplicates(sessionIds: string[]) {
    if (!selectedOrchestratorSession || sessionIds.length === 0) {
      return;
    }

    setDangerAction({
      kind: "orchestrator-duplicates",
      title: selectedOrchestratorSession.title,
      keptSessionId: selectedOrchestratorSession.sessionId,
      duplicateSessionIds: sessionIds,
    });
  }

  function promptDeleteQueuedJob(jobId: string) {
    if (!selectedOrchestratorSession) {
      return;
    }

    const job = selectedOrchestratorSession.jobs.find(
      (item) => item.jobId === jobId
    );
    if (!job || job.status !== "queued") {
      return;
    }

    setDangerAction({
      kind: "orchestrator-job",
      sessionId: selectedOrchestratorSession.sessionId,
      jobId,
      promptPreview: job.promptPreview,
      submittedAt: job.submittedAt,
    });
  }

  async function handleConfirmDangerAction() {
    if (!dangerAction) {
      return;
    }

    setDeletePending(true);
    setError(undefined);
    try {
      switch (dangerAction.kind) {
        case "chat-session":
          await api.deleteSession(dangerAction.agentId, dangerAction.sessionId);
          removeChatSessionLocally(
            dangerAction.agentId,
            dangerAction.sessionId
          );
          break;
        case "orchestrator-session":
          await api.deleteSession(
            ORCHESTRATOR_AGENT_ID,
            dangerAction.sessionId
          );
          removeOrchestratorSessionLocally(dangerAction.sessionId);
          break;
        case "orchestrator-duplicates":
          for (const sessionId of dangerAction.duplicateSessionIds) {
            await api.deleteSession(ORCHESTRATOR_AGENT_ID, sessionId);
            removeOrchestratorSessionLocally(sessionId);
          }
          break;
        case "orchestrator-session-restart": {
          const session = await api.restartOrchestratorSession(
            dangerAction.sessionId
          );
          storeOrchestratorSession(session);
          break;
        }
        case "orchestrator-job": {
          const session = await api.deleteOrchestratorJob(
            dangerAction.sessionId,
            dangerAction.jobId
          );
          storeOrchestratorSession(session);
          break;
        }
        case "schedule-task":
          await api.deleteScheduledTask(dangerAction.scheduleId);
          removeScheduledTaskLocally(dangerAction.scheduleId);
          break;
      }
      setDangerAction(undefined);
      setOffline(false);
    } catch (deleteError) {
      setError(getErrorMessage(deleteError));
    } finally {
      setDeletePending(false);
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
    setStaleThreadKeys((current) => {
      if (!(nextThreadKey in current)) {
        return current;
      }
      const next = { ...current };
      delete next[nextThreadKey];
      return next;
    });
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

  function storeScheduledTask(task: ScheduleTask) {
    setScheduleTasksById((current) => ({
      ...current,
      [task.scheduleId]: task,
    }));
    setSessionsByAgent((current) => {
      const existing = current[SCHEDULE_AGENT_ID] ?? [];
      const withoutCurrent = existing.filter(
        (item) => item.sessionId !== task.scheduleId
      );
      return {
        ...current,
        [SCHEDULE_AGENT_ID]: [
          buildScheduledTaskSummary(
            task,
            task.targetKind === "orchestrator"
              ? (sessionsByAgent[ORCHESTRATOR_AGENT_ID] ?? []).find(
                  (session) => session.sessionId === task.orchestratorSessionId
                )?.title
              : agents.find((agent) => agent.id === task.agentId)?.title
          ),
          ...withoutCurrent,
        ],
      };
    });
  }

  function removeChatSessionLocally(agentId: string, sessionId: string) {
    clearDraft(`${agentId}:${sessionId}`);
    setSessionNotificationAcks((current) =>
      clearSessionNotificationAck(current, agentId, sessionId)
    );
    setCompletionNotificationDeliveries((current) =>
      clearSessionNotificationAck(current, agentId, sessionId)
    );
    setThreadsByKey((current) => {
      const next = { ...current };
      delete next[`${agentId}:${sessionId}`];
      return next;
    });
    setStaleThreadKeys((current) => {
      const next = { ...current };
      delete next[`${agentId}:${sessionId}`];
      return next;
    });
    setQueue((current) =>
      current.filter(
        (item) => !(item.agentId === agentId && item.sessionId === sessionId)
      )
    );

    const remainingSessions = (sessionsByAgent[agentId] ?? []).filter(
      (session) => session.sessionId !== sessionId
    );
    setSessionsByAgent((current) => ({
      ...current,
      [agentId]: remainingSessions,
    }));

    if (selectedAgentId === agentId && selectedSessionId === sessionId) {
      const fallbackSession = remainingSessions[0];
      setSelectedSessionId(fallbackSession?.sessionId);
      setPreferNewSession(!fallbackSession);
      setMemoryAnalysis(undefined);
      setMemoryAnalysisOpen(false);
      if (!fallbackSession) {
        const defaultConfig = normalizeConfigForModel(
          buildDefaultConfig(
            agents.find((candidate) => candidate.id === agentId)
          ),
          models
        );
        setConfig(defaultConfig);
        setMcpText(JSON.stringify(defaultConfig.mcpServers, null, 2));
        setMcpError(undefined);
        focusComposer();
      }
    }
  }

  function removeOrchestratorSessionLocally(sessionId: string) {
    setSessionNotificationAcks((current) =>
      clearSessionNotificationAck(current, ORCHESTRATOR_AGENT_ID, sessionId)
    );
    setCompletionNotificationDeliveries((current) =>
      clearSessionNotificationAck(current, ORCHESTRATOR_AGENT_ID, sessionId)
    );
    setOrchestratorSchedulesBySessionId((current) => {
      const next = { ...current };
      delete next[sessionId];
      return next;
    });
    setOrchestratorSessionsById((current) => {
      const next = { ...current };
      delete next[sessionId];
      return next;
    });

    const remainingSessions = (
      sessionsByAgent[ORCHESTRATOR_AGENT_ID] ?? []
    ).filter((session) => session.sessionId !== sessionId);
    setSessionsByAgent((current) => ({
      ...current,
      [ORCHESTRATOR_AGENT_ID]: remainingSessions,
    }));

    if (selectedSessionId === sessionId) {
      const fallbackSession = remainingSessions[0];
      setSelectedSessionId(fallbackSession?.sessionId);
      setPreferNewSession(!fallbackSession);
    }
  }

  function removeScheduledTaskLocally(scheduleId: string) {
    setSessionNotificationAcks((current) =>
      clearSessionNotificationAck(current, SCHEDULE_AGENT_ID, scheduleId)
    );
    setCompletionNotificationDeliveries((current) =>
      clearSessionNotificationAck(current, SCHEDULE_AGENT_ID, scheduleId)
    );
    setScheduleTasksById((current) => {
      const next = { ...current };
      delete next[scheduleId];
      return next;
    });

    const remainingSessions = (sessionsByAgent[SCHEDULE_AGENT_ID] ?? []).filter(
      (session) => session.sessionId !== scheduleId
    );
    setSessionsByAgent((current) => ({
      ...current,
      [SCHEDULE_AGENT_ID]: remainingSessions,
    }));

    if (selectedSessionId === scheduleId) {
      const fallbackSession = remainingSessions[0];
      setSelectedSessionId(fallbackSession?.sessionId);
      setPreferNewSession(!fallbackSession);
    }
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
        notificationAgentIds={notificationAgentIds}
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
        {mobileViewport && sidebarVisible ? (
          <button
            type="button"
            className="mobile-sidebar-backdrop"
            aria-label="Hide sidebar"
            onClick={() => setMobileSidebarOpen(false)}
          />
        ) : null}
        {sidebarVisible ? (
          <>
            <div
              className="session-sidebar-shell"
              style={
                {
                  "--sidebar-width": `${uiPreferences.sidebarWidth}px`,
                } as CSSProperties
              }
            >
              <SessionSidebar
                agent={selectedAgent}
                sessions={sessions}
                notificationSessionIds={notificationSessionIds}
                selectedSessionId={selectedSessionId}
                sessionLabel={
                  isOrchestratorAgent
                    ? "session"
                    : isScheduleAgent
                      ? "schedule"
                      : "chat"
                }
                newSessionLabel={
                  isOrchestratorAgent
                    ? "New session"
                    : isScheduleAgent
                      ? "New schedule"
                      : "New chat"
                }
                emptyMessage={
                  isOrchestratorAgent
                    ? "No orchestrator sessions yet."
                    : isScheduleAgent
                      ? "No scheduled tasks yet."
                      : "No sessions yet for this agent."
                }
                onSelect={(sessionId) => {
                  if (!selectedAgentId) {
                    return;
                  }
                  handleSelectSession(selectedAgentId, sessionId);
                }}
                onNewSession={handleNewSession}
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
          <div
            className={
              isOrchestratorAgent || isScheduleAgent
                ? "chat-pane-inner chat-pane-inner-wide"
                : "chat-pane-inner"
            }
          >
            <header className="chat-pane-header">
              <div className="chat-pane-heading">
                <div className="eyebrow">
                  {isOrchestratorAgent
                    ? "Orchestrator"
                    : isScheduleAgent
                      ? "Schedules"
                      : "Conversation"}
                </div>
                <h2>
                  {isOrchestratorAgent
                    ? (selectedOrchestratorSession?.title ??
                      selectedAgent?.title ??
                      "min-kb-app")
                    : isScheduleAgent
                      ? (selectedScheduleTask?.title ??
                        selectedAgent?.title ??
                        "min-kb-app")
                      : (selectedThread?.title ??
                        selectedAgent?.title ??
                        "min-kb-app")}
                </h2>
                <p title={chatHeaderSummary}>{chatHeaderSummary}</p>
              </div>
              <div className="header-actions">
                <div className="header-button-row">
                  {!isOrchestratorAgent && !isScheduleAgent ? (
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
                          ? "Analyze this chat with GPT-5 mini and memory skills"
                          : "No memory-related skills detected for this agent"
                      }
                    >
                      {analyzingMemory ? "Analyzing..." : "Analyze memory"}
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="ghost-button danger-button"
                    onClick={promptDeleteSelectedSession}
                    disabled={!selectedSessionId || busy || deletePending}
                    title={
                      isOrchestratorAgent
                        ? "Delete the selected orchestrator session"
                        : isScheduleAgent
                          ? "Delete the selected scheduled task"
                          : "Delete the selected chat history"
                    }
                  >
                    {isOrchestratorAgent
                      ? "Delete session"
                      : isScheduleAgent
                        ? "Delete schedule"
                        : "Delete chat"}
                  </button>
                  <button
                    type="button"
                    className="ghost-button"
                    onClick={() => {
                      setSettingsOpen(false);
                      setCommandPaletteOpen(true);
                    }}
                  >
                    Open switcher
                  </button>
                  <button
                    type="button"
                    className="ghost-button sidebar-toggle-button"
                    aria-expanded={sidebarVisible}
                    onClick={handleToggleSidebar}
                  >
                    {sidebarVisible ? "Hide list" : "Show list"}
                    {!sidebarVisible && selectedAgentHasNotifications ? (
                      <span
                        className="sidebar-notification-dot"
                        role="img"
                        aria-label="Completed work waiting in chats"
                      />
                    ) : null}
                  </button>
                </div>
                <div className="shortcut-hint">
                  {isOrchestratorAgent
                    ? "Cmd/Ctrl+K switch • Alt+Shift+N new session"
                    : isScheduleAgent
                      ? "Cmd/Ctrl+K switch • Alt+Shift+N new schedule"
                      : "Cmd/Ctrl+K switch • Cmd/Ctrl+Enter send"}
                </div>
              </div>
            </header>

            {!isOrchestratorAgent && !isScheduleAgent ? (
              <RuntimeControls
                providers={providers}
                models={models}
                visibleModels={visibleModels}
                skills={skills}
                config={config}
                mcpText={mcpText}
                mcpError={mcpError}
                onProviderChange={(provider) =>
                  setConfig((current) =>
                    normalizeConfigForModel({ ...current, provider }, models)
                  )
                }
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
                onLmStudioEnableThinkingChange={(lmStudioEnableThinking) =>
                  setConfig((current) => ({
                    ...current,
                    lmStudioEnableThinking,
                  }))
                }
                onSkillToggle={handleToggleSkill}
                onMcpTextChange={handleMcpTextChange}
              />
            ) : null}

            {queue.length > 0 ? (
              <section className="queue-banner" aria-label="Queued messages">
                <strong>{queue.length} queued message(s)</strong>
                <div className="queue-list">
                  {queue.map((message) => (
                    <button
                      type="button"
                      key={message.id}
                      className="queued-item"
                      onClick={() => void handleRetryQueuedMessage(message)}
                    >
                      <span className="queued-item-title">
                        Retry {message.agentId}
                      </span>
                      <span className="queued-item-meta">
                        {new Date(message.createdAt).toLocaleTimeString()}
                      </span>
                    </button>
                  ))}
                </div>
              </section>
            ) : null}

            {isOrchestratorAgent ? (
              <OrchestratorPane
                capabilities={orchestratorCapabilities}
                session={selectedOrchestratorSession}
                schedules={selectedOrchestratorSchedules}
                models={visibleOrchestratorModels}
                defaultCliProvider={
                  orchestratorCapabilities?.defaultCliProvider ??
                  defaultProvider
                }
                defaultModelId={config.model}
                allSessions={Object.values(orchestratorSessionsById)}
                projectPathSuggestions={orchestratorProjectPathSuggestions}
                pending={busy}
                error={error}
                terminalOutputHeight={uiPreferences.orchestratorTerminalHeight}
                onTerminalOutputHeightChange={(height) =>
                  setUiPreferences((current) => ({
                    ...current,
                    orchestratorTerminalHeight:
                      clampOrchestratorTerminalHeight(height),
                  }))
                }
                onCreateSession={(request) =>
                  void handleCreateOrchestratorSession(request)
                }
                onUpdateSession={(request) =>
                  void handleUpdateOrchestratorSession(request)
                }
                onSelectSession={(sessionId) =>
                  handleSelectSession(ORCHESTRATOR_AGENT_ID, sessionId)
                }
                onDeleteOlderDuplicates={
                  promptDeleteOlderOrchestratorDuplicates
                }
                onDelegate={(request) =>
                  void handleDelegateOrchestratorPrompt(request)
                }
                onSendInput={(input, submit) =>
                  void handleSendOrchestratorInput(input, submit)
                }
                onCancelJob={() => void handleCancelOrchestratorJob()}
                onRestartSession={promptRestartSelectedOrchestratorSession}
                onRetryFailedJob={(jobId) =>
                  void handleRetryOrchestratorJob(jobId)
                }
                onDeleteQueuedJob={promptDeleteQueuedJob}
                onCreateSchedule={(request) =>
                  void handleCreateOrchestratorSchedule(request)
                }
                onUpdateSchedule={(scheduleId, request) =>
                  void handleUpdateOrchestratorSchedule(scheduleId, request)
                }
                onDeleteSchedule={(scheduleId, sessionId) =>
                  void handleDeleteOrchestratorSchedule(scheduleId, sessionId)
                }
                onSessionUpdate={(session) => storeOrchestratorSession(session)}
              />
            ) : isScheduleAgent ? (
              <SchedulePane
                task={selectedScheduleTask}
                thread={selectedScheduleThread}
                chatAgents={agents.filter((agent) => agent.kind === "chat")}
                orchestratorSessions={
                  sessionsByAgent[ORCHESTRATOR_AGENT_ID] ?? []
                }
                orchestratorSession={selectedScheduledOrchestratorSession}
                pending={busy}
                error={error}
                onCreateTask={(request) =>
                  void handleCreateScheduledTask(request)
                }
                onUpdateTask={(scheduleId, request) =>
                  void handleUpdateScheduledTask(scheduleId, request)
                }
                onDeleteTask={() => promptDeleteSelectedSession()}
                onRunNow={(scheduleId) =>
                  void handleRunScheduledTask(scheduleId)
                }
                onOpenTarget={(task) => {
                  if (
                    task.targetKind === "orchestrator" &&
                    task.orchestratorSessionId
                  ) {
                    handleSelectSession(
                      ORCHESTRATOR_AGENT_ID,
                      task.orchestratorSessionId
                    );
                    return;
                  }
                  if (task.agentId && task.chatSessionId) {
                    handleSelectSession(task.agentId, task.chatSessionId);
                  }
                }}
              />
            ) : (
              <>
                {selectedSessionId &&
                !preferNewSession &&
                !selectedThread &&
                selectedSessionSummary ? (
                  <section className="chat-empty-state">
                    <div className="chat-empty-card">
                      <h2>{selectedSessionSummary.title}</h2>
                      <p>
                        {sessionLoadPending &&
                        sessionLoadTarget ===
                          `${selectedSessionSummary.agentId}:${selectedSessionSummary.sessionId}`
                          ? "Loading this chat without blocking the rest of the app."
                          : "Open this chat on demand to avoid loading a large history during startup."}
                      </p>
                      <div className="panel-actions">
                        <button
                          type="button"
                          className="primary-button"
                          onClick={() =>
                            void openSession(
                              selectedSessionSummary.agentId,
                              selectedSessionSummary.sessionId
                            )
                          }
                          disabled={sessionLoadPending}
                        >
                          {sessionLoadPending &&
                          sessionLoadTarget ===
                            `${selectedSessionSummary.agentId}:${selectedSessionSummary.sessionId}`
                            ? "Loading..."
                            : "Open chat"}
                        </button>
                        <button
                          type="button"
                          className="ghost-button"
                          onClick={handleNewSession}
                        >
                          New chat
                        </button>
                      </div>
                      {error ? (
                        <div className="error-row" role="alert">
                          {error}
                        </div>
                      ) : null}
                    </div>
                  </section>
                ) : (
                  <ChatTimeline
                    thread={selectedThread}
                    pending={busy}
                    pendingAssistantText={
                      pendingAssistantSnapshot.assistantText
                    }
                    pendingThinkingText={pendingAssistantSnapshot.thinkingText}
                    error={error}
                  />
                )}

                <div className="composer-shell">
                  <SingleAttachmentPicker
                    file={chatAttachment}
                    pending={busy}
                    onChange={setChatAttachment}
                  />
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
                    rows={4}
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
                        (!draft.trim() && !chatAttachment) ||
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
          </div>
        </main>
      </div>

      <SettingsModal
        open={settingsOpen}
        theme={uiPreferences.theme}
        resolvedTheme={resolvedTheme}
        agents={agents}
        models={models}
        hiddenModelIds={uiPreferences.hiddenModelIds}
        selectedChatModelId={
          selectedDefaultChatModel?.id ?? uiPreferences.defaultChatModelId
        }
        selectedModelId={config.model}
        completionNotificationsEnabled={
          uiPreferences.completionNotifications.enabled
        }
        completionNotificationPermission={browserNotificationPermission}
        completionNotificationMinutes={
          uiPreferences.completionNotifications.minimumDurationMinutes
        }
        completionNotificationDisabledAgentIds={
          uiPreferences.completionNotifications.disabledAgentIds
        }
        onClose={() => setSettingsOpen(false)}
        onThemeChange={(theme) =>
          setUiPreferences((current) => ({
            ...current,
            theme,
          }))
        }
        onChatModelChange={(modelId) => {
          const model = models.find((candidate) => candidate.id === modelId);
          if (!model) {
            return;
          }
          setUiPreferences((current) => ({
            ...current,
            defaultChatProvider: model.runtimeProvider,
            defaultChatModelId: model.id,
          }));
        }}
        onToggleModelVisibility={handleToggleModelVisibility}
        onShowAllModels={() =>
          setUiPreferences((current) => ({
            ...current,
            hiddenModelIds: [],
          }))
        }
        onCompletionNotificationsEnabledChange={(enabled) => {
          setUiPreferences((current) => ({
            ...current,
            completionNotifications: {
              ...current.completionNotifications,
              enabled,
            },
          }));
          if (enabled && browserNotificationPermission === "default") {
            void handleRequestBrowserNotifications();
          }
        }}
        onCompletionNotificationMinutesChange={(minutes) =>
          setUiPreferences((current) => ({
            ...current,
            completionNotifications: {
              ...current.completionNotifications,
              minimumDurationMinutes: Number.isFinite(minutes)
                ? Math.max(1, Math.round(minutes))
                : current.completionNotifications.minimumDurationMinutes,
            },
          }))
        }
        onToggleCompletionNotificationAgent={(agentId) =>
          setUiPreferences((current) => {
            const disabled =
              current.completionNotifications.disabledAgentIds.includes(
                agentId
              );
            return {
              ...current,
              completionNotifications: {
                ...current.completionNotifications,
                disabledAgentIds: disabled
                  ? current.completionNotifications.disabledAgentIds.filter(
                      (item) => item !== agentId
                    )
                  : [
                      ...current.completionNotifications.disabledAgentIds,
                      agentId,
                    ],
              },
            };
          })
        }
        onEnableCompletionNotificationAgents={() =>
          setUiPreferences((current) => ({
            ...current,
            completionNotifications: {
              ...current.completionNotifications,
              disabledAgentIds: [],
            },
          }))
        }
        onRequestNotificationPermission={() => {
          void handleRequestBrowserNotifications();
        }}
      />

      <CommandPalette
        open={commandPaletteOpen}
        items={commandPaletteItems}
        onClose={() => setCommandPaletteOpen(false)}
        onSelect={handleCommandPaletteSelect}
      />

      <MemoryAnalysisModal
        open={memoryAnalysisOpen}
        loading={analyzingMemory}
        result={memoryAnalysis}
        onClose={() => {
          setMemoryAnalysis(undefined);
          setMemoryAnalysisOpen(false);
        }}
      />
      {dangerAction ? (
        <DangerConfirmModal
          open
          title={getDangerTitle(dangerAction)}
          description={getDangerDescription(dangerAction)}
          details={getDangerDetails(dangerAction)}
          warning={getDangerWarning(dangerAction)}
          acknowledgeLabel={getDangerAcknowledgeLabel(dangerAction)}
          confirmLabel={getDangerConfirmLabel(dangerAction)}
          busyLabel={getDangerBusyLabel(dangerAction)}
          busy={deletePending}
          onClose={() => setDangerAction(undefined)}
          onConfirm={() => void handleConfirmDangerAction()}
        />
      ) : null}
    </div>
  );
}

function formatHeaderSummaryValue(
  label: string,
  value?: string
): string | undefined {
  if (!value) {
    return undefined;
  }

  return `${label}: ${truncateMiddle(value, HEADER_VALUE_MAX_LENGTH)}`;
}

function truncateMiddle(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  const visibleLength = Math.max(4, maxLength - 1);
  const startLength = Math.ceil(visibleLength / 2);
  const endLength = Math.floor(visibleLength / 2);
  return `${value.slice(0, startLength)}…${value.slice(-endLength)}`;
}

function createDefaultConfig(
  agent: AgentSummary | undefined,
  uiPreferences = loadUiPreferences(),
  models: ModelDescriptor[] = []
): ChatRuntimeConfig {
  const merged = mergeChatRuntimeConfigs(
    createDefaultChatRuntimeConfig(),
    agent?.runtimeConfig
  );
  return normalizeConfigForModel(
    {
      ...merged,
      provider: uiPreferences.defaultChatProvider || merged.provider,
      model: uiPreferences.defaultChatModelId || merged.model,
    },
    models
  );
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
    completionStatus: thread.completionStatus,
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
    completionStatus:
      session.status === "completed" || session.status === "failed"
        ? session.status
        : undefined,
  };
}

function buildScheduledTaskSummary(
  task: ScheduleTask,
  agentTitle?: string
): ChatSessionSummary {
  const targetLabel =
    task.targetKind === "orchestrator"
      ? (task.orchestratorSessionId ?? "Orchestrator session")
      : (agentTitle ?? task.agentId ?? "Chat agent");
  return {
    sessionId: task.scheduleId,
    agentId: SCHEDULE_AGENT_ID,
    title: task.title,
    startedAt: task.createdAt,
    summary: `${targetLabel} • ${
      task.enabled ? "Active" : "Paused"
    } • ${task.lastRunStatus}`,
    manifestPath: `agents/${SCHEDULE_AGENT_ID}/history/${task.createdAt.slice(0, 7)}/${task.scheduleId}/SCHEDULE_TASK.json`,
    turnCount: task.totalRuns,
    lastTurnAt: task.lastCompletedAt ?? task.lastRunAt,
    runtimeConfig: task.runtimeConfig,
    completionStatus:
      task.lastRunStatus === "completed" || task.lastRunStatus === "failed"
        ? task.lastRunStatus
        : undefined,
  };
}

function compactThreadsForSnapshot(
  threadsByKey: Record<string, ChatSession>
): Record<string, ChatSession> {
  return Object.fromEntries(
    Object.entries(threadsByKey)
      .sort(
        ([, left], [, right]) =>
          getThreadActivityTimestamp(right) - getThreadActivityTimestamp(left)
      )
      .slice(0, MAX_CACHED_THREAD_COUNT)
      .map(([threadKey, thread]) => [
        threadKey,
        {
          ...thread,
          turns: thread.turns.slice(-MAX_CACHED_THREAD_TURNS),
        },
      ])
  );
}

function getThreadActivityTimestamp(thread: ChatSession): number {
  const timestamp = Date.parse(thread.lastTurnAt ?? thread.startedAt);
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

function clearSessionNotificationAck(
  acknowledgements: Record<string, string>,
  agentId: string,
  sessionId: string
): Record<string, string> {
  const key = getSessionNotificationKey(agentId, sessionId);
  if (!(key in acknowledgements)) {
    return acknowledgements;
  }

  const next = { ...acknowledgements };
  delete next[key];
  return next;
}

function getDangerTitle(action: DangerAction): string {
  switch (action.kind) {
    case "chat-session":
      return "Delete this chat history?";
    case "orchestrator-session":
      return "Delete this orchestrator session?";
    case "orchestrator-duplicates":
      return "Delete older duplicate sessions?";
    case "orchestrator-session-restart":
      return "Start a new tmux session?";
    case "orchestrator-job":
      return "Delete this queued task?";
    case "schedule-task":
      return "Delete this scheduled task?";
  }
}

function getDangerDescription(action: DangerAction): string {
  switch (action.kind) {
    case "chat-session":
      return `Remove "${action.title}" from this agent's saved conversation history.`;
    case "orchestrator-session":
      return `Remove "${action.title}" and all of its delegated work.`;
    case "orchestrator-duplicates":
      return `Remove ${action.duplicateSessionIds.length} older saved session${
        action.duplicateSessionIds.length === 1 ? "" : "s"
      } for "${action.title}".`;
    case "orchestrator-session-restart":
      return `Start a fresh tmux pane for "${action.title}" and stop the current one.`;
    case "orchestrator-job":
      return "Remove this queued task before it starts running in tmux.";
    case "schedule-task":
      return `Remove "${action.title}" and stop any future scheduled runs for this task.`;
  }
}

function getDangerDetails(action: DangerAction): string[] {
  switch (action.kind) {
    case "chat-session":
      return [
        `${action.turnCount} saved message${action.turnCount === 1 ? "" : "s"}`,
        action.lastActivity
          ? `Last activity ${formatTimestamp(action.lastActivity)}`
          : "Last activity unavailable",
      ];
    case "orchestrator-session":
      return [
        `${action.delegatedJobCount} delegated job${action.delegatedJobCount === 1 ? "" : "s"} total`,
        `${action.queuedJobCount} queued task${action.queuedJobCount === 1 ? "" : "s"} will be removed`,
        `Current status: ${action.status}`,
      ];
    case "orchestrator-duplicates":
      return [
        `Keeping ${action.keptSessionId}`,
        `${action.duplicateSessionIds.length} older duplicate session${
          action.duplicateSessionIds.length === 1 ? "" : "s"
        } will be deleted`,
      ];
    case "orchestrator-session-restart":
      return [
        `${action.delegatedJobCount} delegated job${action.delegatedJobCount === 1 ? "" : "s"} total`,
        `${action.queuedJobCount} queued task${action.queuedJobCount === 1 ? "" : "s"} remain queued for this session`,
        action.runningJobPromptPreview
          ? `Current running task will stop: ${action.runningJobPromptPreview}`
          : `Current status: ${action.status}`,
      ];
    case "orchestrator-job":
      return [
        action.promptPreview,
        `Queued ${formatTimestamp(action.submittedAt)}`,
      ];
    case "schedule-task":
      return [
        `Target: ${action.agentId}`,
        `Last result: ${action.lastRunStatus}`,
      ];
  }
}

function getDangerWarning(action: DangerAction): string {
  switch (action.kind) {
    case "chat-session":
      return "This permanently removes the session manifest, turns, cached draft, and any offline queued retries for this chat.";
    case "orchestrator-session":
      return "This permanently removes the saved session, stops its tmux window when possible, and deletes every queued task in that session.";
    case "orchestrator-duplicates":
      return "This permanently removes the older duplicate sessions and their delegated job history. The currently selected session stays available.";
    case "orchestrator-session-restart":
      return "You will not be able to retrieve or view logs from the previous tmux session after starting a new one. Any running task will be stopped.";
    case "orchestrator-job":
      return "This permanently removes the queued task from the session backlog. Running and completed jobs stay untouched.";
    case "schedule-task":
      return "This permanently removes the scheduled task definition. The backing chat history remains available under the original chat agent.";
  }
}

function getDangerAcknowledgeLabel(action: DangerAction): string {
  switch (action.kind) {
    case "chat-session":
      return "I understand this chat history cannot be restored.";
    case "orchestrator-session":
      return "I understand this session and its queued work cannot be restored.";
    case "orchestrator-duplicates":
      return "I understand the older duplicate sessions cannot be restored.";
    case "orchestrator-session-restart":
      return "I understand the previous tmux session logs will no longer be available.";
    case "orchestrator-job":
      return "I understand this queued task will be removed before it runs.";
    case "schedule-task":
      return "I understand this scheduled task cannot be restored.";
  }
}

function getDangerConfirmLabel(action: DangerAction): string {
  switch (action.kind) {
    case "chat-session":
      return "Delete chat history";
    case "orchestrator-session":
      return "Delete session";
    case "orchestrator-duplicates":
      return "Delete older duplicates";
    case "orchestrator-session-restart":
      return "Start new tmux session";
    case "orchestrator-job":
      return "Delete queued task";
    case "schedule-task":
      return "Delete schedule";
  }
}

function getDangerBusyLabel(action: DangerAction): string {
  switch (action.kind) {
    case "chat-session":
    case "orchestrator-session":
    case "orchestrator-duplicates":
    case "orchestrator-job":
    case "schedule-task":
      return "Deleting...";
    case "orchestrator-session-restart":
      return "Starting...";
  }
}

function buildTitleFromPrompt(prompt: string): string {
  return prompt.trim().split(/\s+/).slice(0, 6).join(" ") || "New session";
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error";
}

function getThreadKey(agentId: string, sessionId: string): string {
  return `${agentId}:${sessionId}`;
}

function didSessionSummaryChange(
  previousSession: ChatSessionSummary,
  nextSession: ChatSessionSummary
): boolean {
  return (
    previousSession.lastTurnAt !== nextSession.lastTurnAt ||
    previousSession.turnCount !== nextSession.turnCount ||
    previousSession.completionStatus !== nextSession.completionStatus
  );
}

function isOfflineError(error: unknown): boolean {
  return (
    error instanceof TypeError ||
    (error instanceof Error && error.message.includes("Failed to fetch"))
  );
}

function isMemorySkillName(name: string): boolean {
  return /memory|working[- ]memory|short[- ]term|long[- ]term/i.test(name);
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
