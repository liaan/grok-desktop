/**
 * ACP worktree family map + single-instance helpers.
 */
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  assertPathInProject,
  resolveProjectPath,
  setExtraAllowedRootsFor,
} from "../electron/path-safety.mjs";
import { sameCheckoutPath } from "../electron/git-worktrees.mjs";
import {
  agentForWorktreeRpc,
  clearWorktreeFamilies,
  commitFamilyAfterOpen,
  commitProjectOpenFamily,
  configureDesktopInstance,
  createAcpWorktree,
  DESKTOP_APP_USER_MODEL_ID,
  extraAllowedRootsFor,
  isGrokAcpWorktreePath,
  isPrimaryDesktopInstance,
  shouldAutoTrustFolder,
  isTooBroadRoot,
  listAcpWorktrees,
  listAndRegisterAcpWorktrees,
  MARKER_MAX_BYTES,
  occupancyConflict,
  planProjectOpen,
  readGrokWorktreeSource,
  registerCreatedWorktree,
  registerValidatedFamily,
  registerWorktreeFamily,
  resolveWorktreeCreateCwd,
  wireSecondInstance,
  wireWorktreePathGate,
} from "../electron/desktop-worktrees.mjs";

beforeEach(() => {
  clearWorktreeFamilies();
  setExtraAllowedRootsFor(() => []);
});

afterEach(() => {
  clearWorktreeFamilies();
  setExtraAllowedRootsFor(() => []);
});

function tmpDir(t, prefix = "grok-wt-") {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });
  return dir;
}

function isolateGrokHome(t) {
  const home = tmpDir(t, "grok-home-");
  const prev = process.env.GROK_HOME;
  process.env.GROK_HOME = home;
  t.after(() => {
    if (prev === undefined) delete process.env.GROK_HOME;
    else process.env.GROK_HOME = prev;
  });
  return home;
}

function gitMarker(dir) {
  fs.mkdirSync(path.join(dir, ".git"), { recursive: true });
}

function acpWorktree(t, grokHome, name) {
  const wt = path.join(grokHome, "worktrees", name);
  fs.mkdirSync(wt, { recursive: true });
  gitMarker(wt);
  return wt;
}

function assertFamily(members) {
  for (const from of members) {
    const roots = extraAllowedRootsFor(from);
    assert.equal(roots.length, members.length);
    for (const m of members) {
      assert.ok(
        roots.some((p) => sameCheckoutPath(p, m)),
        `missing ${m} when querying ${from}`,
      );
    }
  }
}

function haveGit() {
  const r = spawnSync("git", ["--version"], {
    windowsHide: true,
    encoding: "utf8",
  });
  return r.status === 0;
}

test("registerWorktreeFamily requires both paths", () => {
  registerWorktreeFamily("/wt", "");
  registerWorktreeFamily("", "/src");
  assert.deepEqual(extraAllowedRootsFor("/src"), []);
  assert.deepEqual(extraAllowedRootsFor("/wt"), []);
});

test("registerWorktreeFamily unions source + worktree", (t) => {
  const src = tmpDir(t, "grok-fam-src-");
  const wt = tmpDir(t, "grok-fam-wt-");
  registerWorktreeFamily(wt, src);
  assertFamily([src, wt]);
});

test("family merge joins two pre-existing families via a shared path", (t) => {
  const a = tmpDir(t, "grok-fam-a-");
  const b = tmpDir(t, "grok-fam-b-");
  const c = tmpDir(t, "grok-fam-c-");
  const d = tmpDir(t, "grok-fam-d-");
  registerWorktreeFamily(b, a);
  registerWorktreeFamily(d, c);
  registerWorktreeFamily(c, b);
  assertFamily([a, b, c, d]);
});

test("listAcpWorktrees omits absolute repo and filters client-side", async (t) => {
  const home = isolateGrokHome(t);
  const src = tmpDir(t, "grok-acp-src-");
  gitMarker(src);
  const wt = acpWorktree(t, home, "wt-ok");
  const other = acpWorktree(t, home, "wt-other");
  const otherSrc = tmpDir(t, "grok-acp-other-");
  gitMarker(otherSrc);
  /** @type {object | undefined} */
  let seen;
  const rows = await listAcpWorktrees(
    {
      listWorktrees: async (opts) => {
        seen = opts;
        return [
          { path: wt, sourceRepo: src },
          { path: other, sourceRepo: otherSrc },
        ];
      },
    },
    src,
  );
  assert.equal(seen?.repo, undefined);
  assert.equal(seen?.includeAll, true);
  assert.equal(rows.length, 1);
  assert.ok(sameCheckoutPath(rows[0].path, wt));
});

