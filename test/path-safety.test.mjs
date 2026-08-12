/**
 * Project gate + GROK_HOME allowlist for ACP agent tools.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  assertPathInProject,
  assertPathInProjectOrGrokHome,
  isUnderGrokHome,
  resolveProjectPath,
  grokHomeRoots,
} from "../electron/path-safety.mjs";
import { grokHomeDir } from "../electron/grok-home.mjs";

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "grok-desktop-path-"));
const project = path.join(tmpRoot, "project");
fs.mkdirSync(project, { recursive: true });
fs.writeFileSync(path.join(project, "ok.txt"), "hi");

test("assertPathInProject allows files under project", () => {
  const p = assertPathInProject(project, "ok.txt");
  assert.equal(p, path.join(project, "ok.txt"));
});

test("assertPathInProject rejects sibling paths", () => {
  assert.throws(
    () => assertPathInProject(project, path.join(tmpRoot, "outside.txt")),
    /outside the open project/,
  );
});

test("assertPathInProject rejects symlink to an outside file", () => {
  const outside = path.join(tmpRoot, "secret.txt");
  const link = path.join(project, "escape");
  fs.writeFileSync(outside, "nope");
  try {
    fs.symlinkSync(outside, link);
  } catch (err) {
    if (/** @type {NodeJS.ErrnoException} */ (err).code === "EPERM") return;
    throw err;
  }
  try {
    assert.throws(() => assertPathInProject(project, "escape"), /outside/);
  } finally {
    try {
      fs.unlinkSync(link);
      fs.unlinkSync(outside);
    } catch {
      /* ignore */
    }
  }
});

test("assertPathInProject allows an in-project symlink", () => {
  const link = path.join(project, "alias.txt");
  try {
    fs.symlinkSync(path.join(project, "ok.txt"), link);
  } catch (err) {
    if (/** @type {NodeJS.ErrnoException} */ (err).code === "EPERM") return;
    throw err;
  }
  try {
    assert.equal(assertPathInProject(project, "alias.txt"), link);
  } finally {
    try {
      fs.unlinkSync(link);
    } catch {
      /* ignore */
    }
  }
});

test("resolveProjectPath allowGrokHome allows GROK_HOME paths", () => {
  const home = path.resolve(grokHomeDir());
  const skill = path.join(home, "skills", "example", "SKILL.md");
  const resolved = resolveProjectPath(project, skill, { allowGrokHome: true });
  assert.equal(resolved, path.resolve(skill));
  assert.equal(isUnderGrokHome(skill), true);
});

test("resolveProjectPath without allowGrokHome rejects GROK_HOME", () => {
  const home = path.resolve(grokHomeDir());
  const skill = path.join(home, "skills", "example", "SKILL.md");
  assert.throws(
    () => resolveProjectPath(project, skill, { allowGrokHome: false }),
    /outside the open project/,
  );
});

test("assertPathInProjectOrGrokHome accepts both roots", () => {
  const inProject = assertPathInProjectOrGrokHome(project, "ok.txt");
  assert.equal(inProject, path.join(project, "ok.txt"));

  const home = path.resolve(grokHomeDir());
  const inHome = assertPathInProjectOrGrokHome(
    project,
    path.join(home, "config.toml"),
  );
  assert.equal(inHome, path.join(home, "config.toml"));
});

test("assertPathInProjectOrGrokHome rejects unrelated host paths", () => {
  assert.throws(
    () =>
      assertPathInProjectOrGrokHome(
        project,
        path.join(tmpRoot, "not-project-not-grok.txt"),
      ),
    /outside the open project and GROK_HOME/,
  );
});

test("grokHomeRoots includes resolved GROK_HOME", () => {
  const roots = grokHomeRoots();
  assert.ok(roots.length >= 1);
  assert.ok(roots.some((r) => path.resolve(r) === path.resolve(grokHomeDir())));
});

test("buildSeatbeltProfile exempts GROK_HOME from home deny", async () => {
  const { buildSeatbeltProfile, sandboxGrokHome } = await import(
    "../electron/terminal-sandbox.mjs"
  );
  const profile = buildSeatbeltProfile({ projectRoot: project });
  const gh = sandboxGrokHome().replace(/\\/g, "\\\\");
  assert.match(profile, /require-not \(subpath "/);
  assert.ok(
    profile.includes(gh) || profile.includes(sandboxGrokHome().replace(/\\/g, "/")),
    "seatbelt profile should mention GROK_HOME",
  );
});
