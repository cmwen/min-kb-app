import type {
  AgentSummary,
  ChatRequest,
  ChatResponse,
  ChatSession,
  ChatSessionSummary,
  ChatStreamEvent,
  MemoryAnalysisRequest,
  MemoryAnalysisResponse,
  ModelCatalog,
  OrchestratorCapabilities,
  OrchestratorDelegateRequest,
  OrchestratorSchedule,
  OrchestratorScheduleCreateRequest,
  OrchestratorScheduleUpdateRequest,
  OrchestratorSession,
  OrchestratorSessionCreateRequest,
  OrchestratorSessionUpdateRequest,
  OrchestratorTerminalHistoryChunk,
  OrchestratorTerminalInputRequest,
  ScheduleTask,
  ScheduleTaskCreateRequest,
  ScheduleTaskUpdateRequest,
  SkillDescriptor,
  WorkspaceSummary,
} from "@min-kb-app/shared";
import { chatStreamEventSchema } from "@min-kb-app/shared";

export const API_ROOT = import.meta.env.VITE_API_BASE_URL ?? "";

export const api = {
  getWorkspace: () => request<WorkspaceSummary>("/api/workspace"),
  listAgents: () => request<AgentSummary[]>("/api/agents"),
  listModels: () => request<ModelCatalog>("/api/models"),
  listSessions: (agentId: string) =>
    request<ChatSessionSummary[]>(`/api/agents/${agentId}/sessions`),
  getSession: (agentId: string, sessionId: string) =>
    request<ChatSession>(`/api/agents/${agentId}/sessions/${sessionId}`),
  deleteSession: (agentId: string, sessionId: string) =>
    request<{ ok: boolean }>(`/api/agents/${agentId}/sessions/${sessionId}`, {
      method: "DELETE",
    }),
  listSkills: (agentId: string) =>
    request<SkillDescriptor[]>(`/api/agents/${agentId}/skills`),
  analyzeMemory: (
    agentId: string,
    sessionId: string,
    requestBody: MemoryAnalysisRequest = {}
  ) =>
    request<MemoryAnalysisResponse>(
      `/api/agents/${agentId}/sessions/${sessionId}/analyze-for-memory`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify(requestBody),
      }
    ),
  sendMessage: (
    agentId: string,
    sessionId: string | undefined,
    requestBody: ChatRequest
  ) =>
    request<ChatResponse>(
      sessionId
        ? `/api/agents/${agentId}/sessions/${sessionId}/messages`
        : `/api/agents/${agentId}/sessions`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify(requestBody),
      }
    ),
  sendMessageStream: (
    agentId: string,
    sessionId: string | undefined,
    requestBody: ChatRequest,
    onEvent: (event: ChatStreamEvent) => void
  ) =>
    requestNdjson(
      sessionId
        ? `/api/agents/${agentId}/sessions/${sessionId}/messages/stream`
        : `/api/agents/${agentId}/sessions/stream`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify(requestBody),
      },
      onEvent
    ),
  getOrchestratorCapabilities: () =>
    request<OrchestratorCapabilities>("/api/orchestrator/capabilities"),
  listOrchestratorSchedules: (sessionId?: string) =>
    request<OrchestratorSchedule[]>(
      sessionId
        ? `/api/orchestrator/schedules?sessionId=${encodeURIComponent(sessionId)}`
        : "/api/orchestrator/schedules"
    ),
  listOrchestratorSessions: () =>
    request<OrchestratorSession[]>("/api/orchestrator/sessions"),
  getOrchestratorSession: (sessionId: string) =>
    request<OrchestratorSession>(`/api/orchestrator/sessions/${sessionId}`),
  createOrchestratorSession: (requestBody: OrchestratorSessionCreateRequest) =>
    request<OrchestratorSession>("/api/orchestrator/sessions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(requestBody),
    }),
  updateOrchestratorSession: (
    sessionId: string,
    requestBody: OrchestratorSessionUpdateRequest
  ) =>
    request<OrchestratorSession>(`/api/orchestrator/sessions/${sessionId}`, {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(requestBody),
    }),
  delegateOrchestratorJob: (
    sessionId: string,
    requestBody: OrchestratorDelegateRequest
  ) =>
    request<OrchestratorSession>(
      `/api/orchestrator/sessions/${sessionId}/jobs`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify(requestBody),
      }
    ),
  sendOrchestratorInput: (
    sessionId: string,
    requestBody: OrchestratorTerminalInputRequest
  ) =>
    request<OrchestratorSession>(
      `/api/orchestrator/sessions/${sessionId}/input`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify(requestBody),
      }
    ),
  getOrchestratorTerminalHistory: (sessionId: string, beforeOffset: number) =>
    request<OrchestratorTerminalHistoryChunk>(
      `/api/orchestrator/sessions/${sessionId}/terminal?before=${beforeOffset}`
    ),
  cancelOrchestratorJob: (sessionId: string) =>
    request<OrchestratorSession>(
      `/api/orchestrator/sessions/${sessionId}/cancel`,
      {
        method: "POST",
      }
    ),
  restartOrchestratorSession: (sessionId: string) =>
    request<OrchestratorSession>(
      `/api/orchestrator/sessions/${sessionId}/restart`,
      {
        method: "POST",
      }
    ),
  deleteOrchestratorJob: (sessionId: string, jobId: string) =>
    request<OrchestratorSession>(
      `/api/orchestrator/sessions/${sessionId}/jobs/${jobId}`,
      {
        method: "DELETE",
      }
    ),
  createOrchestratorSchedule: (
    requestBody: OrchestratorScheduleCreateRequest
  ) =>
    request<OrchestratorSchedule>("/api/orchestrator/schedules", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(requestBody),
    }),
  updateOrchestratorSchedule: (
    scheduleId: string,
    requestBody: OrchestratorScheduleUpdateRequest
  ) =>
    request<OrchestratorSchedule>(`/api/orchestrator/schedules/${scheduleId}`, {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(requestBody),
    }),
  deleteOrchestratorSchedule: (scheduleId: string) =>
    request<{ ok: boolean }>(`/api/orchestrator/schedules/${scheduleId}`, {
      method: "DELETE",
    }),
  listScheduledTasks: () =>
    request<ScheduleTask[]>("/api/scheduled-chats/tasks"),
  getScheduledTask: (taskId: string) =>
    request<ScheduleTask>(`/api/scheduled-chats/tasks/${taskId}`),
  createScheduledTask: (requestBody: ScheduleTaskCreateRequest) =>
    request<ScheduleTask>("/api/scheduled-chats/tasks", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(requestBody),
    }),
  updateScheduledTask: (
    taskId: string,
    requestBody: ScheduleTaskUpdateRequest
  ) =>
    request<ScheduleTask>(`/api/scheduled-chats/tasks/${taskId}`, {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(requestBody),
    }),
  deleteScheduledTask: (taskId: string) =>
    request<{ ok: boolean }>(`/api/scheduled-chats/tasks/${taskId}`, {
      method: "DELETE",
    }),
  runScheduledTaskNow: (taskId: string) =>
    request<ScheduleTask>(`/api/scheduled-chats/tasks/${taskId}/run-now`, {
      method: "POST",
    }),
};

