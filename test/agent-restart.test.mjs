/**
 * GUI agent:restart helpers — refuse without a project, resume same session,
 * merge inspectBackbone into the openProject-shaped payload.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mergeRestartResult,
  restartTargetFromAgent,
} from "../electron/agent-restart.mjs";

test("restartTargetFromAgent refuses when no agent or cwd", () => {
  assert.equal(restartTargetFromAgent(null), null);
  assert.equal(restartTargetFromAgent(undefined), null);
  assert.equal(restartTargetFromAgent({}), null);
  assert.equal(restartTargetFromAgent({ cwd: "" }), null);
  assert.equal(restartTargetFromAgent({ cwd: "   " }), null);
  assert.equal(restartTargetFromAgent({ sessionId: "s1" }), null);
});

test("restartTargetFromAgent resumes the current session id", () => {
  assert.deepEqual(
    restartTargetFromAgent({ cwd: "/proj", sessionId: "abc" }),
    { cwd: "/proj", resumeSessionId: "abc" },
  );
  assert.deepEqual(restartTargetFromAgent({ cwd: "/proj" }), {
    cwd: "/proj",
    resumeSessionId: null,
  });
  assert.deepEqual(
    restartTargetFromAgent({ cwd: "/proj", sessionId: "" }),
    { cwd: "/proj", resumeSessionId: null },
  );
});

test("mergeRestartResult includes ok + openProject session fields", () => {
  const merged = mergeRestartResult(
    {
      cwd: "/proj",
      sessionId: "sid",
      grokBinary: "/usr/bin/grok",
      resumed: true,
      modelId: "grok-4.6",
      modelName: "Grok 4.6",
      history: [{ id: "1" }],
      backgroundTasks: [{ id: "t" }],
      usage: { turns: 2 },
      sessions: [{ id: "sid" }],
    },
    {
      ok: true,
      skills: [{ name: "review" }],
      mcpServers: [{ name: "fs" }],
      plugins: [],
      grokVersion: "1.2.3",
    },
  );
  assert.equal(merged.ok, true);
  assert.equal(merged.cwd, "/proj");
  assert.equal(merged.sessionId, "sid");
  assert.equal(merged.grokBinary, "/usr/bin/grok");
  assert.equal(merged.resumed, true);
  assert.equal(merged.modelId, "grok-4.6");
  assert.equal(merged.modelName, "Grok 4.6");
  assert.equal(merged.history.length, 1);
  assert.equal(merged.backgroundTasks.length, 1);
  assert.deepEqual(merged.usage, { turns: 2 });
  assert.equal(merged.sessions.length, 1);
  assert.equal(merged.backbone.ok, true);
  assert.equal(merged.backbone.skills[0].name, "review");
  assert.equal(merged.backbone.grokVersion, "1.2.3");
});

test("mergeRestartResult is ok:false when inspect failed or missing", () => {
  assert.equal(mergeRestartResult({ cwd: "/p", sessionId: "s" }, null).ok, false);
  assert.equal(
    mergeRestartResult({ cwd: "/p", sessionId: "s" }, { ok: false, error: "nope" })
      .ok,
    false,
  );
  const empty = mergeRestartResult({ cwd: "/p", sessionId: "s" }, undefined);
  assert.equal(empty.ok, false);
  assert.deepEqual(empty.history, []);
  assert.deepEqual(empty.sessions, []);
  assert.equal(empty.modelId, null);
  assert.equal(empty.modelName, null);
  assert.equal(empty.resumed, false);
});
