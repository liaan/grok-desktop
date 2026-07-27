import { useEffect, useMemo, useState } from "react";

export type AskUserQuestion = {
  id?: string;
  question?: string;
  header?: string;
  options?: Array<{
    id?: string;
    label?: string;
    description?: string;
  }>;
  multiSelect?: boolean;
  multi_select?: boolean;
};

export type AskUserRequest = {
  reqId: string;
  questions: AskUserQuestion[];
};

/**
 * Modal for Grok `x.ai/ask_user_question`.
 */
export function AskUserDialog({
  request,
  onRespond,
}: {
  request: AskUserRequest | null;
  onRespond: (
    reqId: string,
    decision:
      | { type: "answered"; answers: Array<Record<string, unknown>> }
      | { type: "declined" },
  ) => void;
}) {
  const questions = request?.questions || [];
  const [answers, setAnswers] = useState<Record<string, string[]>>({});

  useEffect(() => {
    if (!request) return;
    setAnswers({});
  }, [request?.reqId]);

  const allAnswered = useMemo(() => {
    if (!questions.length) return false;
    return questions.every((q, i) => {
      const key = String(q.id ?? i);
      return (answers[key] || []).length > 0;
    });
  }, [questions, answers]);

  if (!request) return null;

  const toggle = (qKey: string, optId: string, multi: boolean) => {
    setAnswers((prev) => {
      const cur = prev[qKey] || [];
      if (multi) {
        const next = cur.includes(optId)
          ? cur.filter((x) => x !== optId)
          : [...cur, optId];
        return { ...prev, [qKey]: next };
      }
      return { ...prev, [qKey]: [optId] };
    });
  };

  const submit = () => {
    const payload = questions.map((q, i) => {
      const key = String(q.id ?? i);
      return {
        questionId: q.id ?? key,
        question_id: q.id ?? key,
        selectedOptionIds: answers[key] || [],
        selected_option_ids: answers[key] || [],
      };
    });
    onRespond(request.reqId, { type: "answered", answers: payload });
  };

  return (
    <div className="modal-backdrop" role="presentation">
      <div
        className="modal-dialog ask-user-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ask-user-title"
      >
        <div className="modal-header">
          <h2 id="ask-user-title">Agent needs your input</h2>
        </div>
        <div className="modal-body">
          {questions.length === 0 ? (
            <p className="muted">No questions provided.</p>
          ) : (
            questions.map((q, i) => {
              const qKey = String(q.id ?? i);
              const multi = Boolean(q.multiSelect ?? q.multi_select);
              const opts = Array.isArray(q.options) ? q.options : [];
              const selected = answers[qKey] || [];
              return (
                <div key={qKey} className="ask-user-q">
                  <div className="ask-user-q-text">
                    {q.header ? (
                      <div className="ask-user-q-header">{q.header}</div>
                    ) : null}
                    {q.question || `Question ${i + 1}`}
                  </div>
                  <div className="ask-user-opts">
                    {opts.map((opt, j) => {
                      const optId = String(opt.id ?? j);
                      const on = selected.includes(optId);
                      return (
                        <button
                          key={optId}
                          type="button"
                          className={`ask-user-opt ${on ? "active" : ""}`}
                          onClick={() => toggle(qKey, optId, multi)}
                        >
                          <span className="ask-user-opt-label">
                            {opt.label || optId}
                          </span>
                          {opt.description ? (
                            <span className="ask-user-opt-desc">
                              {opt.description}
                            </span>
                          ) : null}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })
          )}
        </div>
        <div className="modal-footer">
          <button
            type="button"
            className="btn"
            onClick={() => onRespond(request.reqId, { type: "declined" })}
          >
            Skip
          </button>
          <button
            type="button"
            className="btn primary"
            disabled={!allAnswered}
            onClick={submit}
          >
            Submit
          </button>
        </div>
      </div>
    </div>
  );
}
