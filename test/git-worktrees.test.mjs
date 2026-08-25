/**
 * Worktree porcelain parse, path compare, linked-root list.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  checkoutKey,
  clearWorktreeRootCache,
  listLinkedWorktreeRoots,
  parseWorktreePorcelain,
  sameCheckoutPath,
} from "../electron/git-worktrees.mjs";

const FIXTURE = [
  "worktree /repos/app",
  "HEAD abcdef1234567890",
  "branch refs/heads/main",
  "",
  "worktree /repos/app-feat",
  "HEAD fedcba0987654321",
  "branch refs/heads/feat/login",
  "",
  "worktree /repos/app-hotfix",
  "HEAD 1111111111111111",
  "detached",
  "",
].join("\n");

test("parseWorktreePorcelain: paths only, order preserved", () => {
  const roots = parseWorktreePorcelain(FIXTURE);
  assert.deepEqual(
    roots.map((p) => path.basename(p)),
    ["app", "app-feat", "app-hotfix"],
  );
});

test("checkoutKey matches sameCheckoutPath identity", () => {
  if (process.platform === "win32") {
    assert.equal(checkoutKey("C:\\Repos\\App\\"), checkoutKey("c:/repos/app"));
  } else {
    assert.equal(checkoutKey("/repos/app/"), checkoutKey("/repos/app"));
    assert.notEqual(checkoutKey("/repos/app"), checkoutKey("/repos/App"));
  }
});

test("sameCheckoutPath folds Windows case and trailing sep", () => {
  if (process.platform === "win32") {
    assert.equal(
      sameCheckoutPath("C:\\Repos\\App\\", "c:/repos/app"),
      true,
    );
  } else {
    assert.equal(sameCheckoutPath("/repos/app/", "/repos/app"), true);
    assert.equal(sameCheckoutPath("/repos/app", "/repos/App"), false);
  }
  assert.equal(sameCheckoutPath("/repos/app", "/repos/app-feat"), false);
  assert.equal(sameCheckoutPath("", "/repos/app"), false);
});

function haveGit() {
  const r = spawnSync("git", ["--version"], {
    windowsHide: true,
    encoding: "utf8",
  });
  return r.status === 0;
}

function git(cwd, args) {
  const r = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    windowsHide: true,
  });
  assert.equal(r.status, 0, r.stderr || r.stdout);
  return r;
}

function initRepo(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const inited = spawnSync("git", ["init", "-b", "main"], {
    cwd: dir,
    encoding: "utf8",
    windowsHide: true,
  });
  if (inited.status !== 0) git(dir, ["init"]);
  git(dir, ["config", "user.email", "wt@example.com"]);
  git(dir, ["config", "user.name", "Worktree Test"]);
  fs.writeFileSync(path.join(dir, "README.md"), "hi\n");
  git(dir, ["add", "README.md"]);
  git(dir, ["commit", "-m", "init"]);
}

test("listLinkedWorktreeRoots includes git worktree add paths", async (t) => {
  if (!haveGit()) {
    t.skip("git not on PATH");
    return;
  }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "grok-wt-link-"));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const repo = path.join(tmp, "app");
  const sibling = path.join(tmp, "app-feat");
  initRepo(repo);
  git(repo, ["worktree", "add", "-b", "feat/login", sibling]);

  clearWorktreeRootCache(repo);
  const roots = listLinkedWorktreeRoots(repo, { refresh: true });
  assert.ok(roots.some((r) => sameCheckoutPath(r, repo)));
  assert.ok(roots.some((r) => sameCheckoutPath(r, sibling)));
});

test("standalone clone is not a linked git worktree", async (t) => {
  if (!haveGit()) {
    t.skip("git not on PATH");
    return;
  }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "grok-wt-copy-"));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const repo = path.join(tmp, "app");
  const copy = path.join(tmp, "standalone");
  initRepo(repo);
  fs.cpSync(repo, copy, { recursive: true });

  clearWorktreeRootCache(repo);
  const roots = listLinkedWorktreeRoots(repo, { refresh: true });
  assert.ok(roots.some((r) => sameCheckoutPath(r, repo)));
  assert.equal(
    roots.some((r) => sameCheckoutPath(r, copy)),
    false,
    "Grok-style standalone copies must not appear in porcelain",
  );
  const copyList = listLinkedWorktreeRoots(copy, { refresh: true });
  assert.equal(
    copyList.some((r) => sameCheckoutPath(r, repo)),
    false,
  );
});
