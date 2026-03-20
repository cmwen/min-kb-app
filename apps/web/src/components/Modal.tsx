import {
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  useEffect,
  useId,
  useRef,
} from "react";

const FOCUSABLE_SELECTOR = [
  "button:not([disabled])",
  "a[href]",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

interface ModalProps {
  open: boolean;
  title: string;
  description?: string;
  className?: string;
  onClose: () => void;
  children: ReactNode;
}

export function Modal(props: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    if (!props.open) {
      return;
    }

    const previousActiveElement =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const panel = panelRef.current;
    if (!panel) {
      return;
    }

    const autofocusTarget = panel.querySelector<HTMLElement>(
      "[data-autofocus='true']"
    );
    (autofocusTarget ?? getFocusableElements(panel)[0] ?? panel).focus();

    return () => previousActiveElement?.focus();
  }, [props.open]);

  if (!props.open) {
    return null;
  }

  function handleKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      props.onClose();
      return;
    }

    if (event.key !== "Tab") {
      return;
    }

    const panel = panelRef.current;
    if (!panel) {
      return;
    }

    const focusableElements = getFocusableElements(panel);
    if (focusableElements.length === 0) {
      event.preventDefault();
      panel.focus();
      return;
    }

    const firstElement = focusableElements[0];
    const lastElement = focusableElements[focusableElements.length - 1];
    if (event.shiftKey && document.activeElement === firstElement) {
      event.preventDefault();
      lastElement?.focus();
    } else if (!event.shiftKey && document.activeElement === lastElement) {
      event.preventDefault();
      firstElement?.focus();
    }
  }

  return (
    <div className="modal-overlay">
      <button
        type="button"
        className="modal-scrim"
        aria-label={`Close ${props.title}`}
        onClick={props.onClose}
      />
      <div
        ref={panelRef}
        className={
          props.className ? `modal-panel ${props.className}` : "modal-panel"
        }
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={props.description ? descriptionId : undefined}
        tabIndex={-1}
        onKeyDown={handleKeyDown}
      >
        <header className="modal-header">
          <div>
            <h2 id={titleId}>{props.title}</h2>
            {props.description ? (
              <p id={descriptionId} className="panel-caption">
                {props.description}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            className="ghost-button modal-close-button"
            onClick={props.onClose}
          >
            Close
          </button>
        </header>
        <div className="modal-body">{props.children}</div>
      </div>
    </div>
  );
}

function getFocusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
  );
}
