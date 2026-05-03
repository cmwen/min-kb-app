import type {
  ChatProviderDescriptor,
  ChatRuntimeConfig,
  ModelDescriptor,
  ReasoningEffort,
  SkillDescriptor,
  SkillScope,
} from "@min-kb-app/shared";
import { useEffect, useId, useRef, useState } from "react";
import {
  findModelDescriptor,
  findProviderDescriptor,
  formatReasoningEffort,
  getModelsForProvider,
} from "../model-config";

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
  providers: ChatProviderDescriptor[];
  models: ModelDescriptor[];
  visibleModels: ModelDescriptor[];
  skills: SkillDescriptor[];
  config: ChatRuntimeConfig;
  mcpText: string;
  mcpError?: string;
  onProviderChange: (provider: string) => void;
  onModelChange: (model: string) => void;
  onReasoningEffortChange: (reasoningEffort?: ReasoningEffort) => void;
  onLmStudioEnableThinkingChange: (enableThinking?: boolean) => void;
  onSkillToggle: (skillName: string) => void;
  onMcpTextChange: (value: string) => void;
}

export function RuntimeControls(props: RuntimeControlsProps) {
  const [openPanel, setOpenPanel] = useState<RuntimePanelId | undefined>();
  const containerRef = useRef<HTMLDivElement>(null);
  const panelIdPrefix = useId();
  const modelPanelId = `${panelIdPrefix}-model`;
  const skillsPanelId = `${panelIdPrefix}-skills`;
  const mcpPanelId = `${panelIdPrefix}-mcp`;
  const selectedProvider = findProviderDescriptor(
    props.providers,
    props.config.provider
  );
  const selectedModel = findModelDescriptor(
    props.models,
    props.config.model,
    props.config.provider
  );
  const modelOptions =
    getModelsForProvider(props.visibleModels, props.config.provider).length > 0
      ? getModelsForProvider(props.visibleModels, props.config.provider)
      : [
          {
            id: props.config.model,
            displayName: props.config.model,
            runtimeProvider: props.config.provider,
            supportedReasoningEfforts: [],
          },
        ];
  const providerCapabilities = selectedProvider?.capabilities;
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
          aria-controls={modelPanelId}
          aria-haspopup="dialog"
          onClick={() => togglePanel("model")}
        >
          <span className="toolbar-chip-label">Runtime</span>
          <strong>{selectedModel?.displayName ?? props.config.model}</strong>
          <small>
            {selectedProvider?.displayName ?? "Runtime default"}
            {props.config.reasoningEffort
              ? ` - ${formatReasoningEffort(props.config.reasoningEffort)}`
              : ""}
          </small>
        </button>
        <div
          id={modelPanelId}
          className="runtime-panel"
          data-panel="model"
          data-state={openPanel === "model" ? "open" : "closed"}
          role="dialog"
          aria-label="Model picker"
          aria-hidden={openPanel !== "model"}
        >
          <div className="settings-card">
            <label className="field-group">
              <span>Provider</span>
              <select
                data-autofocus="true"
                value={props.config.provider}
                onChange={(event) => props.onProviderChange(event.target.value)}
              >
                {props.providers.map((provider) => (
                  <option key={provider.id} value={provider.id}>
                    {provider.displayName}
                  </option>
                ))}
              </select>
              {selectedProvider?.description ? (
                <small className="field-note">
                  {selectedProvider.description}
                </small>
              ) : null}
            </label>
            <label className="field-group">
              <span>Model</span>
              <select
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
                  ? ` - served by ${selectedModel.provider}`
                  : ""}
              </small>
            </label>
            {providerCapabilities?.supportsReasoningEffort &&
            selectedModel?.supportedReasoningEfforts.length ? (
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
                  Only shown when the selected model exposes reasoning controls.
                </small>
              </label>
            ) : null}
            {props.config.provider === "lmstudio" ? (
              <label className="field-group">
                <span>Thinking mode</span>
                <select
                  value={
                    props.config.lmStudioEnableThinking === undefined
                      ? ""
                      : props.config.lmStudioEnableThinking
                        ? "enabled"
                        : "disabled"
                  }
                  onChange={(event) =>
                    props.onLmStudioEnableThinkingChange(
                      event.target.value === ""
                        ? undefined
                        : event.target.value === "enabled"
                    )
                  }
                >
                  <option value="">Model default</option>
                  <option value="enabled">Enabled</option>
                  <option value="disabled">
                    Quick response (thinking off)
                  </option>
                </select>
                <small className="field-note">
                  Sends LM Studio&apos;s custom <code>enable_thinking</code>{" "}
                  flag. Turning it off can speed up Gemma 4 replies and leave
                  more room for the visible answer.
                </small>
              </label>
            ) : null}
          </div>
        </div>
      </div>

      <div className="runtime-control">
        <button
          type="button"
          className={
            openPanel === "skills" ? "toolbar-chip open" : "toolbar-chip"
          }
          aria-expanded={openPanel === "skills"}
          aria-controls={skillsPanelId}
          aria-haspopup="dialog"
          onClick={() => togglePanel("skills")}
        >
          <span className="toolbar-chip-label">Skills</span>
          <strong>{enabledSkillCount} enabled</strong>
          <small>
            {providerCapabilities?.supportsSkills
              ? `${props.skills.length} available`
              : "Unsupported"}
          </small>
        </button>
        <div
          id={skillsPanelId}
          className="runtime-panel skills-panel"
          role="dialog"
          aria-label="Skill toggles"
          data-panel="skills"
          data-state={openPanel === "skills" ? "open" : "closed"}
          aria-hidden={openPanel !== "skills"}
        >
          <div className="settings-card">
            {!providerCapabilities?.supportsSkills ? (
              <div className="empty-panel compact">
                {selectedProvider?.displayName ?? "This provider"} does not
                expose Copilot skills in this runtime.
              </div>
            ) : props.skills.length === 0 ? (
              <div className="empty-panel compact">
                No skills discovered for this agent.
              </div>
            ) : (
              <>
                {props.config.provider === "lmstudio" ? (
                  <div className="field-note">
                    Enabled skills are injected into the LM Studio prompt as
                    instruction context. MCP tool execution still requires the
                    GitHub Copilot runtime.
                  </div>
                ) : null}
                {groupedSkills.map((group) => (
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
                ))}
              </>
            )}
          </div>
        </div>
      </div>

      <div className="runtime-control">
        <button
          type="button"
          className={openPanel === "mcp" ? "toolbar-chip open" : "toolbar-chip"}
          aria-expanded={openPanel === "mcp"}
          aria-controls={mcpPanelId}
          aria-haspopup="dialog"
          onClick={() => togglePanel("mcp")}
        >
          <span className="toolbar-chip-label">MCP</span>
          <strong>{mcpServerCount} configured</strong>
          <small>
            {!providerCapabilities?.supportsMcpServers
              ? "Unsupported"
              : props.mcpError
                ? "Invalid JSON"
                : "Ready"}
          </small>
        </button>
        <div
          id={mcpPanelId}
          className="runtime-panel mcp-panel"
          role="dialog"
          aria-label="MCP configuration"
          data-panel="mcp"
          data-state={openPanel === "mcp" ? "open" : "closed"}
          aria-hidden={openPanel !== "mcp"}
        >
          <div className="settings-card">
            {!providerCapabilities?.supportsMcpServers ? (
              <div className="empty-panel compact">
                {selectedProvider?.displayName ?? "This provider"} does not
                support MCP server wiring in this runtime.
              </div>
            ) : (
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
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