test("listAndRegisterAcpWorktrees skips rows without sourceRepo", async (t) => {
  const home = isolateGrokHome(t);
  const src = tmpDir(t, "grok-acp-src-");
  gitMarker(src);
  const wt = acpWorktree(t, home, "wt-ok");
  const orphan = acpWorktree(t, home, "wt-orphan");
  const rows = await listAndRegisterAcpWorktrees(
    {
      listWorktrees: async () => [
        { path: wt, sourceRepo: src },
        { path: orphan },
      ],
    },
    src,
  );
  assert.equal(rows.length, 1);
  assertFamily([src, wt]);
  assert.equal(extraAllowedRootsFor(orphan).length, 0);
});

test("listAndRegister does not fall back to cwd as sourceRepo", async (t) => {
  const home = isolateGrokHome(t);
  const cwd = tmpDir(t, "grok-acp-cwd-");
  gitMarker(cwd);
  const wt = acpWorktree(t, home, "wt-nonsrc");
  await listAndRegisterAcpWorktrees(
    { listWorktrees: async () => [{ path: wt }] },
    cwd,
  );
  assert.deepEqual(extraAllowedRootsFor(cwd), []);
  assert.deepEqual(extraAllowedRootsFor(wt), []);
});

test("listAndRegister drops $HOME as a worktree path before validation", async (t) => {
  const home = isolateGrokHome(t);
  const src = tmpDir(t, "grok-acp-src-");
  gitMarker(src);
  const wt = acpWorktree(t, home, "wt-ok");
  const rows = await listAndRegisterAcpWorktrees(
    {
      listWorktrees: async () => [
        { path: os.homedir(), sourceRepo: src },
        { path: wt, sourceRepo: src },
      ],
    },
    src,
  );
  assert.equal(rows.length, 1);
  assertFamily([src, wt]);
});

test("registerValidatedFamily refuses too-broad source that survived list filter", async (t) => {
  const home = isolateGrokHome(t);
  const src = tmpDir(t, "grok-acp-src-");
  gitMarker(src);
  const wt = acpWorktree(t, home, "wt-ok");
  assert.equal(registerValidatedFamily(wt, os.homedir(), wt), false);
  assert.equal(registerValidatedFamily(wt, path.parse(os.homedir()).root, wt), false);
  await listAndRegisterAcpWorktrees(
    {
      listWorktrees: async () => [{ path: wt, sourceRepo: os.homedir() }],
    },
    wt,
  );
  assert.equal(extraAllowedRootsFor(wt).length, 0);
  assert.equal(extraAllowedRootsFor(src).length, 0);
});

test("isTooBroadRoot / isGrokAcpWorktreePath allowlist", (t) => {
  const home = isolateGrokHome(t);
  const src = tmpDir(t, "grok-allow-src-");
  gitMarker(src);
  const wt = acpWorktree(t, home, "wt-allow");
  assert.equal(isTooBroadRoot(os.homedir()), true);
  assert.equal(isTooBroadRoot(path.parse(os.homedir()).root), true);
  assert.equal(isTooBroadRoot(src), false);
  assert.equal(isGrokAcpWorktreePath(wt), true);
  assert.equal(isGrokAcpWorktreePath(src), false);
  assert.equal(isGrokAcpWorktreePath(path.join(home, "worktrees")), false);
  assert.equal(shouldAutoTrustFolder(wt), true);
  assert.equal(shouldAutoTrustFolder(src), false);
  assert.equal(shouldAutoTrustFolder(src, wt), true);
});

test("registerValidatedFamily live cwd is the ACP worktree", (t) => {
  const home = isolateGrokHome(t);
  const src = tmpDir(t, "grok-live-src-");
  gitMarker(src);
  const wt = acpWorktree(t, home, "wt-live");
  const other = tmpDir(t, "grok-live-other-");
  gitMarker(other);
  assert.equal(registerValidatedFamily(wt, src, wt), true);
  assertFamily([src, wt]);
  clearWorktreeFamilies();
  assert.equal(registerValidatedFamily(wt, src, other), false);
  assert.equal(extraAllowedRootsFor(wt).length, 0);
});

