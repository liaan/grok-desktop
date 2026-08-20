/**
 * Worktree porcelain parse, path compare, and sibling-dir suggestions.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  addGitWorktree,
  parseWorktreePorcelain,
  parseWorktreePorcelainEntries,
  sameCheckoutPath,
  slugifyBranchForDir,
  suggestWorktreeDir,
} from "../electron/git-worktrees.mjs";
import { findOccupyingCheckout } from "../electron/checkout-occupancy.mjs";

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

test("parseWorktreePorcelainEntries: branch / detached", () => {
  const entries = parseWorktreePorcelainEntries(FIXTURE);
  assert.equal(entries.length, 3);
  assert.equal(entries[0].branch, "main");
  assert.equal(entries[0].detached, false);
  assert.equal(entries[1].branch, "feat/login");
  assert.equal(entries[2].detached, true);
  assert.equal(entries[2].branch, null);
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

test("findOccupyingCheckout skips the calling window", () => {
  const rows = [
    { windowId: 1, cwd: "/repos/app", title: "app · Grok" },
    { windowId: 2, cwd: "/repos/other", title: "other · Grok" },
  ];
  assert.equal(findOccupyingCheckout("/repos/app", rows, 1), null);
  const hit = findOccupyingCheckout("/repos/app", rows, 2);
  assert.ok(hit);
  assert.equal(hit.windowId, 1);
  assert.equal(findOccupyingCheckout("/repos/app-feat", rows, 2), null);
});

test("slugifyBranchForDir and suggestWorktreeDir", () => {
  assert.equal(slugifyBranchForDir("feat/login"), "feat-login");
  assert.equal(slugifyBranchForDir("  "), "work");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "grok-wt-sug-"));
  const main = path.join(tmp, "app");
  fs.mkdirSync(main);
  const first = suggestWorktreeDir(main, "feat/login");
  assert.equal(path.basename(first), "app-feat-login");
  fs.mkdirSync(first);
  const second = suggestWorktreeDir(main, "feat/login", [first]);
  assert.equal(path.basename(second), "app-feat-login-2");
});

function haveGit() {
  const r = spawnSync("git", ["--version"], {
    windowsHide: true,
    encoding: "utf8",
  });
  return r.status === 0;
}

test("addGitWorktree creates a sibling checkout on a new branch", async (t) => {
  if (!haveGit()) {
    t.skip("git not on PATH");
    return;
  }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "grok-wt-add-"));
  const repo = path.join(tmp, "app");
  fs.mkdirSync(repo);
  const git = (args) => {
    const r = spawnSync("git", args, {
      cwd: repo,
      encoding: "utf8",
      windowsHide: true,
    });
    assert.equal(r.status, 0, r.stderr || r.stdout);
    return r;
  };
  const inited = spawnSync("git", ["init", "-b", "main"], {
    cwd: repo,
    encoding: "utf8",
    windowsHide: true,
  });
  if (inited.status !== 0) git(["init"]);
  git(["config", "user.email", "wt@example.com"]);
  git(["config", "user.name", "Worktree Test"]);
  fs.writeFileSync(path.join(repo, "README.md"), "hi\n");
  git(["add", "README.md"]);
  git(["commit", "-m", "init"]);

  const added = addGitWorktree(repo, {
    dir: path.join(tmp, "app-feat-login"),
    branch: "feat/login",
  });
  assert.equal(added.createdBranch, true);
  assert.equal(added.branch, "feat/login");
  assert.ok(fs.existsSync(path.join(added.path, "README.md")));
  assert.ok(fs.existsSync(path.join(added.path, ".git")));

  assert.throws(
    () =>
      addGitWorktree(repo, {
        dir: path.join(tmp, "app-feat-login-again"),
        branch: "feat/login",
      }),
    /already checked out/,
  );
});
