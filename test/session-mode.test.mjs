/**
 * ACP session mode + TUI `/plan` client action (shared/session-mode.mjs).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ALREADY_IN_PLAN_NOTICE,
  DEFAULT_SESSION_MODE_ID,
  PLAN_MODE_ID,
  currentModeIdFromUpdate,
  isPlanMode,
  planSlashAction,
  planSlashDisplay,
  looksLikePlanQuestion,
  rememberSessionMode,
  setSessionModeParams,
} from "../shared/session-mode.mjs";

test("setSessionModeParams uses ACP camelCase wire names", () => {
  assert.deepEqual(setSessionModeParams("sid-1", "plan"), {
    sessionId: "sid-1",
    modeId: "plan",
  });
});

test("isPlanMode is exact snake_case plan", () => {
  assert.equal(isPlanMode("plan"), true);
  assert.equal(isPlanMode(" default "), false);
  assert.equal(isPlanMode("PLAN"), false);
  assert.equal(isPlanMode(null), false);
  assert.equal(isPlanMode(DEFAULT_SESSION_MODE_ID), false);
});

test("rememberSessionMode reads session/new|load modes.currentModeId", () => {
  assert.equal(
    rememberSessionMode({ modes: { currentModeId: "plan" } }),
    "plan",
  );
  assert.equal(
    rememberSessionMode({ modes: { current_mode_id: "ask" } }),
    "ask",
  );
  assert.equal(rememberSessionMode({ sessionId: "x" }), null);
  assert.equal(rememberSessionMode(null), null);
});

test("currentModeIdFromUpdate only handles current_mode_update", () => {
  assert.equal(
    currentModeIdFromUpdate({
      sessionUpdate: "current_mode_update",
      currentModeId: "plan",
    }),
    "plan",
  );
  assert.equal(
    currentModeIdFromUpdate({
      update: {
        session_update: "current_mode_update",
        current_mode_id: "default",
      },
    }),
    "default",
  );
  assert.equal(
    currentModeIdFromUpdate({ sessionUpdate: "agent_message_chunk" }),
    undefined,
  );
});

test("planSlashAction matches TUI: never send /plan as prompt text", () => {
  assert.deepEqual(planSlashAction(""), {
    type: "set-mode",
    modeId: PLAN_MODE_ID,
  });
  assert.deepEqual(planSlashAction("add auth to the app"), {
    type: "set-mode-then-prompt",
    modeId: PLAN_MODE_ID,
    text: "add auth to the app",
  });
  assert.deepEqual(planSlashAction("  great /pr-workflow go  "), {
    type: "set-mode-then-prompt",
    modeId: PLAN_MODE_ID,
    text: "great /pr-workflow go",
  });
  assert.deepEqual(planSlashAction("anything", { alreadyInPlan: true }), {
    type: "already-in-plan",
  });
  assert.match(ALREADY_IN_PLAN_NOTICE, /\/view-plan/);
});

test("planSlashDisplay keeps /plan in the timeline", () => {
  assert.equal(planSlashDisplay(""), "/plan");
  assert.equal(planSlashDisplay("  add auth  "), "/plan add auth");
});

test("looksLikePlanQuestion is numbered questions, not status chatter", () => {
  assert.equal(
    looksLikePlanQuestion(
      "2. When those approaches conflict, which constraint should win?",
    ),
    true,
  );
  assert.equal(
    looksLikePlanQuestion(
      "The workspace looks empty at first glance — I'll check for hidden files.",
    ),
    false,
  );
});