test("listAcpWorktrees null agent / throw / non-array", async (t) => {
  const src = tmpDir(t, "grok-list-");
  gitMarker(src);
  assert.deepEqual(await listAcpWorktrees(null, src), []);
  assert.deepEqual(
    await listAcpWorktrees(
      { listWorktrees: async () => { throw new Error("nope"); } },
      src,
    ),
    [],
  );
  assert.deepEqual(
    await listAcpWorktrees({ listWorktrees: async () => ({ worktrees: [] }) }, src),
    [],
  );
});

test("readGrokWorktreeSource happy path with trailing newline", (t) => {
  const home = isolateGrokHome(t);
  const src = tmpDir(t, "grok-src-disk-");
  gitMarker(src);
  const wt = acpWorktree(t, home, "wt-disk");
  fs.writeFileSync(path.join(wt, ".git", "grok-worktree-source"), `${src}\n`);
  assert.ok(sameCheckoutPath(readGrokWorktreeSource(wt), src));
});

test("readGrokWorktreeSource null cases", (t) => {
  const home = isolateGrokHome(t);
  const src = tmpDir(t, "grok-src-null-");
  gitMarker(src);
  const wt = acpWorktree(t, home, "wt-null");
  const marker = path.join(wt, ".git", "grok-worktree-source");
  assert.equal(readGrokWorktreeSource(wt), null);
  fs.mkdirSync(marker);
  assert.equal(readGrokWorktreeSource(wt), null);
  fs.rmSync(marker, { recursive: true });
  fs.writeFileSync(marker, "");
  assert.equal(readGrokWorktreeSource(wt), null);
  fs.writeFileSync(marker, "relative/path");
  assert.equal(readGrokWorktreeSource(wt), null);
  fs.writeFileSync(marker, wt);
  assert.equal(readGrokWorktreeSource(wt), null);
  const noGit = tmpDir(t, "grok-nogit-");
  fs.writeFileSync(marker, noGit);
  assert.equal(readGrokWorktreeSource(wt), null);
  fs.writeFileSync(marker, os.homedir());
  assert.equal(readGrokWorktreeSource(wt), null);
  fs.writeFileSync(marker, Buffer.alloc(MARKER_MAX_BYTES + 1, 0x61));
  assert.equal(readGrokWorktreeSource(wt), null);
});

test("readGrokWorktreeSource ignores a marker outside ~/.grok/worktrees", (t) => {
  const src = tmpDir(t, "grok-src-out-");
  gitMarker(src);
  const other = tmpDir(t, "grok-other-git-");
  gitMarker(other);
  fs.writeFileSync(path.join(other, ".git", "grok-worktree-source"), src);
  assert.equal(readGrokWorktreeSource(other), null);
});

test("listAndRegister does not register disk marker into the family map", async (t) => {
  const home = isolateGrokHome(t);
  const src = tmpDir(t, "grok-src-mark-");
  gitMarker(src);
  const wt = acpWorktree(t, home, "wt-mark");
  fs.writeFileSync(path.join(wt, ".git", "grok-worktree-source"), src);
  await listAndRegisterAcpWorktrees({ listWorktrees: async () => [] }, wt);
  assert.equal(extraAllowedRootsFor(wt).length, 0);
  assert.ok(sameCheckoutPath(readGrokWorktreeSource(wt), src));
});

test("wired family extra roots are ACP-only", (t) => {
  const home = isolateGrokHome(t);
  const source = tmpDir(t, "grok-gate-src-");
  gitMarker(source);
  fs.writeFileSync(path.join(source, "app.js"), "ok");
  const wt = acpWorktree(t, home, "wt-gate");
  fs.writeFileSync(path.join(wt, "x.txt"), "x");
  registerWorktreeFamily(wt, source);
  wireWorktreePathGate();
  assert.throws(
    () => assertPathInProject(source, path.join(wt, "x.txt")),
    /outside the open project/,
  );
  const fromSrc = resolveProjectPath(source, path.join(wt, "x.txt"), {
    allowGrokHome: true,
  });
  assert.ok(sameCheckoutPath(fromSrc, path.join(wt, "x.txt")));
  const fromWt = resolveProjectPath(wt, path.join(source, "app.js"), {
    allowGrokHome: true,
  });
  assert.ok(sameCheckoutPath(fromWt, path.join(source, "app.js")));
});

test("registerCreatedWorktree with distinct sourceGitRoot only pairs live cwd", (t) => {
  const home = isolateGrokHome(t);
  const src = tmpDir(t, "grok-cr-src-");
  gitMarker(src);
  const other = tmpDir(t, "grok-cr-other-");
  gitMarker(other);
  const wt = acpWorktree(t, home, "wt-cr");
  registerCreatedWorktree({ path: wt, sourceGitRoot: other }, src);
  assertFamily([src, wt]);
  assert.equal(extraAllowedRootsFor(other).length, 0);
});

