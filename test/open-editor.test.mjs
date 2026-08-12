/**
 * Open-in-editor planner — never hands files to the default browser.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import {
  listEditors,
  normalizeExternalEditor,
  planOpenInEditor,
  resolvePreferredEditor,
  whichBin,
} from "../electron/open-editor.mjs";

const HTML = "/tmp/project/index.html";
const MD = "/Users/dev/repo/README.md";

function existsSet(paths) {
  const set = new Set(paths);
  return (p) => set.has(p);
}

test("normalizeExternalEditor falls back to auto", () => {
  assert.equal(normalizeExternalEditor("cursor"), "cursor");
  assert.equal(normalizeExternalEditor("CODE"), "code");
  assert.equal(normalizeExternalEditor("brave"), "auto");
  assert.equal(normalizeExternalEditor(""), "auto");
  assert.equal(normalizeExternalEditor(null), "auto");
});

test("plan never uses bare open / xdg-open / the file as the command", () => {
  const plan = planOpenInEditor(HTML, {
    platform: "darwin",
    home: "/Users/dev",
    env: { PATH: "/usr/bin" },
    exists: () => false,
  });
  assert.equal(plan.ok, true);
  assert.notEqual(plan.cmd, HTML);
  assert.notEqual(plan.cmd, "xdg-open");
  // Last-resort on macOS is TextEdit via `open -e`, not `open file`.
  assert.equal(plan.cmd, "open");
  assert.ok(plan.args.includes("-e"));
  assert.ok(!plan.args.includes("-a") || plan.editor !== "textedit");
  assert.equal(plan.args[plan.args.length - 1], HTML);
});

test("html/md still go to a named editor when Cursor is installed", () => {
  const cursorCli =
    "/Applications/Cursor.app/Contents/Resources/app/bin/cursor";
  const plan = planOpenInEditor(MD, {
    platform: "darwin",
    home: "/Users/dev",
    env: { PATH: "/usr/bin" },
    exists: existsSet(["/Applications/Cursor.app", cursorCli]),
  });
  assert.equal(plan.ok, true);
  assert.equal(plan.editor, "cursor");
  assert.equal(plan.cmd, cursorCli);
  assert.deepEqual(plan.args, [MD]);
});

test("auto prefers VS Code when Cursor is missing", () => {
  const codeCli =
    "/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code";
  const plan = planOpenInEditor(HTML, {
    platform: "darwin",
    home: "/Users/dev",
    env: { PATH: "/usr/bin" },
    exists: existsSet([
      "/Applications/Visual Studio Code.app",
      codeCli,
    ]),
  });
  assert.equal(plan.ok, true);
  assert.equal(plan.editor, "code");
  assert.equal(plan.cmd, codeCli);
});

test("preference is honored when that editor exists", () => {
  const codeCli =
    "/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code";
  const cursorCli =
    "/Applications/Cursor.app/Contents/Resources/app/bin/cursor";
  const plan = planOpenInEditor(HTML, {
    preference: "code",
    platform: "darwin",
    home: "/Users/dev",
    env: { PATH: "/usr/bin" },
    exists: existsSet([
      "/Applications/Cursor.app",
      cursorCli,
      "/Applications/Visual Studio Code.app",
      codeCli,
    ]),
  });
  assert.equal(plan.ok, true);
  assert.equal(plan.editor, "code");
  assert.equal(plan.cmd, codeCli);
});

test("darwin app without CLI uses open -a, never bare open", () => {
  const plan = planOpenInEditor(HTML, {
    preference: "zed",
    platform: "darwin",
    home: "/Users/dev",
    env: { PATH: "/usr/bin" },
    exists: existsSet(["/Applications/Zed.app"]),
  });
  assert.equal(plan.ok, true);
  assert.equal(plan.editor, "zed");
  assert.equal(plan.cmd, "open");
  assert.deepEqual(plan.args, ["-a", "Zed", "--", HTML]);
});

test("win32 last resort is notepad, not the default app", () => {
  const plan = planOpenInEditor("C:\\\\proj\\\\page.html", {
    platform: "win32",
    home: "C:\\\\Users\\\\dev",
    env: { PATH: "C:\\\\Windows\\\\System32", LOCALAPPDATA: "C:\\\\Users\\\\dev\\\\AppData\\\\Local" },
    exists: () => false,
  });
  assert.equal(plan.ok, true);
  assert.equal(plan.editor, "notepad");
  assert.equal(plan.cmd, "notepad.exe");
});

test("linux with no editor returns a clear error (no xdg-open)", () => {
  const plan = planOpenInEditor(HTML, {
    platform: "linux",
    home: "/home/dev",
    env: { PATH: "/usr/bin" },
    exists: () => false,
  });
  assert.equal(plan.ok, false);
  assert.match(plan.error, /No code editor found/i);
});

test("linux uses code from PATH", () => {
  const plan = planOpenInEditor(HTML, {
    platform: "linux",
    home: "/home/dev",
    env: { PATH: "/usr/bin:/usr/local/bin" },
    exists: (p) => p === "/usr/local/bin/code",
  });
  assert.equal(plan.ok, true);
  assert.equal(plan.editor, "code");
  assert.equal(plan.cmd, "/usr/local/bin/code");
});

test("whichBin finds PATHEXT variants on Windows", () => {
  const found = whichBin("code", {
    platform: "win32",
    env: {
      PATH: "C:\\\\bin",
      PATHEXT: ".EXE;.CMD",
    },
    exists: (p) => p === path.join("C:\\\\bin", "code.CMD"),
  });
  assert.equal(found, path.join("C:\\\\bin", "code.CMD"));
});

test("listEditors marks last-resort system editors by platform", () => {
  const mac = listEditors({
    platform: "darwin",
    home: "/Users/dev",
    env: { PATH: "/usr/bin" },
    exists: () => false,
  });
  assert.ok(mac.some((e) => e.id === "textedit" && e.available));
  assert.ok(!mac.some((e) => e.id === "notepad"));

  const win = listEditors({
    platform: "win32",
    home: "C:\\\\Users\\\\dev",
    env: { PATH: "C:\\\\Windows", LOCALAPPDATA: "C:\\\\Users\\\\dev\\\\AppData\\\\Local" },
    exists: () => false,
  });
  assert.ok(win.some((e) => e.id === "notepad" && e.available));
  assert.ok(!win.some((e) => e.id === "textedit"));
});

test("resolvePreferredEditor auto is null on linux with nothing installed", () => {
  const resolved = resolvePreferredEditor("auto", {
    platform: "linux",
    home: "/home/dev",
    env: { PATH: "/usr/bin" },
    exists: () => false,
  });
  assert.equal(resolved, null);
});
