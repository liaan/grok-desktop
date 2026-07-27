import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { usePrivacy } from "../lib/privacy-context";

export type PlanApprovalRequest = {
  reqId: string;
  planContent: string;
  planFilePath?: string | null;
};

/**
 * Modal for Grok `x.ai/exit_plan_mode` — approve, request changes, or abandon.
 */
export function PlanApprovalDialog({
  request,
  onRespond,
}: {
  request: PlanApprovalRequest | null;
  onRespond: (
    reqId: string,
    decision:
      | { type: "approved" }
      | { type: "request_changes"; feedback: string }
      | { type: "abandoned" },
  ) => void;
}) {
  const [feedback, setFeedback] = useState("");
  const [mode, setMode] = useState<"review" | "changes">("review");
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!request) return;
    setFeedback("");
    setMode("review");
    closeRef.current?.focus();
  }, [request?.reqId]);

  const { redact } = usePrivacy();

  if (!request) return null;

  const body = request.planContent?.trim()
    ? redact(request.planContent)
    : "_No plan was written yet. You can still approve to start implementing, request changes, or abandon plan mode._";
  const planPath = request.planFilePath
    ? redact(request.planFilePath)
    : null;

  return (
    <div className="modal-backdrop plan-approval-backdrop" role="presentation">
      <div
        className="modal-dialog plan-approval-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="plan-approval-title"
      >
        <div className="modal-header">
          <h2 id="plan-approval-title">Plan ready for review</h2>
          <button
            ref={closeRef}
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

          {mode === "changes" ? (
            <label className="plan-feedback-label">
              <span>What should change?</span>
              <textarea
                className="plan-feedback-input"
                rows={4}
                value={feedback}
                onChange={(e) => setFeedback(e.target.value)}
                placeholder="Describe revisions for the agent…"
                autoFocus
              />
            </label>
          ) : null}
        </div>

        <div className="modal-footer plan-approval-footer">
          {mode === "review" ? (
            <>
              <button
                type="button"
                className="btn danger"
                onClick={() =>
                  onRespond(request.reqId, { type: "abandoned" })
                }
              >
                Abandon
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => setMode("changes")}
              >
                Request changes
              </button>
              <button
                type="button"
                className="btn primary"
                onClick={() =>
                  onRespond(request.reqId, { type: "approved" })
                }
              >
                Approve &amp; build
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                className="btn"
                onClick={() => setMode("review")}
              >
                Back
              </button>
              <button
                type="button"
                className="btn primary"
                disabled={!feedback.trim()}
                onClick={() =>
                  onRespond(request.reqId, {
                    type: "request_changes",
                    feedback: feedback.trim(),
                  })
                }
              >
                Send feedback
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
