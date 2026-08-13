/**
 * Open-in-editor planner — never hands files to the default browser.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import {
  listEditors,
  normalizeExternalEditor,
  openInEditor,
  planOpenInEditor,
  quoteWinCmdArg,
  resolvePreferredEditor,
  spawnArgsForPlan,
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

test("Cursor's code shim is not Visual Studio Code", () => {
  const cursorCli =
    "/Applications/Cursor.app/Contents/Resources/app/bin/cursor";
  const cursorCodeShim =
    "/Applications/Cursor.app/Contents/Resources/app/bin/code";
  const exists = existsSet([
    "/Applications/Cursor.app",
    cursorCli,
    cursorCodeShim,
  ]);
  const listed = listEditors({
    platform: "darwin",
    home: "/Users/dev",
    env: { PATH: "/usr/bin" },
    exists,
  });
  assert.equal(listed.find((e) => e.id === "cursor")?.available, true);
  assert.equal(listed.find((e) => e.id === "code")?.available, false);

  const asCode = planOpenInEditor(HTML, {
    preference: "code",
    platform: "darwin",
    home: "/Users/dev",
    env: { PATH: "/usr/bin" },
    exists,
  });
  assert.equal(asCode.ok, false);
  assert.match(asCode.error || "", /No code editor found/i);

  const asAuto = planOpenInEditor(HTML, {
    platform: "darwin",
    home: "/Users/dev",
    env: { PATH: "/usr/bin" },
    exists,
  });
  assert.equal(asAuto.ok, true);
  assert.equal(asAuto.editor, "cursor");
  assert.equal(asAuto.cmd, cursorCli);
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

test("quoteWinCmdArg quotes spaces, quotes, ampersands, and empties", () => {
  const cmd =
    "C:\\Users\\dev\\AppData\\Local\\Programs\\Microsoft VS Code\\bin\\code.cmd";
  const file = "C:\\proj\\my file.html";
  assert.equal(quoteWinCmdArg(cmd), `"${cmd}"`);
  assert.equal(quoteWinCmdArg(file), `"${file}"`);
  assert.equal(quoteWinCmdArg("notepad.exe"), "notepad.exe");
  assert.equal(quoteWinCmdArg(""), '""');
  assert.equal(quoteWinCmdArg('say "hi"'), `"say ""hi"""`);
  assert.equal(quoteWinCmdArg("C:\\a&b.txt"), `"C:\\a&b.txt"`);
  assert.equal(quoteWinCmdArg("notes%PATH%.md"), "notes%%PATH%%.md");
});

test("spawnArgsForPlan launches .cmd via cmd.exe /c call (no shell:true)", () => {
  const cmd =
    "C:\\Users\\dev\\AppData\\Local\\Programs\\Microsoft VS Code\\bin\\code.cmd";
  const file = "C:\\proj\\my file.html";
  const spawnSpec = spawnArgsForPlan({
    ok: true,
    cmd,
    args: [file],
    shell: true,
  });
  assert.equal(spawnSpec.shell, false);
  assert.equal(spawnSpec.cmd, "cmd.exe");
  assert.deepEqual(spawnSpec.args.slice(0, 3), ["/d", "/s", "/c"]);
  assert.match(spawnSpec.args[3], /^"call /);
  assert.ok(spawnSpec.args[3].endsWith('"'));
  assert.ok(spawnSpec.args[3].includes(`"${cmd}"`));
  assert.ok(spawnSpec.args[3].includes(`"${file}"`));
  assert.equal(spawnSpec.windowsVerbatimArguments, true);
});

test("win32 VS Code plan prefers Code.exe and does not need cmd.exe", () => {
  const local = "C:\\Users\\dev\\AppData\\Local";
  const exe = path.join(local, "Programs", "Microsoft VS Code", "Code.exe");
  const cmd = path.join(
    local,
    "Programs",
    "Microsoft VS Code",
    "bin",
    "code.cmd",
  );
  const plan = planOpenInEditor("C:\\proj\\page.html", {
    preference: "code",
    platform: "win32",
    home: "C:\\Users\\dev",
    env: {
      PATH: "C:\\Windows\\System32",
      LOCALAPPDATA: local,
    },
    exists: existsSet([exe, cmd]),
  });
  assert.equal(plan.ok, true);
  assert.equal(plan.editor, "code");
  assert.equal(plan.cmd, exe);
  assert.equal(plan.shell, false);
});

test("win32 code.cmd plan marks shell so spawn quoting applies", () => {
  const local = "C:\\Users\\dev\\AppData\\Local";
  const cmd = path.join(
    local,
    "Programs",
    "Microsoft VS Code",
    "bin",
    "code.cmd",
  );
  const file = "C:\\proj\\my file.html";
  const plan = planOpenInEditor(file, {
    preference: "code",
    platform: "win32",
    home: "C:\\Users\\dev",
    env: {
      PATH: "C:\\Windows\\System32",
      LOCALAPPDATA: local,
    },
    exists: existsSet([cmd]),
  });
  assert.equal(plan.ok, true);
  assert.equal(plan.cmd, cmd);
  assert.equal(plan.shell, true);
  const spawnSpec = spawnArgsForPlan(plan);
  assert.equal(spawnSpec.shell, false);
  assert.equal(spawnSpec.cmd, "cmd.exe");
  assert.match(spawnSpec.args[3], /^"call /);
  assert.ok(spawnSpec.args[3].includes(`"${cmd}"`));
  assert.ok(spawnSpec.args[3].includes(`"${file}"`));
  assert.equal(spawnSpec.windowsVerbatimArguments, true);
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

test("PATH walk skips other-editor install then finds later VS Code", () => {
  const cursorCli =
    "/Applications/Cursor.app/Contents/Resources/app/bin/cursor";
  const cursorCode =
    "/Applications/Cursor.app/Contents/Resources/app/bin/code";
  const realCode = "/usr/bin/code";
  const exists = existsSet([
    "/Applications/Cursor.app",
    cursorCli,
    cursorCode,
    realCode,
  ]);
  const listed = listEditors({
    platform: "darwin",
    home: "/Users/dev",
    env: {
      PATH: "/Applications/Cursor.app/Contents/Resources/app/bin:/usr/bin",
    },
    exists,
  });
  assert.equal(listed.find((e) => e.id === "code")?.available, true);
  const plan = planOpenInEditor(HTML, {
    preference: "code",
    platform: "darwin",
    home: "/Users/dev",
    env: {
      PATH: "/Applications/Cursor.app/Contents/Resources/app/bin:/usr/bin",
    },
    exists,
  });
  assert.equal(plan.ok, true);
  assert.equal(plan.editor, "code");
  assert.equal(plan.cmd, realCode);
});

test("linux ~/.local/bin/code next to cursor is not VS Code", () => {
  const cursorCode = "/home/dev/.local/bin/code";
  const cursorBin = "/home/dev/.local/bin/cursor";
  const exists = existsSet([cursorCode, cursorBin]);
  const listed = listEditors({
    platform: "linux",
    home: "/home/dev",
    env: { PATH: "/home/dev/.local/bin:/usr/bin" },
    exists,
  });
  assert.equal(listed.find((e) => e.id === "code")?.available, false);
  const asCode = planOpenInEditor(HTML, {
    preference: "code",
    platform: "linux",
    home: "/home/dev",
    env: { PATH: "/home/dev/.local/bin:/usr/bin" },
    exists,
  });
  assert.equal(asCode.ok, false);
  const asAuto = planOpenInEditor(HTML, {
    platform: "linux",
    home: "/home/dev",
    env: { PATH: "/home/dev/.local/bin:/usr/bin" },
    exists,
  });
  assert.equal(asAuto.ok, true);
  assert.equal(asAuto.editor, "cursor");
});

test("linux /usr/bin/code next to /usr/bin/cursor are both available", () => {
  const exists = existsSet(["/usr/bin/code", "/usr/bin/cursor"]);
  const listed = listEditors({
    platform: "linux",
    home: "/home/dev",
    env: { PATH: "/usr/bin" },
    exists,
  });
  assert.equal(listed.find((e) => e.id === "code")?.available, true);
  assert.equal(listed.find((e) => e.id === "cursor")?.available, true);
  const plan = planOpenInEditor(HTML, {
    preference: "code",
    platform: "linux",
    home: "/home/dev",
    env: { PATH: "/usr/bin" },
    exists,
  });
  assert.equal(plan.ok, true);
  assert.equal(plan.editor, "code");
  assert.equal(plan.cmd, "/usr/bin/code");
});

test("PATH code inside Cursor.app is not Visual Studio Code", () => {
  const cursorCli =
    "/Applications/Cursor.app/Contents/Resources/app/bin/cursor";
  const cursorCode =
    "/Applications/Cursor.app/Contents/Resources/app/bin/code";
  const exists = existsSet([
    "/Applications/Cursor.app",
    cursorCli,
    cursorCode,
  ]);
  const listed = listEditors({
    platform: "darwin",
    home: "/Users/dev",
    env: {
      PATH: "/Applications/Cursor.app/Contents/Resources/app/bin:/usr/bin",
    },
    exists,
  });
  assert.equal(listed.find((e) => e.id === "cursor")?.available, true);
  assert.equal(listed.find((e) => e.id === "code")?.available, false);
  const asCode = planOpenInEditor(HTML, {
    preference: "code",
    platform: "darwin",
    home: "/Users/dev",
    env: {
      PATH: "/Applications/Cursor.app/Contents/Resources/app/bin:/usr/bin",
    },
    exists,
  });
  assert.equal(asCode.ok, false);
});

test("win32 Program Files VS Code is found beside user-level Cursor", () => {
  const local = "C:\\Users\\dev\\AppData\\Local";
  const pf = "C:\\Program Files";
  const cursorExe = path.join(local, "Programs", "cursor", "Cursor.exe");
  const codeExe = path.join(pf, "Microsoft VS Code", "Code.exe");
  const exists = existsSet([cursorExe, codeExe]);
  const listed = listEditors({
    platform: "win32",
    home: "C:\\Users\\dev",
    env: {
      PATH: "C:\\Windows\\System32",
      LOCALAPPDATA: local,
      PROGRAMFILES: pf,
    },
    exists,
  });
  assert.equal(listed.find((e) => e.id === "code")?.available, true);
  const plan = planOpenInEditor("C:\\proj\\page.html", {
    preference: "code",
    platform: "win32",
    home: "C:\\Users\\dev",
    env: {
      PATH: "C:\\Windows\\System32",
      LOCALAPPDATA: local,
      PROGRAMFILES: pf,
    },
    exists,
  });
  assert.equal(plan.ok, true);
  assert.equal(plan.editor, "code");
  assert.equal(plan.cmd, codeExe);
  assert.equal(plan.shell, false);
});

test("win32 Cursor-only does not advertise or launch VS Code", () => {
  const local = "C:\\Users\\dev\\AppData\\Local";
  const cursorExe = path.join(local, "Programs", "cursor", "Cursor.exe");
  const cursorCmd = path.join(
    local,
    "Programs",
    "cursor",
    "resources",
    "app",
    "bin",
    "cursor.cmd",
  );
  const cursorCodeCmd = path.join(
    local,
    "Programs",
    "cursor",
    "resources",
    "app",
    "bin",
    "code.cmd",
  );
  const exists = existsSet([cursorExe, cursorCmd, cursorCodeCmd]);
  const listed = listEditors({
    platform: "win32",
    home: "C:\\Users\\dev",
    env: { PATH: "C:\\Windows\\System32", LOCALAPPDATA: local },
    exists,
  });
  assert.equal(listed.find((e) => e.id === "cursor")?.available, true);
  assert.equal(listed.find((e) => e.id === "code")?.available, false);
  const asCode = planOpenInEditor("C:\\proj\\page.html", {
    preference: "code",
    platform: "win32",
    home: "C:\\Users\\dev",
    env: { PATH: "C:\\Windows\\System32", LOCALAPPDATA: local },
    exists,
  });
  assert.equal(asCode.ok, false);
  const asAuto = planOpenInEditor("C:\\proj\\page.html", {
    platform: "win32",
    home: "C:\\Users\\dev",
    env: { PATH: "C:\\Windows\\System32", LOCALAPPDATA: local },
    exists,
  });
  assert.equal(asAuto.ok, true);
  assert.equal(asAuto.editor, "cursor");
  assert.equal(asAuto.cmd, cursorExe);
  assert.notEqual(asAuto.shell, true);
});

test("planOpenInEditor rejects empty path", () => {
  const plan = planOpenInEditor("  ", {
    platform: "linux",
    home: "/home/dev",
    env: { PATH: "/usr/bin" },
    exists: () => false,
  });
  assert.equal(plan.ok, false);
  assert.match(plan.error, /No file path/i);
});

test("openInEditor rejects when no editor is installed", async () => {
  await assert.rejects(
    () =>
      openInEditor(HTML, {
        platform: "linux",
        home: "/home/dev",
        env: { PATH: "/usr/bin" },
        exists: () => false,
      }),
    /No code editor found/i,
  );
});

test("openInEditor rejects when spawn fails", async () => {
  await assert.rejects(
    () =>
      openInEditor(HTML, {
        platform: "linux",
        home: "/home/dev",
        env: { PATH: "/usr/bin" },
        exists: (p) => p === "/usr/bin/code",
        spawn: () => {
          const err = new Error("ENOENT");
          return {
            once(ev, cb) {
              if (ev === "error") queueMicrotask(() => cb(err));
            },
            unref() {},
          };
        },
      }),
    /ENOENT/,
  );
});

test("openInEditor spawn for .cmd uses quoted cmd.exe /c call", async () => {
  const local = "C:\\Users\\dev\\AppData\\Local";
  const cmd = path.join(
    local,
    "Programs",
    "Microsoft VS Code",
    "bin",
    "code.cmd",
  );
  const file = "C:\\proj\\my file.html";
  /** @type {{ cmd: string, args: string[], opts: Record<string, unknown> } | null} */
  let seen = null;
  const fakeSpawn = (c, a, o) => {
    seen = { cmd: c, args: a, opts: o };
    return { once() {}, unref() {} };
  };
  await openInEditor(file, {
    preference: "code",
    platform: "win32",
    home: "C:\\Users\\dev",
    env: {
      PATH: "C:\\Windows\\System32",
      LOCALAPPDATA: local,
    },
    exists: existsSet([cmd]),
    spawn: fakeSpawn,
  });
  assert.ok(seen);
  assert.equal(seen.cmd, "cmd.exe");
  assert.equal(seen.opts.shell, false);
  assert.equal(seen.opts.windowsVerbatimArguments, true);
  assert.match(seen.args[3], /^"call /);
  assert.ok(seen.args[3].includes(`"${cmd}"`));
  assert.ok(seen.args[3].includes(`"${file}"`));
});
