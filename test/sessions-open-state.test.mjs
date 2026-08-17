/**
 * Disk hydrate: compact events must update lastContextTokens.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  encodeSessionCwd,
  loadSessionOpenState,
} from "../electron/sessions.mjs";

test("loadSessionOpenState applies auto_compact_completed to lastContextTokens", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "grok-sess-"));
  const prev = process.env.GROK_HOME;
  process.env.GROK_HOME = home;
  try {
    const cwd = path.join(home, "proj");
    const sessionId = "sess-compact-1";
    const dir = path.join(home, "sessions", encodeSessionCwd(cwd), sessionId);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "updates.jsonl"),
      [
        JSON.stringify({
          params: {
            update: {
              sessionUpdate: "turn_completed",
              usage: { totalTokens: 80_000 },
            },
          },
        }),
        JSON.stringify({
          method: "_x.ai/session/update",
          params: {
            update: {
              sessionUpdate: "auto_compact_completed",
              tokens_before: 80_000,
              tokens_after: 22_000,
            },
          },
        }),
      ].join("\n"),
    );
    const { usage } = loadSessionOpenState(cwd, sessionId);
    assert.equal(usage.lastContextTokens, 22_000);
    assert.equal(usage.turns, 1);
  } finally {
    if (prev === undefined) delete process.env.GROK_HOME;
    else process.env.GROK_HOME = prev;
    fs.rmSync(home, { recursive: true, force: true });
  }
});