test("createAcpWorktree requires a live agent", async () => {
  await assert.rejects(
    () => createAcpWorktree(null, { sourceCwd: "/repo" }),
    /Need a live Grok session/,
  );
});

test("createAcpWorktree rejects empty sourceCwd", async () => {
  await assert.rejects(
    () =>
      createAcpWorktree(
        { createWorktreeFromCurrent: async () => ({ path: "/x" }) },
        { sourceCwd: "" },
      ),
    /Open a project first/,
  );
});

test("createAcpWorktree records args and registers path-only result", async (t) => {
  const home = isolateGrokHome(t);
  const src = tmpDir(t, "grok-mk-src-");
  gitMarker(src);
  const wt = acpWorktree(t, home, "wt-mk");
  /** @type {object | undefined} */
  let seen;
  const created = await createAcpWorktree(
    {
      createWorktreeFromCurrent: async (opts) => {
        seen = opts;
        return { path: wt };
      },
    },
    { sourceCwd: src, label: "fix" },
  );
  assert.equal(seen?.sourceCwd, src);
  assert.equal(seen?.label, "fix");
  assert.ok(sameCheckoutPath(created.path, wt));
  assertFamily([src, wt]);
});

test("createAcpWorktree refuses a path outside ~/.grok/worktrees", async (t) => {
  const src = tmpDir(t, "grok-mk-src-");
  gitMarker(src);
  const outside = tmpDir(t, "grok-mk-out-");
  gitMarker(outside);
  await assert.rejects(
    () =>
      createAcpWorktree(
        { createWorktreeFromCurrent: async () => ({ path: outside }) },
        { sourceCwd: src },
      ),
    /outside ~\/\.grok\/worktrees/,
  );
});

test("planProjectOpen occupied vs allowSameCheckout still lists then commit registers", async (t) => {
  const home = isolateGrokHome(t);
  const src = tmpDir(t, "grok-plan-src-");
  gitMarker(src);
  const wt = acpWorktree(t, home, "wt-plan");
  const agent = {
    listWorktrees: async () => [{ path: wt, sourceRepo: src }],
  };
  const occupied = await planProjectOpen(src, {
    agent,
    openRows: [{ windowId: 1, cwd: src, title: "app" }],
    excludeWindowId: 2,
  });
  assert.ok(occupied.conflict);
  assert.equal(occupied.conflict.conflict, "checkout-open");
  assert.equal(occupied.conflict.occupancy.windowId, 1);
  assert.ok(sameCheckoutPath(occupied.conflict.occupancy.cwd, src));
  assert.equal(occupied.conflict.occupancy.title, "app");
  assert.equal("branch" in occupied.conflict.occupancy, true);
  assert.equal("detached" in occupied.conflict.occupancy, true);
  assert.equal(occupied.acpWorktrees.length, 1);
  assert.equal(extraAllowedRootsFor(src).length, 0);

  const allowed = await planProjectOpen(src, {
    agent,
    allowSameCheckout: true,
    openRows: [{ windowId: 1, cwd: src, title: "app" }],
    excludeWindowId: 2,
  });
  assert.equal(allowed.conflict, null);
  assert.equal(allowed.acpWorktrees.length, 1);
  assert.equal(extraAllowedRootsFor(src).length, 0);
  commitProjectOpenFamily(src, allowed.acpWorktrees);
  assertFamily([src, wt]);
});

test("occupancyConflict free checkout and empty cwd are null", async (t) => {
  const cwd = tmpDir(t, "grok-occ-free-");
  assert.equal(
    await occupancyConflict(cwd, {
      agent: { listWorktrees: async () => [] },
      openRows: [],
    }),
    null,
  );
  assert.equal(await occupancyConflict(""), null);
});

test("occupancyConflict inspect does not register family", async (t) => {
  const home = isolateGrokHome(t);
  const src = tmpDir(t, "grok-occ-src-");
  gitMarker(src);
  const wt = acpWorktree(t, home, "wt-occ");
  const conflict = await occupancyConflict(src, {
    agent: { listWorktrees: async () => [{ path: wt, sourceRepo: src }] },
    openRows: [{ windowId: 1, cwd: src, title: "app" }],
    excludeWindowId: 2,
  });
  assert.ok(conflict);
  assert.equal(conflict.worktrees.length, 1);
  assert.equal(extraAllowedRootsFor(src).length, 0);
});

