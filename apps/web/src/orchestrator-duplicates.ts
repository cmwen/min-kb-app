import type { OrchestratorSession } from "@min-kb-app/shared";

interface OrchestratorDuplicateTarget {
  projectPath: string;
  projectPurpose: string;
}

export function findMatchingOrchestratorSessions(
  sessions: readonly OrchestratorSession[],
  target: OrchestratorDuplicateTarget
): OrchestratorSession[] {
  const projectPath = normalizeDuplicateProjectPath(target.projectPath);
  const projectPurpose = normalizeDuplicateProjectPurpose(
    target.projectPurpose
  );
  if (!projectPath || !projectPurpose) {
    return [];
  }

  return sessions
    .filter(
      (session) =>
        normalizeDuplicateProjectPath(session.projectPath) === projectPath &&
        normalizeDuplicateProjectPurpose(session.projectPurpose) ===
          projectPurpose
    )
    .sort(compareOrchestratorSessionRecency);
}

export function normalizeDuplicateProjectPath(value: string): string {
  return value.trim().replace(/[\\/]+$/, "");
}

export function normalizeDuplicateProjectPurpose(value: string): string {
  return value.trim();
}

function compareOrchestratorSessionRecency(
  left: OrchestratorSession,
  right: OrchestratorSession
): number {
  const leftTimestamp = left.updatedAt || left.startedAt;
  const rightTimestamp = right.updatedAt || right.startedAt;
  return rightTimestamp.localeCompare(leftTimestamp);
}
