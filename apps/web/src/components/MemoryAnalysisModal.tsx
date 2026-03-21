import type { MemoryAnalysisResponse } from "@min-kb-app/shared";
import ReactMarkdown from "react-markdown";
import { Modal } from "./Modal";

interface MemoryAnalysisModalProps {
  open: boolean;
  loading?: boolean;
  result?: MemoryAnalysisResponse;
  onClose: () => void;
}

export function MemoryAnalysisModal(props: MemoryAnalysisModalProps) {
  const outcomeTitle = props.result ? getOutcomeTitle(props.result) : undefined;
  const outcomeDetails = props.result
    ? getOutcomeDetails(props.result)
    : undefined;

  return (
    <Modal
      open={props.open}
      title="Memory analysis"
      description={
        props.result
          ? `${props.result.model} reviewed the current chat history and reported what happened during the memory analysis run.`
          : props.loading
            ? "Reviewing the current chat history and waiting for skill activity."
            : "Review the current chat history and use any enabled memory skills to update memory."
      }
      className="memory-analysis-modal"
      onClose={props.onClose}
    >
      {props.result ? (
        <>
          <div className="settings-card">
            <div className="eyebrow">Outcome</div>
            <strong>{outcomeTitle}</strong>
            <div className="panel-caption">{outcomeDetails}</div>
          </div>
          <div className="settings-card">
            <div className="eyebrow">Model</div>
            <strong>{props.result.model}</strong>
            <div className="panel-caption">
              Requested memory skills:{" "}
              {props.result.configuredMemorySkillNames.length > 0
                ? props.result.configuredMemorySkillNames.join(", ")
                : "No memory-specific skills were detected for this run"}
            </div>
          </div>
          {!props.result.reportedLoadedSkills ? (
            <section className="settings-card">
              <div className="eyebrow">Runtime warning</div>
              <strong>No skill loading diagnostics were reported</strong>
              <div className="panel-caption">
                The runtime did not emit a `session.skills_loaded` event for
                this run, so the loaded and enabled skill lists below may be
                incomplete. Verify the relevant memory skill is installed and
                exposed to the Copilot runtime.
              </div>
            </section>
          ) : null}
          <div className="memory-analysis-debug-grid">
            <section className="settings-card">
              <div className="eyebrow">Working memory</div>
              <strong>
                {countTierSignals(props.result.analysisByTier.working)}
              </strong>
              <div className="panel-caption">
                {formatTierSummary(props.result.analysisByTier.working)}
              </div>
              {props.result.analysisByTier.working.items.length > 0 ? (
                <ul className="memory-analysis-bullet-list">
                  {props.result.analysisByTier.working.items.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              ) : null}
              {props.result.memoryChanges.working.length > 0 ? (
                <div className="memory-analysis-change-list">
                  {props.result.memoryChanges.working.map((change) => (
                    <div
                      key={change.path}
                      className="memory-analysis-change-item"
                    >
                      <strong>{change.title}</strong>
                      <span className="scope-chip">{change.status}</span>
                    </div>
                  ))}
                </div>
              ) : null}
            </section>
            <section className="settings-card">
              <div className="eyebrow">Short-term memory</div>
              <strong>
                {countTierSignals(props.result.analysisByTier.shortTerm)}
              </strong>
              <div className="panel-caption">
                {formatTierSummary(props.result.analysisByTier.shortTerm)}
              </div>
              {props.result.analysisByTier.shortTerm.items.length > 0 ? (
                <ul className="memory-analysis-bullet-list">
                  {props.result.analysisByTier.shortTerm.items.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              ) : null}
              {props.result.memoryChanges.shortTerm.length > 0 ? (
                <div className="memory-analysis-change-list">
                  {props.result.memoryChanges.shortTerm.map((change) => (
                    <div
                      key={change.path}
                      className="memory-analysis-change-item"
                    >
                      <strong>{change.title}</strong>
                      <span className="scope-chip">{change.status}</span>
                    </div>
                  ))}
                </div>
              ) : null}
            </section>
            <section className="settings-card">
              <div className="eyebrow">Long-term memory</div>
              <strong>
                {countTierSignals(props.result.analysisByTier.longTerm)}
              </strong>
              <div className="panel-caption">
                {formatTierSummary(props.result.analysisByTier.longTerm)}
              </div>
              {props.result.analysisByTier.longTerm.items.length > 0 ? (
                <ul className="memory-analysis-bullet-list">
                  {props.result.analysisByTier.longTerm.items.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              ) : null}
              {props.result.memoryChanges.longTerm.length > 0 ? (
                <div className="memory-analysis-change-list">
                  {props.result.memoryChanges.longTerm.map((change) => (
                    <div
                      key={change.path}
                      className="memory-analysis-change-item"
                    >
                      <strong>{change.title}</strong>
                      <span className="scope-chip">{change.status}</span>
                    </div>
                  ))}
                </div>
              ) : null}
            </section>
            <section className="settings-card">
              <div className="eyebrow">Skills loaded</div>
              <strong>{props.result.loadedSkillNames.length}</strong>
              <div className="panel-caption">
                {props.result.loadedSkillNames.length > 0
                  ? props.result.loadedSkillNames.join(", ")
                  : "No skills were reported by the runtime."}
              </div>
            </section>
            <section className="settings-card">
              <div className="eyebrow">Skills enabled</div>
              <strong>{props.result.enabledSkillNames.length}</strong>
              <div className="panel-caption">
                {props.result.enabledSkillNames.length > 0
                  ? props.result.enabledSkillNames.join(", ")
                  : "No enabled skills were reported by the runtime."}
              </div>
            </section>
            <section className="settings-card">
              <div className="eyebrow">Skills invoked</div>
              <strong>{props.result.invokedSkillNames.length}</strong>
              <div className="panel-caption">
                {props.result.invokedSkillNames.length > 0
                  ? props.result.invokedSkillNames.join(", ")
                  : "No skill invocations were reported during this run."}
              </div>
            </section>
          </div>
          {props.result.toolExecutions.length > 0 ? (
            <section className="settings-card">
              <div className="eyebrow">Tool executions</div>
              <div className="memory-analysis-tool-list">
                {props.result.toolExecutions.map((execution, index) => (
                  <article
                    key={`${execution.toolName}-${index}`}
                    className="memory-analysis-tool-item"
                  >
                    <div className="memory-analysis-tool-header">
                      <strong>{execution.toolName}</strong>
                      <span className="scope-chip">
                        {execution.success ? "Succeeded" : "Failed"}
                        {execution.memoryTier
                          ? ` · ${execution.memoryTier}`
                          : ""}
                      </span>
                    </div>
                    {execution.content ? (
                      <div className="panel-caption">{execution.content}</div>
                    ) : null}
                  </article>
                ))}
              </div>
            </section>
          ) : null}
          <article className="settings-card memory-analysis-body">
            <ReactMarkdown>{props.result.markdown}</ReactMarkdown>
          </article>
        </>
      ) : props.loading ? (
        <div className="empty-panel">
          Analyzing memory and waiting for the runtime to report what changed...
        </div>
      ) : (
        <div className="empty-panel">No analysis result to display yet.</div>
      )}
    </Modal>
  );
}

function getOutcomeTitle(result: MemoryAnalysisResponse): string {
  if (result.toolExecutions.some((execution) => execution.success)) {
    return "Memory updates were reported";
  }

  if (result.invokedSkillNames.length > 0) {
    return "Skills ran without reported memory writes";
  }

  if (result.configuredMemorySkillNames.length === 0) {
    return "No memory skills were detected";
  }

  if (!result.reportedLoadedSkills) {
    return "Skill loading diagnostics were missing";
  }

  if (result.enabledSkillNames.length === 0) {
    return "No enabled memory skills were reported";
  }

  return "No memory skill activity was reported";
}

function getOutcomeDetails(result: MemoryAnalysisResponse): string {
  if (result.toolExecutions.some((execution) => execution.success)) {
    return "The runtime reported tool executions for this analysis run. Review the tool list below to see what was written or updated.";
  }

  if (result.invokedSkillNames.length > 0) {
    return "At least one skill was invoked, but the runtime did not report any completed tool executions. Check the skill implementation and runtime tool telemetry.";
  }

  if (result.configuredMemorySkillNames.length === 0) {
    return "No memory-related skills matched this agent, so the analysis could only recommend what should be remembered.";
  }

  if (!result.reportedLoadedSkills) {
    return "The runtime never reported which skills it loaded, so this run cannot confirm whether the requested memory skills were actually available.";
  }

  if (result.enabledSkillNames.length === 0) {
    return "Memory-related skills were requested for this run, but none were reported as enabled by the runtime.";
  }

  return "Memory-related skills were available, but the runtime did not report invoking them during this analysis run.";
}

function countTierSignals(
  tier: MemoryAnalysisResponse["analysisByTier"]["working"]
) {
  return tier.items.length + (tier.summary ? 1 : 0);
}

function formatTierSummary(
  tier: MemoryAnalysisResponse["analysisByTier"]["working"]
): string {
  if (tier.summary) {
    return tier.summary;
  }
  if (tier.items.length > 0) {
    return tier.items.join(" ");
  }
  return "Nothing notable was summarized for this tier.";
}
