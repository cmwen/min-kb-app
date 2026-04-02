import type { ModelDescriptor } from "@min-kb-app/shared";
import {
  isLastVisibleModel,
  type ResolvedTheme,
  type ThemePreference,
} from "../ui-preferences";
import { Modal } from "./Modal";

interface SettingsModalProps {
  open: boolean;
  theme: ThemePreference;
  resolvedTheme: ResolvedTheme;
  models: ModelDescriptor[];
  hiddenModelIds: string[];
  selectedChatModelId: string;
  selectedModelId: string;
  onClose: () => void;
  onThemeChange: (theme: ThemePreference) => void;
  onChatModelChange: (modelId: string) => void;
  onToggleModelVisibility: (modelId: string) => void;
  onShowAllModels: () => void;
}

const SHORTCUTS = [
  ["Open command palette", "Cmd/Ctrl+K"],
  ["Open settings", "Cmd/Ctrl+,"],
  ["Send message", "Cmd/Ctrl+Enter"],
  ["Start new chat", "Alt+Shift+N"],
  ["Focus composer", "/"],
  ["Close modal or palette", "Esc"],
  ["Resize sidebar when the handle is focused", "ArrowLeft / ArrowRight"],
  ["Navigate agent or session lists", "Arrow keys / Home / End"],
] as const;

export function SettingsModal(props: SettingsModalProps) {
  return (
    <Modal
      open={props.open}
      title="App settings"
      description="Browser-local preferences for theme, shortcuts, layout discovery, and visible models."
      className="settings-modal"
      onClose={props.onClose}
    >
      <div className="settings-grid">
        <section className="settings-card">
          <div>
            <div className="eyebrow">Appearance</div>
            <h3>Theme</h3>
            <p className="panel-caption">
              Choose how the app should look in this browser.
            </p>
          </div>
          <label className="field-group">
            <span>Theme mode</span>
            <select
              data-autofocus="true"
              value={props.theme}
              onChange={(event) =>
                props.onThemeChange(event.target.value as ThemePreference)
              }
            >
              <option value="system">System</option>
              <option value="dark">Dark</option>
              <option value="light">Light</option>
            </select>
            <small className="field-note">
              Currently rendering the {props.resolvedTheme} theme.
            </small>
          </label>
        </section>

        <section className="settings-card">
          <div>
            <div className="eyebrow">Chat</div>
            <h3>Default model</h3>
            <p className="panel-caption">
              Choose the default model to use when you start a new chat.
            </p>
          </div>
          <label className="field-group">
            <span>New chat model</span>
            <select
              value={props.selectedChatModelId}
              onChange={(event) => props.onChatModelChange(event.target.value)}
            >
              {props.models.map((model) => (
                <option key={model.id} value={model.id}>
                  {model.displayName}
                  {model.provider ? ` - ${model.provider}` : ""}
                </option>
              ))}
            </select>
          </label>
        </section>

        <section className="settings-card">
          <div className="settings-section-header">
            <div>
              <div className="eyebrow">Picker</div>
              <h3>Model visibility</h3>
              <p className="panel-caption">
                Control which models appear in the runtime model dropdown.
              </p>
            </div>
            <button
              type="button"
              className="ghost-button"
              onClick={props.onShowAllModels}
            >
              Show all
            </button>
          </div>
          {props.models.length === 0 ? (
            <div className="empty-panel compact">
              No models reported by the runtime yet.
            </div>
          ) : (
            <div className="settings-checklist">
              {props.models.map((model) => {
                const hidden = props.hiddenModelIds.includes(model.id);
                const disableToggle =
                  isLastVisibleModel(
                    props.models,
                    props.hiddenModelIds,
                    model.id
                  ) && !hidden;

                return (
                  <label
                    key={model.id}
                    className="checkbox-row settings-checkbox"
                  >
                    <input
                      type="checkbox"
                      checked={!hidden}
                      disabled={disableToggle}
                      onChange={() => props.onToggleModelVisibility(model.id)}
                    />
                    <div>
                      <strong>{model.displayName}</strong>
                      <span>
                        {model.id}
                        {model.provider ? ` - ${model.provider}` : ""}
                      </span>
                      {props.selectedModelId === model.id && hidden ? (
                        <span className="field-note">
                          The active session still pins this model until you
                          switch away from it.
                        </span>
                      ) : null}
                    </div>
                  </label>
                );
              })}
            </div>
          )}
        </section>

        <section className="settings-card settings-section-full">
          <div>
            <div className="eyebrow">Keyboard</div>
            <h3>Shortcuts</h3>
            <p className="panel-caption">
              The command palette and session resize handle are fully keyboard
              reachable.
            </p>
          </div>
          <div className="shortcut-list">
            {SHORTCUTS.map(([label, shortcut]) => (
              <div key={label} className="shortcut-item">
                <span>{label}</span>
                <kbd className="shortcut-key">{shortcut}</kbd>
              </div>
            ))}
          </div>
        </section>
      </div>

      <div className="modal-footer">
        <button
          type="button"
          className="primary-button"
          onClick={props.onClose}
        >
          Done
        </button>
      </div>
    </Modal>
  );
}
