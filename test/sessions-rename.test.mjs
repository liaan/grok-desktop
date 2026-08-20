/**
 * Session list titles + on-disk rename (CLI `/rename` fields).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  encodeSessionCwd,
  listSessionsForCwd,
  renameSessionOnDisk,
  deleteSessionOnDisk,
  sanitizeSessionTitle,
  displayTitleFromSummary,
  isSafeSessionId,
} from "../electron/sessions.mjs";

function writeSummary(home, cwd, sessionId, raw) {
  const dir = path.join(home, "sessions", encodeSessionCwd(cwd), sessionId);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "summary.json"),
    JSON.stringify(raw, null, 2),
    "utf8",
  );
}

test("displayTitleFromSummary prefers generated_title over session_summary", () => {
  assert.equal(
    displayTitleFromSummary({
      session_summary: "Auto summary",
      generated_title: "Pinned name",
    }),
    "Pinned name",
  );
  assert.equal(
    displayTitleFromSummary({ session_summary: "Auto summary" }),
    "Auto summary",
  );
  assert.equal(displayTitleFromSummary({}), "(no summary)");
});

test("sanitizeSessionTitle strips controls and trims", () => {
  assert.equal(sanitizeSessionTitle("  Auth\nrefactor  "), "Authrefactor");
  assert.equal(sanitizeSessionTitle("\u200Ehi\u200F"), "hi");
  assert.equal(sanitizeSessionTitle("   "), "");
});

test("isSafeSessionId rejects path escape", () => {
  assert.equal(isSafeSessionId("019fa416-f756-7bc1-9c19-c2cbd75b85fd"), true);
  assert.equal(isSafeSessionId("../etc"), false);
  assert.equal(isSafeSessionId("a/b"), false);
  assert.equal(isSafeSessionId("short"), false);
});

test("renameSessionOnDisk pins generated_title and title_is_manual", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "grok-rename-"));
  const prev = process.env.GROK_HOME;
  process.env.GROK_HOME = home;
  try {
    const cwd = path.join(home, "proj");
    const sessionId = "sess-rename-01";
    writeSummary(home, cwd, sessionId, {
      info: { id: sessionId, cwd },
      session_summary: "Auto summary",
      generated_title: "Auto summary",
      title_is_manual: false,
      created_at: "2026-08-01T00:00:00Z",
      updated_at: "2026-08-01T00:00:00Z",
    });
    const { title } = renameSessionOnDisk(cwd, sessionId, "  Auth refactor  ");
    assert.equal(title, "Auth refactor");
    const listed = listSessionsForCwd(cwd);
    assert.equal(listed.length, 1);
    assert.equal(listed[0].title, "Auth refactor");
    assert.equal(listed[0].titleIsManual, true);
    const disk = JSON.parse(
      fs.readFileSync(
        path.join(
          home,
          "sessions",
          encodeSessionCwd(cwd),
          sessionId,
          "summary.json",
        ),
        "utf8",
      ),
    );
    assert.equal(disk.generated_title, "Auth refactor");
    assert.equal(disk.title_is_manual, true);
    assert.equal(disk.session_summary, "Auto summary");
  } finally {
    if (prev === undefined) delete process.env.GROK_HOME;
    else process.env.GROK_HOME = prev;
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("renameSessionOnDisk rejects blank and traversal", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "grok-rename-"));
  const prev = process.env.GROK_HOME;
  process.env.GROK_HOME = home;
  try {
    const cwd = path.join(home, "proj");
    assert.throws(() => renameSessionOnDisk(cwd, "sess-rename-01", "   "), {
      message: /blank/,
    });
    assert.throws(() => renameSessionOnDisk(cwd, "../escape-me", "Nope"), {
      message: /Invalid session id/,
    });
  } finally {
    if (prev === undefined) delete process.env.GROK_HOME;
    else process.env.GROK_HOME = prev;
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("deleteSessionOnDisk removes the session folder", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "grok-del-"));
  const prev = process.env.GROK_HOME;
  process.env.GROK_HOME = home;
  try {
    const cwd = path.join(home, "proj");
    const sessionId = "sess-delete-01";
    writeSummary(home, cwd, sessionId, {
      info: { id: sessionId, cwd },
      session_summary: "Gone",
    });
    assert.equal(listSessionsForCwd(cwd).length, 1);
    deleteSessionOnDisk(cwd, sessionId);
    assert.equal(listSessionsForCwd(cwd).length, 0);
    assert.throws(() => deleteSessionOnDisk(cwd, sessionId), {
      message: /not found/,
    });
    assert.throws(() => deleteSessionOnDisk(cwd, "../escape-me"), {
      message: /Invalid session id/,
    });
  } finally {
    if (prev === undefined) delete process.env.GROK_HOME;
    else process.env.GROK_HOME = prev;
    fs.rmSync(home, { recursive: true, force: true });
  }
});
