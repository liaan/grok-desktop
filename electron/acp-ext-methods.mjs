/**
 * Grok ACP client extension methods: plan approval + ask_user_question.
 * Kept out of GrokAcpClient so the client stays a transport + routing shell.
 *
 * Timeouts for abandon/decline live in electron/main.mjs so the pending map
 * and renderer modals settle on the same path as a UI click.
 */
import fs from "node:fs";
import path from "node:path";
import { normalizeAskUserAnswersMap } from "./ask-user-answers.mjs";

/**
 * @param {object} ctx
 * @param {import('node:events').EventEmitter} ctx.emitter
 * @param {(id: any, result: any, error?: any) => void} ctx.respond
 * @param {() => string | null} ctx.sessionDir
 * @param {number|string} id
 * @param {any} params
 */
export async function handleExitPlanMode(ctx, id, params) {
  const planContent =
    params?.planContent ??
    params?.plan_content ??
    params?.content ??
    params?.plan ??
    "";
  const planFilePath =
    params?.planFilePath ??
    params?.plan_file_path ??
    params?.planPath ??
    null;

  let markdown = typeof planContent === "string" ? planContent : "";
  if (!markdown && planFilePath) {
    try {
      markdown = await fs.promises.readFile(String(planFilePath), "utf8");
    } catch {
      /* empty plan UI still opens */
    }
  }
  if (!markdown) {
    const sd = ctx.sessionDir();
    if (sd) {
      try {
        markdown = await fs.promises.readFile(path.join(sd, "plan.md"), "utf8");
      } catch {
        /* ignore */
      }
    }
  }

  // Main process wraps `respond` with timeout + map cleanup + UI dismiss.
  const decision = await new Promise((resolve) => {
    let settled = false;
    const finish = (outcome) => {
      if (settled) return;
      settled = true;
      resolve(outcome || { type: "abandoned" });
    };
    ctx.emitter.emit("plan-approval-request", {
      params: {
        planContent: markdown,
        planFilePath,
        raw: params,
      },
      respond: finish,
    });
  });

  const type = String(decision?.type || decision?.outcome || "abandoned")
    .toLowerCase()
    .replace(/-/g, "_");
  if (type === "approved" || type === "approve" || type === "accepted") {
    ctx.respond(id, { outcome: "approved", type: "approved" });
    return;
  }
  if (type === "request_changes" || type === "requestchanges") {
    ctx.respond(id, {
      outcome: "request_changes",
      type: "request_changes",
      feedback: String(decision?.feedback || decision?.message || ""),
    });
    return;
  }
  ctx.respond(id, { outcome: "abandoned", type: "abandoned" });
}

/**
 * @param {object} ctx
 * @param {import('node:events').EventEmitter} ctx.emitter
 * @param {(id: any, result: any, error?: any) => void} ctx.respond
 * @param {number|string} id
 * @param {any} params
 */
export async function handleAskUserQuestion(ctx, id, params) {
  const questions = Array.isArray(params?.questions) ? params.questions : [];

  const decision = await new Promise((resolve) => {
    let settled = false;
    const finish = (outcome) => {
      if (settled) return;
      settled = true;
      resolve(outcome || { type: "declined" });
    };
    ctx.emitter.emit("user-question-request", {
      params: { questions, raw: params },
      respond: finish,
    });
  });

  const type = String(decision?.type || decision?.outcome || "declined")
    .toLowerCase()
    .replace(/-/g, "_");
  if (type === "answered" || type === "answers" || type === "accepted") {
    ctx.respond(id, {
      outcome: "accepted",
      answers: normalizeAskUserAnswersMap(decision?.answers, questions),
      partial_answers: normalizeAskUserAnswersMap(
        decision?.partial_answers ?? decision?.partialAnswers,
        questions,
      ),
    });
    return;
  }
  if (type === "chat" || type === "chat_about_this") {
    ctx.respond(id, {
      outcome: "chat_about_this",
      message: String(decision?.message || decision?.feedback || ""),
    });
    return;
  }
  if (type === "cancelled" || type === "canceled") {
    ctx.respond(id, { outcome: "cancelled" });
    return;
  }
  ctx.respond(id, { outcome: "skip_interview" });
}
