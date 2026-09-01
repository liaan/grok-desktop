/**
 * Mac Seatbelt denies $HOME, so git fatals on an existing ~/.gitconfig (EPERM).
 * Jailed terminals must point git at /dev/null and copy host identity.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import {
  applySandboxedGitEnv,
  buildSeatbeltProfile,
  dockerGitConfigEnvFlags,
  hostGitConfigPaths,
  parseGitConfigUser,
  sandboxedGitEnv,
  seatbeltLiteral,
} from "../electron/terminal-sandbox.mjs";

test("parseGitConfigUser reads [user] name and email", () => {
  const r = parseGitConfigUser(`
# comment
[core]
	editor = vim
[user]
	name = Ada Lovelace
	email = ada@example.com
[alias]
	st = status
`);
  assert.equal(r.name, "Ada Lovelace");
  assert.equal(r.email, "ada@example.com");
});

test("parseGitConfigUser strips quotes and inline comments", () => {
  const r = parseGitConfigUser(`[user]
	name = "Ada L"
	email = ada@example.com # work
`);
  assert.equal(r.name, "Ada L");
  assert.equal(r.email, "ada@example.com");
});

test("sandboxedGitEnv always nulls global/system gitconfig", () => {
  const env = sandboxedGitEnv(null);
  assert.equal(env.GIT_CONFIG_GLOBAL, "/dev/null");
  assert.equal(env.GIT_CONFIG_SYSTEM, "/dev/null");
  assert.equal(env.GIT_CONFIG_NOSYSTEM, "1");
  assert.equal(env.GIT_AUTHOR_NAME, undefined);
  assert.equal(env.GIT_CONFIG_COUNT, undefined);
});

test("sandboxedGitEnv copies host identity for commits", () => {
  const env = sandboxedGitEnv({
    name: "Ada Lovelace",
    email: "ada@example.com",
  });
  assert.equal(env.GIT_AUTHOR_NAME, "Ada Lovelace");
  assert.equal(env.GIT_AUTHOR_EMAIL, "ada@example.com");
  assert.equal(env.GIT_COMMITTER_NAME, "Ada Lovelace");
  assert.equal(env.GIT_COMMITTER_EMAIL, "ada@example.com");
  assert.equal(env.GIT_CONFIG_COUNT, "2");
  assert.equal(env.GIT_CONFIG_KEY_0, "user.name");
  assert.equal(env.GIT_CONFIG_VALUE_0, "Ada Lovelace");
  assert.equal(env.GIT_CONFIG_KEY_1, "user.email");
  assert.equal(env.GIT_CONFIG_VALUE_1, "ada@example.com");
});

test("applySandboxedGitEnv does not overwrite caller gitconfig env", () => {
  const env = applySandboxedGitEnv(
    { GIT_CONFIG_GLOBAL: "/tmp/mine", GIT_CONFIG_NOSYSTEM: "" },
    null,
  );
  assert.equal(env.GIT_CONFIG_GLOBAL, "/tmp/mine");
  assert.equal(env.GIT_CONFIG_NOSYSTEM, "1");
});

test("dockerGitConfigEnvFlags emit -e GIT_CONFIG_* pairs", () => {
  const flags = dockerGitConfigEnvFlags(null);
  assert.ok(flags.includes("GIT_CONFIG_GLOBAL=/dev/null"));
  assert.ok(flags.includes("GIT_CONFIG_SYSTEM=/dev/null"));
  assert.ok(flags.includes("GIT_CONFIG_NOSYSTEM=1"));
  const globalIdx = flags.indexOf("GIT_CONFIG_GLOBAL=/dev/null");
  assert.equal(flags[globalIdx - 1], "-e");
});

test("buildSeatbeltProfile exempts git identity files from home read deny", () => {
  const home = path.join(os.tmpdir(), "grok-seatbelt-home");
  const project = path.join(home, "proj");
  const profile = buildSeatbeltProfile({
    projectRoot: project,
    homeDir: home,
    grokHome: path.join(home, ".grok"),
  });
  const paths = hostGitConfigPaths(home);
  assert.match(profile, /deny file-read\*/);
  assert.match(profile, /deny file-write\*/);
  for (const p of [
    paths.gitconfig,
    paths.xdgConfig,
    paths.xdgIgnore,
    paths.xdgAttributes,
    paths.gitignoreGlobal,
  ]) {
    const lit = seatbeltLiteral(p);
    assert.ok(
      profile.includes(`(require-not (literal "${lit}"))`),
      `expected read-deny exemption for ${p}`,
    );
    // Write deny must NOT exempt gitconfig (agent should not edit global config)
    const writeBlock = profile.slice(
      profile.indexOf("deny file-write*"),
      profile.indexOf("deny file-read*"),
    );
    assert.equal(writeBlock.includes(lit), false, `write deny must still cover ${p}`);
  }
});
