import type {
  OrchestratorStructuredDiffLine,
  OrchestratorWorkingTreeDiff,
  OrchestratorWorkingTreeFile,
} from "@min-kb-app/shared";
import { Modal } from "./Modal";

interface OrchestratorDiffModalProps {
  open: boolean;
  file?: OrchestratorWorkingTreeFile;
  diff?: OrchestratorWorkingTreeDiff;
  loading: boolean;
  error?: string;
  onClose: () => void;
}

export function OrchestratorDiffModal(props: OrchestratorDiffModalProps) {
  const title = props.file?.path ?? "Local diff";
  const description = props.file
    ? [props.file.displayStatus, formatLineTouchSummary(props.file)]
        .filter(Boolean)
        .join(" · ")
    : undefined;
  const structured = props.diff?.structured;
  const hasStructuredRows = (structured?.hunks.length ?? 0) > 0;
  const metaLines = structured?.headerLines.filter(
    (line) =>
      line.trim().length > 0 &&
      !line.startsWith("diff --git ") &&
      !line.startsWith("--- ") &&
      !line.startsWith("+++ ")
  );

  return (
    <Modal
      open={props.open}
      title={title}
      description={description}
      className="orchestrator-diff-modal"
      onClose={props.onClose}
    >
      {props.file?.previousPath ? (
        <div className="field-note">Renamed from {props.file.previousPath}</div>
      ) : null}
      {metaLines?.length ? (
        <div className="orchestrator-diff-header-lines">
          {metaLines.map((line) => (
            <span key={line} className="orchestrator-diff-header-line">
              {line}
            </span>
          ))}
        </div>
      ) : null}
      {props.loading ? (
        <div className="field-note" role="status">
          Loading diff…
        </div>
      ) : props.error ? (
        <div className="field-note" role="alert">
          {props.error}
        </div>
      ) : hasStructuredRows && structured ? (
        <div className="orchestrator-diff-viewer">
          {structured.hunks.map((hunk, index) => (
            <section
              key={`${hunk.header}-${index}`}
              className="orchestrator-diff-hunk"
            >
              <div className="orchestrator-diff-hunk-header">{hunk.header}</div>
              <div className="orchestrator-diff-hunk-body">
                {hunk.lines.map((line, lineIndex) => (
                  <div
                    key={`${hunk.header}-${lineIndex}-${line.kind}`}
                    className={`orchestrator-diff-row is-${line.kind}`}
                  >
                    <span className="orchestrator-diff-line-number">
                      {formatLineNumber(line.oldLineNumber)}
                    </span>
                    <span className="orchestrator-diff-line-number">
                      {formatLineNumber(line.newLineNumber)}
                    </span>
                    <span className="orchestrator-diff-line-prefix">
                      {getDiffLinePrefix(line)}
                    </span>
                    <code className="orchestrator-diff-line-content">
                      {line.content.length > 0 ? line.content : " "}
                    </code>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      ) : props.diff ? (
        <div className="field-note" role="status">
          {props.diff.message ?? "No text diff is available for this file yet."}
        </div>
      ) : null}
    </Modal>
  );
}

function formatLineTouchSummary(file: OrchestratorWorkingTreeFile): string {
  if (file.lineStats?.isBinary) {
    return "Binary";
  }
  const added = file.lineStats?.added ?? 0;
  const removed = file.lineStats?.removed ?? 0;
  return `+${added} / -${removed}`;
}

function formatLineNumber(value?: number): string {
  return value === undefined ? "" : String(value);
}

function getDiffLinePrefix(line: OrchestratorStructuredDiffLine): string {
  switch (line.kind) {
    case "add":
      return "+";
    case "remove":
      return "-";
    case "context":
      return " ";
    case "meta":
      return "·";
  }
}
