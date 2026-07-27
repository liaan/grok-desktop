/**
 * Normalize UI answers into the map shape Grok expects for
 * AskUserQuestionExtResponse.accepted.
 *
 * Agent rejects arrays: "invalid type: sequence, expected a map".
 */

/**
 * @param {unknown} raw
 * @param {any[]} [questions]
 * @returns {Record<string, string>}
 */
export function normalizeAskUserAnswersMap(raw, questions = []) {
  /** @type {Record<string, string>} */
  const out = {};

  const put = (key, value) => {
    if (key == null || key === "") return;
    const k = String(key);
    if (value == null) return;
    if (Array.isArray(value)) {
      // multi-select → comma-joined ids (map values must not be sequences)
      const parts = value.map(String).filter(Boolean);
      if (parts.length) out[k] = parts.join(",");
      return;
    }
    if (typeof value === "object") {
      const ids =
        value.selectedOptionIds ??
        value.selected_option_ids ??
        value.optionIds ??
        value.option_ids;
      if (Array.isArray(ids) && ids.length) {
        out[k] = ids.map(String).join(",");
        return;
      }
      if (value.label != null) {
        out[k] = String(value.label);
        return;
      }
      if (value.id != null) {
        out[k] = String(value.id);
        return;
      }
      return;
    }
    out[k] = String(value);
  };

  if (raw == null) return out;

  if (Array.isArray(raw)) {
    for (let i = 0; i < raw.length; i++) {
      const row = raw[i];
      if (row == null) continue;
      if (typeof row !== "object") {
        put(String(i), row);
        continue;
      }
      const qid =
        row.questionId ??
        row.question_id ??
        row.id ??
        questions[i]?.id ??
        String(i);
      const ids =
        row.selectedOptionIds ??
        row.selected_option_ids ??
        row.optionIds ??
        row.option_ids ??
        row.answer ??
        row.value;
      put(qid, ids);
    }
    return out;
  }

  if (typeof raw === "object") {
    for (const [k, v] of Object.entries(raw)) {
      put(k, v);
    }
  }

  return out;
}
