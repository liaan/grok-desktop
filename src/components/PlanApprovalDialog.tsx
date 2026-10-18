import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { usePrivacy } from "../lib/privacy-context";
import { useI18n } from "../lib/i18n";

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
  const { t } = useI18n();
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
    : t("plan.empty");
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
          <h2 id="plan-approval-title">{t("plan.title")}</h2>
          <button
            type="button"
            className="btn ghost btn-sm"
            aria-label={t("plan.abandon")}
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
          <span>{t("plan.comments")}</span>
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
            placeholder={t("plan.placeholder")}
            aria-invalid={needNotes || undefined}
          />
          {needNotes ? (
            <span className="plan-feedback-hint warn">
              {t("plan.commentRequired")}
            </span>
          ) : (
            <span className="plan-feedback-hint">
              {t("plan.hint")}
            </span>
          )}
        </label>

        <div className="modal-footer plan-approval-footer">
          <button
            type="button"
            className="btn danger"
            onClick={() => onRespond(request.reqId, { type: "abandoned" })}
          >
            {t("plan.abandonShort")}
          </button>
          <button type="button" className="btn" onClick={requestChanges}>
            {t("plan.requestChanges")}
          </button>
          <button type="button" className="btn primary" onClick={approve}>
            {notes ? t("plan.approveComments") : t("plan.approveBuild")}
          </button>
        </div>
      </div>
    </div>
  );
}
