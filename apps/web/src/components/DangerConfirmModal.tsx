import { useEffect, useState } from "react";
import { Modal } from "./Modal";

interface DangerConfirmModalProps {
  open: boolean;
  title: string;
  description: string;
  warning: string;
  acknowledgeLabel: string;
  confirmLabel: string;
  busyLabel?: string;
  details?: string[];
  busy?: boolean;
  onClose: () => void;
  onConfirm: () => void;
}

export function DangerConfirmModal(props: DangerConfirmModalProps) {
  const [acknowledged, setAcknowledged] = useState(false);

  useEffect(() => {
    if (!props.open) {
      setAcknowledged(false);
    }
  }, [props.open]);

  return (
    <Modal
      open={props.open}
      title={props.title}
      description={props.description}
      onClose={props.busy ? () => undefined : props.onClose}
    >
      {props.details?.length ? (
        <ul className="danger-modal-details">
          {props.details.map((detail) => (
            <li key={detail}>{detail}</li>
          ))}
        </ul>
      ) : null}
      <p className="danger-modal-warning">{props.warning}</p>
      <label className="checkbox-row danger-modal-checkbox">
        <input
          type="checkbox"
          checked={acknowledged}
          onChange={(event) => setAcknowledged(event.target.checked)}
          disabled={props.busy}
        />
        <span>{props.acknowledgeLabel}</span>
      </label>
      <div className="modal-footer">
        <button
          type="button"
          className="ghost-button"
          onClick={props.onClose}
          disabled={props.busy}
        >
          Keep it
        </button>
        <button
          type="button"
          className="ghost-button danger-button"
          onClick={props.onConfirm}
          disabled={!acknowledged || props.busy}
          data-autofocus="true"
        >
          {props.busy
            ? (props.busyLabel ?? props.confirmLabel)
            : props.confirmLabel}
        </button>
      </div>
    </Modal>
  );
}