async function request<T>(resource: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_ROOT}${resource}`, init);
  if (!response.ok) {
    const body = await response.text();
    throw new Error(body || `Request failed with status ${response.status}.`);
  }

  return (await response.json()) as T;
}

async function requestNdjson(
  resource: string,
  init: RequestInit | undefined,
  onEvent: (event: ChatStreamEvent) => void
): Promise<ChatResponse> {
  const response = await fetch(`${API_ROOT}${resource}`, init);
  if (!response.ok) {
    const body = await response.text();
    throw new Error(body || `Request failed with status ${response.status}.`);
  }
  if (!response.body) {
    throw new Error("Streaming response body was empty.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let finalResponse: ChatResponse | undefined;

  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });

    let newlineIndex = buffer.indexOf("\n");
    while (newlineIndex >= 0) {
      const line = buffer.slice(0, newlineIndex).trim();
      buffer = buffer.slice(newlineIndex + 1);
      if (line) {
        const event = chatStreamEventSchema.parse(
          JSON.parse(line) as ChatStreamEvent
        );
        onEvent(event);
        if (event.type === "error") {
          throw new Error(event.error);
        }
        if (event.type === "complete") {
          finalResponse = event.response;
        }
      }
      newlineIndex = buffer.indexOf("\n");
    }

    if (done) {
      break;
    }
  }

  if (!finalResponse) {
    throw new Error("Streaming response ended before completion.");
  }

  return finalResponse;
}
