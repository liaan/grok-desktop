/**
 * AskUserQuestionExtResponse wire (grok-build ask_user_question/types.rs).
 *
 * Accepted `answers` is a map keyed by question text. Each value is a list of
 * option labels (one element for single-select, several for multi-select).
 * A string value is the older single-label shape and still parses.
 * `annotations` is keyed the same way (`preview` for single-select, `notes`
 * for freeform). Partial answers (chat / skip interview) are one string per
 * question, also keyed by question text.
 */

/**
 * @param {any} question
 * @param {number} index
 */
export function askUserQuestionKey(question, index) {
  const text = String(question?.question || "").trim();
  if (text) return text;
  const id = question?.id != null ? String(question.id).trim() : "";
  return id || String(index);
}

/**
 * @param {any} question
 */
function questionOptions(question) {
  return Array.isArray(question?.options) ? question.options : [];
}

/**
 * @param {any} question
 */
function isMulti(question) {
  return Boolean(question?.multiSelect ?? question?.multi_select);
}

/**
 * @param {any[]} options
 * @param {string} token
 */
function findOption(options, token) {
  const want = String(token);
  return options.find(
    (opt, index) =>
      String(opt?.id ?? index) === want || String(opt?.label ?? "") === want,
  );
}

/**
 * @param {any[]} options
 * @param {string} token
 */
function labelFor(options, token) {
  const opt = findOption(options, token);
  if (!opt) return String(token);
  const index = options.indexOf(opt);
  return String(opt.label || opt.id || index);
}

/**
 * @param {unknown} value
 * @returns {string[]}
 */
function rawParts(value) {
  if (value == null) return [];
  if (Array.isArray(value)) {
    return value.map((part) => String(part)).filter((part) => part !== "");
  }
  if (typeof value === "object") {
    const ids =
      value.selectedOptionIds ??
      value.selected_option_ids ??
      value.optionIds ??
      value.option_ids;
    if (Array.isArray(ids)) return rawParts(ids);
    if (value.label != null) return [String(value.label)];
    if (value.id != null) return [String(value.id)];
    if (value.answer != null) return rawParts(value.answer);
    if (value.value != null) return rawParts(value.value);
    return [];
  }
  const text = String(value);
  return text ? [text] : [];
}

/**
 * @param {any} question
 * @param {unknown} value
 * @returns {string[]}
 */
function labelsFor(question, value) {
  const options = questionOptions(question);
  let parts = rawParts(value);
  if (
    isMulti(question) &&
    parts.length === 1 &&
    parts[0].includes(",") &&
    !findOption(options, parts[0])
  ) {
    const tokens = parts[0]
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean);
    if (tokens.length > 1 && tokens.every((token) => findOption(options, token))) {
      parts = tokens;
    }
  }
  return parts.map((part) => labelFor(options, part)).filter(Boolean);
}

/**
 * @param {unknown} raw
 * @param {any[]} questions
 * @returns {Map<number, unknown>}
 */
function answersByQuestionIndex(raw, questions) {
  /** @type {Map<number, unknown>} */
  const found = new Map();
  if (raw == null) return found;

  if (Array.isArray(raw)) {
    raw.forEach((row, index) => {
      if (row == null) return;
      if (typeof row !== "object") {
        found.set(index, row);
        return;
      }
      const hinted =
        row.questionId ?? row.question_id ?? row.id ?? questions[index]?.id;
      let target = index;
      if (hinted != null) {
        const match = questions.findIndex(
          (question, i) =>
            askUserQuestionKey(question, i) === String(hinted) ||
            String(question?.id ?? "") === String(hinted) ||
            String(i) === String(hinted),
        );
        if (match >= 0) target = match;
      }
      found.set(
        target,
        row.selectedOptionIds ??
          row.selected_option_ids ??
          row.optionIds ??
          row.option_ids ??
          row.answer ??
          row.value ??
          row,
      );
    });
    return found;
  }

  if (typeof raw !== "object") return found;
  questions.forEach((question, index) => {
    const text = String(question?.question || "").trim();
    const id = question?.id != null ? String(question.id) : "";
    const key = askUserQuestionKey(question, index);
    if (Object.prototype.hasOwnProperty.call(raw, key)) {
      found.set(index, raw[key]);
      return;
    }
    if (text && Object.prototype.hasOwnProperty.call(raw, text)) {
      found.set(index, raw[text]);
      return;
    }
    if (id && Object.prototype.hasOwnProperty.call(raw, id)) {
      found.set(index, raw[id]);
      return;
    }
    if (Object.prototype.hasOwnProperty.call(raw, String(index))) {
      found.set(index, raw[String(index)]);
    }
  });
  return found;
}

/**
 * @param {any} question
 * @param {string[]} labels
 * @param {unknown} rawValue
 * @returns {{ preview?: string, notes?: string } | null}
 */
function annotationFor(question, labels, rawValue) {
  /** @type {{ preview?: string, notes?: string }} */
  const annotation = {};
  const options = questionOptions(question);
  if (!isMulti(question) && labels.length === 1) {
    const opt = findOption(options, labels[0]);
    const preview = opt?.preview != null ? String(opt.preview).trim() : "";
    if (preview) annotation.preview = preview;
  }
  const notes =
    rawValue && typeof rawValue === "object" && !Array.isArray(rawValue)
      ? String(rawValue.notes ?? rawValue.note ?? "").trim()
      : "";
  if (notes) annotation.notes = notes;
  return annotation.preview || annotation.notes ? annotation : null;
}

/**
 * Accepted response body, without the `outcome` tag.
 * @param {unknown} raw
 * @param {any[]} [questions]
 * @returns {{ answers: Record<string, string[]>, annotations?: Record<string, { preview?: string, notes?: string }> }}
 */
export function acceptedAskUserWire(raw, questions = []) {
  /** @type {Record<string, string[]>} */
  const answers = {};
  /** @type {Record<string, { preview?: string, notes?: string }>} */
  const annotations = {};
  const list = Array.isArray(questions) ? questions : [];
  if (!list.length && raw && typeof raw === "object" && !Array.isArray(raw)) {
    for (const [key, value] of Object.entries(raw)) {
      const labels = rawParts(value);
      if (labels.length) answers[key] = labels;
    }
    return { answers };
  }
  const byIndex = answersByQuestionIndex(raw, list);
  list.forEach((question, index) => {
    if (!byIndex.has(index)) return;
    const rawValue = byIndex.get(index);
    const labels = labelsFor(question, rawValue);
    if (!labels.length) return;
    const key = askUserQuestionKey(question, index);
    answers[key] = labels;
    const annotation = annotationFor(question, labels, rawValue);
    if (annotation) annotations[key] = annotation;
  });
  return Object.keys(annotations).length ? { answers, annotations } : { answers };
}

/**
 * `partial_answers` for chat_about_this / skip_interview: one string per question.
 * @param {unknown} raw
 * @param {any[]} [questions]
 * @returns {Record<string, string>}
 */
export function partialAskUserAnswers(raw, questions = []) {
  const { answers } = acceptedAskUserWire(raw, questions);
  /** @type {Record<string, string>} */
  const partial = {};
  for (const [key, labels] of Object.entries(answers)) {
    if (labels.length) partial[key] = labels.join(", ");
  }
  return partial;
}

/**
 * @deprecated Use acceptedAskUserWire. Kept so older callers still get a map.
 * @param {unknown} raw
 * @param {any[]} [questions]
 * @returns {Record<string, string>}
 */
export function normalizeAskUserAnswersMap(raw, questions = []) {
  return partialAskUserAnswers(raw, questions);
}
