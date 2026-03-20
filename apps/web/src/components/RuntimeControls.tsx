import type {
  ChatRuntimeConfig,
  ModelDescriptor,
  ReasoningEffort,
  SkillDescriptor,
  SkillScope,
} from "@min-kb-app/shared";
import { useEffect, useRef, useState } from "react";
import { findModelDescriptor, formatReasoningEffort } from "../model-config";

const SKILL_SCOPE_ORDER: SkillScope[] = [
  "agent-local",
  "store-global",
  "copilot-global",
];

const SKILL_SCOPE_LABELS: Record<SkillScope, string> = {
  "agent-local": "Agent-local skills",
  "store-global": "Store-global skills",
  "copilot-global": "Copilot global skills",
};

type RuntimePanelId = "model" | "skills" | "mcp";

interface RuntimeControlsProps {
  models: ModelDescriptor[];
  visibleModels: ModelDescriptor[];
  skills: SkillDescriptor[];
  config: ChatRuntimeConfig;
  mcpText: string;
  mcpError?: string;
  onModelChange: (model: string) => void;
  onReasoningEffortChange: (reasoningEffort?: ReasoningEffort) => void;
  onSkillToggle: (skillName: string) => void;
  onMcpTextChange: (value: string) => void;
}

export function RuntimeControls(props: RuntimeControlsProps) {
  const [openPanel, setOpenPanel] = useState<RuntimePanelId | undefined>();
  const containerRef = useRef<HTMLDivElement>(null);
  const selectedModel = findModelDescriptor(props.models, props.config.model);
  const modelOptions =
    props.visibleModels.length > 0
      ? props.visibleModels
      : [
          {
            id: props.config.model,
            displayName: props.config.model,
            supportedReasoningEfforts: [],
          },
        ];
  const enabledSkillCount = props.skills.filter(
    (skill) => !props.config.disabledSkills.includes(skill.name)
  ).length;
  const groupedSkills = SKILL_SCOPE_ORDER.map((scope) => ({
    scope,
    label: SKILL_SCOPE_LABELS[scope],
    skills: props.skills.filter((skill) => skill.scope === scope),
  })).filter((group) => group.skills.length > 0);
  const mcpServerCount = Object.keys(props.config.mcpServers).length;

  useEffect(() => {
    if (!openPanel) {
      return;
    }

    const container = containerRef.current;
    if (!container) {
      return;
    }

    const autofocusTarget = container.querySelector<HTMLElement>(
      `[data-panel='${openPanel}'] [data-autofocus='true'], ` +
        `[data-panel='${openPanel}'] select, ` +
        `[data-panel='${openPanel}'] input, ` +
        `[data-panel='${openPanel}'] textarea, ` +
        `[data-panel='${openPanel}'] button`
    );
    autofocusTarget?.focus();

    const handleDocumentMouseDown = (event: MouseEvent) => {
      if (!container.contains(event.target as Node)) {
        setOpenPanel(undefined);
      }
    };
    const handleDocumentKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpenPanel(undefined);
      }
    };

    document.addEventListener("mousedown", handleDocumentMouseDown);
    document.addEventListener("keydown", handleDocumentKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleDocumentMouseDown);
      document.removeEventListener("keydown", handleDocumentKeyDown);
    };
  }, [openPanel]);

  function togglePanel(panelId: RuntimePanelId) {
    setOpenPanel((current) => (current === panelId ? undefined : panelId));
  }

  return (
    <section
      className="runtime-controls"
      ref={containerRef}
      aria-label="Runtime controls"
    >
      <div className="runtime-control">
        <button
          type="button"
          className={
            openPanel === "model" ? "toolbar-chip open" : "toolbar-chip"
          }
          aria-expanded={openPanel === "model"}
          aria-haspopup="dialog"
          onClick={() => togglePanel("model")}
        >
          <span className="toolbar-chip-label">Model</span>
          <strong>{selectedModel?.displayName ?? props.config.model}</strong>
          <small>{selectedModel?.provider ?? "Runtime default"}</small>
        </button>
        {openPanel === "model" ? (
          <div
            className="runtime-panel"
            role="dialog"
            aria-label="Model picker"
            data-panel="model"
          >
            <div className="settings-card">
              <label className="field-group">
                <span>Model</span>
                <select
                  data-autofocus="true"
                  value={props.config.model}
                  onChange={(event) => props.onModelChange(event.target.value)}
                >
                  {modelOptions.map((model) => (
                    <option key={model.id} value={model.id}>
                      {model.displayName}
                    </option>
                  ))}
                </select>
                <small className="field-note">
                  {modelOptions.length} visible option(s)
                  {selectedModel?.provider
                    ? ` - ${selectedModel.provider}`
                    : ""}
                </small>
              </label>
              {selectedModel?.supportedReasoningEfforts.length ? (
                <label className="field-group">
                  <span>Reasoning effort</span>
                  <select
                    value={props.config.reasoningEffort ?? ""}
                    onChange={(event) =>
                      props.onReasoningEffortChange(
                        (event.target.value || undefined) as
                          | ReasoningEffort
                          | undefined
                      )
                    }
                  >
                    <option value="">
                      Model default
                      {selectedModel.defaultReasoningEffort
                        ? ` (${formatReasoningEffort(selectedModel.defaultReasoningEffort)})`
                        : ""}
                    </option>
                    {selectedModel.supportedReasoningEfforts.map(
                      (reasoningEffort) => (
                        <option key={reasoningEffort} value={reasoningEffort}>
                          {formatReasoningEffort(reasoningEffort)}
                        </option>
                      )
                    )}
                  </select>
                  <small className="field-note">
                    Only shown when the selected model exposes reasoning
                    controls.
                  </small>
                </label>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>

      <div className="runtime-control">
        <button
          type="button"
          className={
            openPanel === "skills" ? "toolbar-chip open" : "toolbar-chip"
          }
          aria-expanded={openPanel === "skills"}
          aria-haspopup="dialog"
          onClick={() => togglePanel("skills")}
        >
          <span className="toolbar-chip-label">Skills</span>
          <strong>{enabledSkillCount} enabled</strong>
          <small>{props.skills.length} discovered</small>
        </button>
        {openPanel === "skills" ? (
          <div
            className="runtime-panel skills-panel"
            role="dialog"
            aria-label="Skill toggles"
            data-panel="skills"
          >
            <div className="settings-card">
              {props.skills.length === 0 ? (
                <div className="empty-panel compact">
                  No skills discovered for this agent.
                </div>
              ) : (
                groupedSkills.map((group) => (
                  <section key={group.scope} className="skill-group">
                    <div className="skill-group-header">
                      <div>
                        <strong>{group.label}</strong>
                        <div className="scope-caption">{group.scope}</div>
                      </div>
                      <span className="scope-chip">{group.skills.length}</span>
                    </div>
                    <div className="skill-list">
                      {group.skills.map((skill) => {
                        const enabled = !props.config.disabledSkills.includes(
                          skill.name
                        );
                        return (
                          <label
                            key={`${skill.scope}:${skill.name}`}
                            className="checkbox-row"
                          >
                            <input
                              type="checkbox"
                              checked={enabled}
                              onChange={() => props.onSkillToggle(skill.name)}
                            />
                            <div>
                              <strong>{skill.name}</strong>
                              <span>{skill.description}</span>
                            </div>
                          </label>
                        );
                      })}
                    </div>
                  </section>
                ))
              )}
            </div>
          </div>
        ) : null}
      </div>

      <div className="runtime-control">
        <button
          type="button"
          className={openPanel === "mcp" ? "toolbar-chip open" : "toolbar-chip"}
          aria-expanded={openPanel === "mcp"}
          aria-haspopup="dialog"
          onClick={() => togglePanel("mcp")}
        >
          <span className="toolbar-chip-label">MCP</span>
          <strong>{mcpServerCount} configured</strong>
          <small>{props.mcpError ? "Invalid JSON" : "Ready to send"}</small>
        </button>
        {openPanel === "mcp" ? (
          <div
            className="runtime-panel mcp-panel"
            role="dialog"
            aria-label="MCP configuration"
            data-panel="mcp"
          >
            <div className="settings-card">
              <label className="field-group grow">
                <span>MCP JSON</span>
                <textarea
                  data-autofocus="true"
                  value={props.mcpText}
                  onChange={(event) =>
                    props.onMcpTextChange(event.target.value)
                  }
                  spellCheck={false}
                  rows={12}
                />
                {props.mcpError ? (
                  <small className="error-text">{props.mcpError}</small>
                ) : (
                  <small className="field-note">
                    Invalid JSON blocks sending until it is fixed.
                  </small>
                )}
              </label>
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}