test("agentForWorktreeRpc prefers target checkout over calling window", () => {
  const a = { ready: true, cwd: "/repos/app" };
  const b = { ready: true, cwd: "/repos/other" };
  assert.equal(agentForWorktreeRpc("/repos/other", { agent: a }, [{ agent: b }]), b);
  assert.equal(agentForWorktreeRpc("/repos/other", { agent: a }, []), a);
  assert.equal(agentForWorktreeRpc("/repos/missing", null, [{ agent: a }]), a);
});

test("agentForWorktreeRpc snapshots MapIterator and skips dead sessions", () => {
  const a = { ready: true, cwd: "/repos/a" };
  const b = { ready: true, cwd: "/repos/b" };
  const map = new Map([
    [1, { agent: a }],
    [2, { agent: b }],
  ]);
  assert.equal(agentForWorktreeRpc("/repos/missing", null, map.values()), a);
  assert.equal(
    agentForWorktreeRpc("/repos/app", { agent: { ready: false, cwd: "/repos/app" } }, [
      { disposed: true, agent: { ready: true, cwd: "/repos/app" } },
      { agent: { ready: true, cwd: "/repos/app" } },
    ]).cwd,
    "/repos/app",
  );
  assert.equal(agentForWorktreeRpc("/repos/x", { disposed: true }, []), null);
});

test("GROK_DESKTOP_MULTI_INSTANCE skips the single-instance lock", () => {
  const prev = process.env.GROK_DESKTOP_MULTI_INSTANCE;
  process.env.GROK_DESKTOP_MULTI_INSTANCE = "1";
  try {
    let called = false;
    const app = {
      requestSingleInstanceLock: () => {
        called = true;
        return false;
      },
    };
    assert.equal(isPrimaryDesktopInstance(app), true);
    assert.equal(called, false);
  } finally {
    if (prev === undefined) delete process.env.GROK_DESKTOP_MULTI_INSTANCE;
    else process.env.GROK_DESKTOP_MULTI_INSTANCE = prev;
  }
});

test("isPrimaryDesktopInstance uses the Electron lock when env unset", () => {
  const prev = process.env.GROK_DESKTOP_MULTI_INSTANCE;
  delete process.env.GROK_DESKTOP_MULTI_INSTANCE;
  try {
    assert.equal(
      isPrimaryDesktopInstance({ requestSingleInstanceLock: () => true }),
      true,
    );
    assert.equal(
      isPrimaryDesktopInstance({ requestSingleInstanceLock: () => false }),
      false,
    );
  } finally {
    if (prev !== undefined) process.env.GROK_DESKTOP_MULTI_INSTANCE = prev;
  }
});

test("unpackaged skips the lock so npm run dev does not join an install", () => {
  const prev = process.env.GROK_DESKTOP_MULTI_INSTANCE;
  delete process.env.GROK_DESKTOP_MULTI_INSTANCE;
  try {
    let called = false;
    assert.equal(
      isPrimaryDesktopInstance({
        isPackaged: false,
        requestSingleInstanceLock: () => {
          called = true;
          return false;
        },
      }),
      true,
    );
    assert.equal(called, false);
    assert.equal(
      isPrimaryDesktopInstance({
        isPackaged: true,
        requestSingleInstanceLock: () => false,
      }),
      false,
    );
  } finally {
    if (prev !== undefined) process.env.GROK_DESKTOP_MULTI_INSTANCE = prev;
  }
});

test("AUMID is the packaged app id", () => {
  assert.equal(DESKTOP_APP_USER_MODEL_ID, "com.karman.grok-desktop");
});

test("configureDesktopInstance sets AUMID on win32", () => {
  let id = null;
  configureDesktopInstance({
    setAppUserModelId: (v) => {
      id = v;
    },
  });
  if (process.platform === "win32") {
    assert.equal(id, DESKTOP_APP_USER_MODEL_ID);
  } else {
    assert.equal(id, null);
  }
});

