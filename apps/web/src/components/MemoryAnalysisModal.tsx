import type { MemoryAnalysisResponse } from "@min-kb-app/shared";
import ReactMarkdown from "react-markdown";
import { Modal } from "./Modal";

interface MemoryAnalysisModalProps {
  open: boolean;
  result?: MemoryAnalysisResponse;
  onClose: () => void;
}

export function MemoryAnalysisModal(props: MemoryAnalysisModalProps) {
  return (
    <Modal
      open={props.open}
      title="Memory analysis"
      description="GPT-4.1 reviewed the current chat history and highlighted what is worth remembering."
      className="memory-analysis-modal"
      onClose={props.onClose}
    >
      {props.result ? (
        <>
          <div className="settings-card">
            <div className="eyebrow">Model</div>
            <strong>{props.result.model}</strong>
            <div className="panel-caption">
              Enabled memory skills:{" "}
              {props.result.enabledSkillNames.length > 0
                ? props.result.enabledSkillNames.join(", ")
                : "No memory-specific skills detected"}
            </div>
          </div>
          <article className="settings-card memory-analysis-body">
            <ReactMarkdown>{props.result.markdown}</ReactMarkdown>
          </article>
        </>
      ) : (
        <div className="empty-panel">No analysis result to display yet.</div>
      )}
    </Modal>
  );
}
