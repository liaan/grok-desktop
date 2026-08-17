import { test } from "node:test";
import assert from "node:assert/strict";
import {
  classifyPermissionRisk,
  permissionAutoDecision,
  shouldAutoAllowPermission,
} from "../shared/permission-risk.mjs";

function perm(partial) {
  return {
    toolCall: {
      title: partial.title || "",
      kind: partial.kind || "",
      rawInput: partial.raw || {},
      _meta: partial.meta || {},
    },
    options: partial.options,
  };
}

test("reads and preview browse are safe", () => {
  assert.equal(
    classifyPermissionRisk(perm({ kind: "read", title: "Read src/App.tsx" })),
    "safe",
  );
  assert.equal(
    classifyPermissionRisk(perm({ kind: "search", title: "Search" })),
    "safe",
  );
  assert.equal(
    classifyPermissionRisk(
      perm({ title: "desktop-preview__preview_snapshot" }),
    ),
    "safe",
  );
  assert.equal(
    classifyPermissionRisk(perm({ title: "preview_open" })),
    "safe",
  );
});

test("namespaced desktop-preview__preview_snapshot is safe", () => {
  assert.equal(
    classifyPermissionRisk(
      perm({
        title: "desktop-preview__preview_snapshot",
        meta: { "x.ai/tool": { name: "desktop-preview__preview_snapshot" } },
      }),
    ),
    "safe",
  );
});

test("edits, posts, and mutating shells are write", () => {
  assert.equal(
    classifyPermissionRisk(perm({ kind: "edit", title: "Write file" })),
    "write",
  );
  assert.equal(
    classifyPermissionRisk(
      perm({ title: "linear__create_issue", meta: { "x.ai/tool": { name: "create_issue" } } }),
    ),
    "write",
  );
  assert.equal(
    classifyPermissionRisk(
      perm({ kind: "execute", title: "Execute `npm install`" }),
    ),
    "write",
  );
});

test("preview fill/click/interact are write", () => {
  assert.equal(
    classifyPermissionRisk(perm({ title: "preview_fill" })),
    "write",
  );
  assert.equal(
    classifyPermissionRisk(perm({ title: "preview_click" })),
    "write",
  );
  assert.equal(
    classifyPermissionRisk(
      perm({ title: "desktop-preview__preview_interact" }),
    ),
    "write",
  );
  assert.equal(
    classifyPermissionRisk(perm({ title: "preview_press" })),
    "write",
  );
  assert.equal(
    classifyPermissionRisk(perm({ title: "preview_type" })),
    "write",
  );
  assert.equal(
    classifyPermissionRisk(perm({ title: "preview_fill_form" })),
    "write",
  );
});

test("sudo cat is write (do not strip sudo)", () => {
  assert.equal(
    classifyPermissionRisk(
      perm({ kind: "execute", title: "Execute `sudo cat /etc/passwd`" }),
    ),
    "write",
  );
  assert.equal(
    classifyPermissionRisk(
      perm({
        kind: "execute",
        title: "Execute",
        raw: { command: "sudo cat /etc/hosts" },
      }),
    ),
    "write",
  );
});

test("unknown tools fail closed as write", () => {
  assert.equal(classifyPermissionRisk(perm({ title: "mystery_tool" })), "write");
  assert.equal(classifyPermissionRisk(perm({})), "write");
});

test("read-only execute stays safe", () => {
  assert.equal(
    classifyPermissionRisk(
      perm({ kind: "execute", title: "Execute `git status`" }),
    ),
    "safe",
  );
  assert.equal(
    classifyPermissionRisk(
      perm({ kind: "execute", title: "Execute `ls -la`" }),
    ),
    "safe",
  );
});

test("switching to auto would flush a waiting read, not a write", () => {
  const read = perm({ kind: "read", title: "Read foo" });
  const write = perm({ kind: "edit", title: "Write foo" });
  assert.equal(
    shouldAutoAllowPermission(read, { permissionMode: "auto" }),
    true,
  );
  assert.equal(
    shouldAutoAllowPermission(write, { permissionMode: "auto" }),
    false,
  );
});

test("auto silent-allows safe, still prompts writes", () => {
  const read = perm({ kind: "read", title: "Read foo" });
  const write = perm({ kind: "edit", title: "Write foo" });
  assert.equal(
    shouldAutoAllowPermission(read, { permissionMode: "auto" }),
    true,
  );
  assert.equal(
    shouldAutoAllowPermission(write, { permissionMode: "auto" }),
    false,
  );
  assert.equal(
    shouldAutoAllowPermission(write, {
      permissionMode: "auto",
      allowWritesThisSession: true,
    }),
    true,
  );
  assert.equal(
    shouldAutoAllowPermission(write, { permissionMode: "ask" }),
    false,
  );
  assert.equal(
    shouldAutoAllowPermission(write, { permissionMode: "always-approve" }),
    true,
  );
});

