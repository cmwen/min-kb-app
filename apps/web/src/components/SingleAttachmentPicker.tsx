import { useRef, useState } from "react";
import {
  formatFileSize,
  MAX_ATTACHMENT_SIZE_BYTES,
  validateAttachmentFile,
} from "../attachments";

interface SingleAttachmentPickerProps {
  file?: File;
  pending: boolean;
  onChange: (file: File | undefined) => void;
}

export function SingleAttachmentPicker(props: SingleAttachmentPickerProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | undefined>();

  function handlePick(file: File | undefined) {
    if (!file) {
      setError(undefined);
      props.onChange(undefined);
      return;
    }

    const validationError = validateAttachmentFile(file);
    if (validationError) {
      setError(validationError);
      props.onChange(undefined);
      if (inputRef.current) {
        inputRef.current.value = "";
      }
      return;
    }

    setError(undefined);
    props.onChange(file);
  }

  return (
    <div className="attachment-picker">
      <input
        ref={inputRef}
        type="file"
        className="attachment-picker-input"
        aria-label="Attach file"
        disabled={props.pending}
        onChange={(event) => handlePick(event.target.files?.[0])}
      />
      <div className="attachment-picker-row">
        <button
          type="button"
          className="ghost-button"
          disabled={props.pending}
          onClick={() => inputRef.current?.click()}
        >
          Attach file
        </button>
        <span className="panel-caption">
          One file, up to {formatFileSize(MAX_ATTACHMENT_SIZE_BYTES)}
        </span>
      </div>
      {props.file ? (
        <div className="attachment-chip" role="status">
          <div className="attachment-chip-copy">
            <strong>{props.file.name}</strong>
            <span className="panel-caption">
              {formatFileSize(props.file.size)}
            </span>
          </div>
          <button
            type="button"
            className="ghost-button"
            disabled={props.pending}
            onClick={() => {
              handlePick(undefined);
              if (inputRef.current) {
                inputRef.current.value = "";
              }
            }}
          >
            Remove
          </button>
        </div>
      ) : null}
      {error ? (
        <div className="error-row" role="alert">
          {error}
        </div>
      ) : null}
    </div>
  );
}
