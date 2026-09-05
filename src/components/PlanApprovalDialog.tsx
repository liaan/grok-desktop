import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { usePrivacy } from "../lib/privacy-context";

export type PlanApprovalRequest = {
  reqId: string;
  planContent: string;
  planFilePath?: string | null;
};

export type PlanApprovalDecision =
  | { type: "approved"; feedback?: string }
  | { type: "request_changes"; feedback: string }
  | { type: "abandoned" };

/**
 * Modal for Grok `x.ai/exit_plan_mode` — approve, request changes, or abandon.
 * Comments stay pinned under the plan (not inside the markdown scroller) so
 * they remain typable on long plans, matching the TUI prompt.
 */
export function PlanApprovalDialog({
  request,
  onRespond,
}: {
  request: PlanApprovalRequest | null;
  onRespond: (reqId: string, decision: PlanApprovalDecision) => void;
}) {
  const [feedback, setFeedback] = useState("");
  const [needNotes, setNeedNotes] = useState(false);
  const notesRef = useRef<HTMLTextAreaElement>(null);
  const onRespondRef = useRef(onRespond);
  onRespondRef.current = onRespond;

  useEffect(() => {
    if (!request) return;
    setFeedback("");
    setNeedNotes(false);
    const id = window.setTimeout(() => notesRef.current?.focus(), 0);
    return () => window.clearTimeout(id);
  }, [request?.reqId]);

  useEffect(() => {
    if (!request) return;
    const reqId = request.reqId;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      onRespondRef.current(reqId, { type: "abandoned" });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [request?.reqId]);

  const { redact } = usePrivacy();

  if (!request) return null;

  const body = request.planContent?.trim()
    ? redact(request.planContent)
    : "_No plan was written yet. You can still approve to start implementing, request changes, or abandon plan mode._";
  const planPath = request.planFilePath
    ? redact(request.planFilePath)
    : null;
  const notes = feedback.trim();

  const approve = () => {
    onRespond(request.reqId, {
      type: "approved",
      ...(notes ? { feedback: notes } : {}),
    });
  };

  const requestChanges = () => {
    if (!notes) {
      setNeedNotes(true);
      notesRef.current?.focus();
      return;
    }
    onRespond(request.reqId, { type: "request_changes", feedback: notes });
  };

  return (
    <div
      className="modal-backdrop plan-approval-backdrop"
      role="presentation"
      data-modal-layer="overlay"
    >
      <div
        className="modal-dialog plan-approval-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="plan-approval-title"
      >
        <div className="modal-header">
          <h2 id="plan-approval-title">Plan ready for review</h2>
          <button
            type="button"
            className="btn ghost btn-sm"
            aria-label="Abandon plan"
            onClick={() => onRespond(request.reqId, { type: "abandoned" })}
          >
            ✕
          </button>
        </div>

        <div className="modal-body plan-approval-body">
          {planPath ? (
            <div className="plan-approval-path" title={planPath}>
              {planPath}
            </div>
          ) : null}
          <div className="plan-approval-markdown markdown-body">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{body}</ReactMarkdown>
          </div>
        </div>

        <label className="plan-feedback-label">
          <span>Comments</span>
          <textarea
            ref={notesRef}
            className={`plan-feedback-input${needNotes ? " invalid" : ""}`}
            rows={4}
            value={feedback}
            onChange={(e) => {
              setFeedback(e.target.value);
              if (e.target.value.trim()) setNeedNotes(false);
            }}
            onKeyDown={(e) => {
              if (e.key !== "Enter" || !(e.metaKey || e.ctrlKey)) return;
              e.preventDefault();
              approve();
            }}
            placeholder="Answer questions, add notes, or request revisions…"
            aria-invalid={needNotes || undefined}
          />
          {needNotes ? (
            <span className="plan-feedback-hint warn">
              Add a comment to request changes, or approve as-is.
            </span>
          ) : (
            <span className="plan-feedback-hint">
              Request changes sends the agent back to planning. Approve with
              comments starts building and keeps these notes. Ctrl/⌘+Enter
              approves.
            </span>
          )}
        </label>

        <div className="modal-footer plan-approval-footer">
          <button
            type="button"
            className="btn danger"
            onClick={() => onRespond(request.reqId, { type: "abandoned" })}
          >
            Abandon
          </button>
          <button type="button" className="btn" onClick={requestChanges}>
            Request changes
          </button>
          <button type="button" className="btn primary" onClick={approve}>
            {notes ? "Approve with comments" : "Approve & build"}
          </button>
        </div>
      </div>
    </div>
  );
}