test("session grant auto-allows writes without allowAlwaysOk", () => {
  const write = perm({ kind: "edit", title: "Write foo" });
  const granted = permissionAutoDecision(write, {
    permissionMode: "auto",
    allowWritesThisSession: true,
  });
  assert.deepEqual(granted, { allow: true, allowAlwaysOk: false });

  const always = permissionAutoDecision(write, {
    permissionMode: "always-approve",
  });
  assert.deepEqual(always, { allow: true, allowAlwaysOk: true });

  const parked = permissionAutoDecision(write, { permissionMode: "auto" });
  assert.deepEqual(parked, { allow: false });
});

test("permissionAutoDecision silent-allows reads and preview browse in auto", () => {
  assert.deepEqual(
    permissionAutoDecision(
      perm({ kind: "read", title: "Read src/App.tsx" }),
      { permissionMode: "auto" },
    ),
    { allow: true, allowAlwaysOk: false },
  );
  assert.deepEqual(
    permissionAutoDecision(perm({ title: "preview_snapshot" }), {
      permissionMode: "auto",
    }),
    { allow: true, allowAlwaysOk: false },
  );
  assert.deepEqual(
    permissionAutoDecision(perm({ title: "preview_open" }), {
      permissionMode: "auto",
    }),
    { allow: true, allowAlwaysOk: false },
  );
});

test("background & chains are write", () => {
  assert.equal(
    classifyPermissionRisk(
      perm({ kind: "execute", title: "Execute `cat README.md & git push`" }),
    ),
    "write",
  );
  assert.equal(
    classifyPermissionRisk(
      perm({ kind: "execute", raw: { command: "ls & npm install" } }),
    ),
    "write",
  );
});

test("find -fprint and git show --output are write", () => {
  assert.equal(
    classifyPermissionRisk(
      perm({
        kind: "execute",
        raw: { command: "find . -name '*.js' -fprint /tmp/out" },
      }),
    ),
    "write",
  );
  assert.equal(
    classifyPermissionRisk(
      perm({
        kind: "execute",
        raw: { command: "git show HEAD:README.md --output=/tmp/out" },
      }),
    ),
    "write",
  );
});

test("search_replace is write without a kind", () => {
  assert.equal(
    classifyPermissionRisk(
      perm({ title: "search_replace", meta: { "x.ai/tool": { name: "search_replace" } } }),
    ),
    "write",
  );
  assert.equal(
    classifyPermissionRisk(perm({ title: "str_replace" })),
    "write",
  );
});

test("pipes, redirects, and find -delete are write", () => {
  assert.equal(
    classifyPermissionRisk(
      perm({ kind: "execute", title: "Execute `echo pwned > file`" }),
    ),
    "write",
  );
  assert.equal(
    classifyPermissionRisk(
      perm({ kind: "execute", title: "Execute `cat x | bash`" }),
    ),
    "write",
  );
  assert.equal(
    classifyPermissionRisk(
      perm({
        kind: "execute",
        raw: { command: "find . -name '*.js' -delete" },
      }),
    ),
    "write",
  );
});

test("command wins over a safe kind", () => {
  assert.equal(
    classifyPermissionRisk(
      perm({
        kind: "read",
        title: "Read",
        raw: { command: "npm install" },
      }),
    ),
    "write",
  );
  assert.equal(
    classifyPermissionRisk(
      perm({
        kind: "fetch",
        title: "Fetch",
        raw: { command: "git push" },
      }),
    ),
    "write",
  );
});

test("title first token does not mark mutators safe", () => {
  assert.equal(
    classifyPermissionRisk(perm({ title: "find_and_replace" })),
    "write",
  );
  assert.equal(
    classifyPermissionRisk(
      perm({
        title: "Search and replace in files",
        meta: { "x.ai/tool": { name: "search_and_replace" } },
      }),
    ),
    "write",
  );
});

test("git branch / remote are write", () => {
  assert.equal(
    classifyPermissionRisk(
      perm({ kind: "execute", title: "Execute `git branch -D tmp`" }),
    ),
    "write",
  );
  assert.equal(
    classifyPermissionRisk(
      perm({ kind: "execute", title: "Execute `git remote add origin x`" }),
    ),
    "write",
  );
});

test("permissionAutoDecision parks writes and preview interact in auto", () => {
  assert.deepEqual(
    permissionAutoDecision(
      perm({ kind: "execute", title: "Execute `npm install`" }),
      { permissionMode: "auto" },
    ),
    { allow: false },
  );
  assert.deepEqual(
    permissionAutoDecision(perm({ title: "preview_fill" }), {
      permissionMode: "auto",
    }),
    { allow: false },
  );
  assert.deepEqual(
    permissionAutoDecision(perm({ title: "preview_click" }), {
      permissionMode: "auto",
    }),
    { allow: false },
  );
});

test("permissionAutoDecision: namespaced snapshot safe, sudo cat parked", () => {
  assert.deepEqual(
    permissionAutoDecision(
      perm({
        title: "desktop-preview__preview_snapshot",
        meta: { "x.ai/tool": { name: "desktop-preview__preview_snapshot" } },
      }),
      { permissionMode: "auto" },
    ),
    { allow: true, allowAlwaysOk: false },
  );
  assert.deepEqual(
    permissionAutoDecision(
      perm({ kind: "execute", title: "Execute `sudo cat /etc/passwd`" }),
      { permissionMode: "auto" },
    ),
    { allow: false },
  );
});
