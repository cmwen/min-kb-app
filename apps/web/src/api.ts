import type {
  AgentSummary,
  ChatRequest,
  ChatResponse,
  ChatSession,
  ChatSessionSummary,
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
  OrchestratorTerminalInputRequest,
  SkillDescriptor,
  WorkspaceSummary,
} from "@min-kb-app/shared";

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
};

async function request<T>(resource: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_ROOT}${resource}`, init);
  if (!response.ok) {
    const body = await response.text();
    throw new Error(body || `Request failed with status ${response.status}.`);
  }

  return (await response.json()) as T;
}
