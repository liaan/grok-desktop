/**
 * GUI agent:restart helpers — refuse without a project, resume same session,
 * fall back to remembered cwd after a failed spawn, attach inspect without
 * treating inspect failure as restart failure.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mergeRestartResult,
  restartTargetFromAgent,
  restartTargetFromSources,
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

test("restartTargetFromSources prefers live agent then remembered cwd", () => {
  assert.deepEqual(
    restartTargetFromSources(
      { cwd: "/live", sessionId: "live-sid" },
      { cwd: "/old", sessionId: "old-sid" },
    ),
    { cwd: "/live", resumeSessionId: "live-sid" },
  );
  assert.deepEqual(
    restartTargetFromSources(null, { cwd: "/old", sessionId: "old-sid" }),
    { cwd: "/old", resumeSessionId: "old-sid" },
  );
  assert.deepEqual(
    restartTargetFromSources({ cwd: "" }, { cwd: "/old", sessionId: "old-sid" }),
    { cwd: "/old", resumeSessionId: "old-sid" },
  );
  assert.equal(restartTargetFromSources(null, null), null);
  assert.equal(restartTargetFromSources({}, { sessionId: "only-sid" }), null);
});

test("mergeRestartResult attaches backbone without a top-level inspect ok", () => {
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
  assert.equal("ok" in merged, false);
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

test("mergeRestartResult does not treat inspect failure as restart failure", () => {
  const failed = mergeRestartResult(
    { cwd: "/p", sessionId: "s" },
    { ok: false, error: "nope" },
  );
  assert.equal("ok" in failed, false);
  assert.equal(failed.sessionId, "s");
  assert.equal(failed.backbone.ok, false);
  assert.equal(failed.backbone.error, "nope");

  const missing = mergeRestartResult({ cwd: "/p", sessionId: "s" }, undefined);
  assert.equal("ok" in missing, false);
  assert.equal("backbone" in missing, false);
  assert.deepEqual(missing.history, []);
  assert.deepEqual(missing.sessions, []);
  assert.equal(missing.modelId, null);
  assert.equal(missing.modelName, null);
  assert.equal(missing.resumed, false);
});