test("resolveWorktreeCreateCwd allows occupancy pending cwd", () => {
  const session = "/repos/a";
  const occupied = "/repos/b";
  const open = [{ cwd: occupied, windowId: 2 }];
  assert.ok(
    sameCheckoutPath(
      resolveWorktreeCreateCwd(session, session, open),
      session,
    ),
  );
  assert.ok(
    sameCheckoutPath(
      resolveWorktreeCreateCwd(occupied, null, open),
      occupied,
    ),
  );
  assert.ok(
    sameCheckoutPath(
      resolveWorktreeCreateCwd(occupied, session, open),
      occupied,
    ),
  );
  assert.equal(resolveWorktreeCreateCwd("/repos/evil", session, open), null);
  assert.equal(resolveWorktreeCreateCwd("/repos/evil", null, open), null);
  assert.ok(sameCheckoutPath(resolveWorktreeCreateCwd("", session, open), session));
  assert.equal(resolveWorktreeCreateCwd("", null, open), null);
});

test("commitFamilyAfterOpen re-lists with the ready agent", async (t) => {
  const home = isolateGrokHome(t);
  const src = tmpDir(t, "grok-after-src-");
  gitMarker(src);
  const wt = acpWorktree(t, home, "wt-after");
  let lists = 0;
  const agent = {
    listWorktrees: async () => {
      lists += 1;
      return [{ path: wt, sourceRepo: src }];
    },
  };
  await commitFamilyAfterOpen(wt, agent, []);
  assert.equal(lists, 1);
  assertFamily([src, wt]);
});

test("commitFamilyAfterOpen keeps fallback when re-list is empty", async (t) => {
  const home = isolateGrokHome(t);
  const src = tmpDir(t, "grok-fb-src-");
  gitMarker(src);
  const wt = acpWorktree(t, home, "wt-fb");
  await commitFamilyAfterOpen(src, { listWorktrees: async () => [] }, [
    { path: wt, sourceRepo: src },
  ]);
  assertFamily([src, wt]);
});

test("wireSecondInstance queues until whenReady", async () => {
  let ready = false;
  /** @type {() => void} */
  let resolveReady = () => {};
  const readyP = new Promise((r) => {
    resolveReady = r;
  });
  let calls = 0;
  /** @type {(() => void) | null} */
  let handler = null;
  const app = {
    isReady: () => ready,
    whenReady: () => readyP,
    on: (_ev, fn) => {
      handler = fn;
    },
  };
  wireSecondInstance(app, () => {
    calls += 1;
  });
  handler?.();
  handler?.();
  assert.equal(calls, 0);
  ready = true;
  resolveReady();
  await readyP;
  await Promise.resolve();
  assert.equal(calls, 2);
});

test("wireSecondInstance fires immediately when ready", () => {
  let calls = 0;
  /** @type {(() => void) | null} */
  let handler = null;
  const app = {
    isReady: () => true,
    whenReady: () => Promise.resolve(),
    on: (_ev, fn) => {
      handler = fn;
    },
  };
  wireSecondInstance(app, () => {
    calls += 1;
  });
  handler?.();
  assert.equal(calls, 1);
});

test("ACP family extra roots include porcelain siblings of the source", async (t) => {
  if (!haveGit()) {
    t.skip("git not on PATH");
    return;
  }
  const home = isolateGrokHome(t);
  const tmp = tmpDir(t, "grok-comp-");
  const repo = path.join(tmp, "app");
  const sibling = path.join(tmp, "app-feat");
  fs.mkdirSync(repo);
  const git = (args, cwd = repo) => {
    const r = spawnSync("git", args, {
      cwd,
      encoding: "utf8",
      windowsHide: true,
    });
    assert.equal(r.status, 0, r.stderr || r.stdout);
  };
  const inited = spawnSync("git", ["init", "-b", "main"], {
    cwd: repo,
    encoding: "utf8",
    windowsHide: true,
  });
  if (inited.status !== 0) git(["init"]);
  git(["config", "user.email", "wt@example.com"]);
  git(["config", "user.name", "Worktree Test"]);
  fs.writeFileSync(path.join(repo, "ok.txt"), "hi\n");
  git(["add", "ok.txt"]);
  git(["commit", "-m", "init"]);
  git(["worktree", "add", "-b", "feat", sibling]);
  fs.writeFileSync(path.join(sibling, "feat.txt"), "feat");
  const wt = acpWorktree(t, home, "app-wt");
  registerWorktreeFamily(wt, repo);
  wireWorktreePathGate();
  assert.throws(
    () => assertPathInProject(wt, path.join(sibling, "feat.txt")),
    /outside the open project/,
  );
  const p = resolveProjectPath(wt, path.join(sibling, "feat.txt"), {
    allowGrokHome: true,
  });
  assert.ok(sameCheckoutPath(p, path.join(sibling, "feat.txt")));
});
