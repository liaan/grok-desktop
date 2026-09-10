/**
 * Jailed tool shells cannot read ~/.ssh. GIT_SSH_COMMAND must not force
 * StrictHostKeyChecking=yes without a readable UserKnownHostsFile under GROK_HOME.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  applyNonInteractiveToolEnv,
  dockerGitSshCommand,
  DOCKER_GROK_KNOWN_HOSTS,
  ensureGrokKnownHosts,
  gitSshCommand,
  grokKnownHostsPath,
} from "../electron/tool-git-env.mjs";
import { applyNonInteractiveToolEnv as fromAcpTerminals } from "../electron/acp-terminals.mjs";

function assertSafeGitSshCommand(cmd, knownHostsPath) {
  assert.equal(typeof cmd, "string");
  assert.match(cmd, /BatchMode=yes/);
  assert.match(cmd, /StrictHostKeyChecking=accept-new/);
  assert.doesNotMatch(cmd, /StrictHostKeyChecking=yes(?:\s|$)/);
  assert.match(cmd, /UserKnownHostsFile=/);
  assert.match(cmd, /GlobalKnownHostsFile=\/dev\/null/);
  if (knownHostsPath) {
    assert.ok(
      cmd.includes(knownHostsPath),
      `expected UserKnownHostsFile to include ${knownHostsPath}, got ${cmd}`,
    );
    assert.ok(
      !cmd.includes(`${path.sep}.ssh${path.sep}`) &&
        !cmd.includes("/.ssh/") &&
        !cmd.includes("\\.ssh\\"),
      `UserKnownHostsFile must not point at ~/.ssh, got ${cmd}`,
    );
  }
}

function withTempDir(fn) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "grok-ssh-env-"));
  try {
    return fn(tmp);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

test("gitSshCommand uses accept-new and a quoted UserKnownHostsFile", () => {
  const dest = "/tmp/has space/known_hosts";
  const cmd = gitSshCommand(dest);
  assertSafeGitSshCommand(cmd, dest);
  assert.ok(cmd.includes("'"), "path with spaces must be shell-quoted");
});

test("dockerGitSshCommand points at /grok/ssh/known_hosts", () => {
  const cmd = dockerGitSshCommand();
  assertSafeGitSshCommand(cmd, DOCKER_GROK_KNOWN_HOSTS);
  assert.equal(DOCKER_GROK_KNOWN_HOSTS, "/grok/ssh/known_hosts");
});

test("applyNonInteractiveToolEnv copies host known_hosts into GROK_HOME/ssh", () => {
  withTempDir((tmp) => {
    const grokHome = path.join(tmp, "grok");
    const hostKh = path.join(tmp, "host_known_hosts");
    fs.writeFileSync(hostKh, "bitbucket.org ssh-ed25519 AAAATESTKEY\n");
    const env = applyNonInteractiveToolEnv(
      { GROK_HOME: grokHome },
      { grokHome, hostKnownHosts: hostKh },
    );
    const dest = grokKnownHostsPath(grokHome);
    assertSafeGitSshCommand(env.GIT_SSH_COMMAND, dest);
    assert.equal(env.GIT_EDITOR, "true");
    assert.equal(env.GIT_TERMINAL_PROMPT, "0");
    assert.ok(fs.existsSync(dest));
    assert.ok(
      fs.readFileSync(dest, "utf8").includes("bitbucket.org ssh-ed25519 AAAATESTKEY"),
    );
    assert.equal(fs.existsSync(path.join(grokHome, "ssh", "id_rsa")), false);
  });
});

test("applyNonInteractiveToolEnv does not copy private keys from ~/.ssh", () => {
  withTempDir((tmp) => {
    const grokHome = path.join(tmp, "grok");
    const sshDir = path.join(tmp, ".ssh");
    fs.mkdirSync(sshDir);
    fs.writeFileSync(path.join(sshDir, "id_ed25519"), "PRIVATE KEY MATERIAL\n");
    fs.writeFileSync(
      path.join(sshDir, "known_hosts"),
      "github.com ssh-ed25519 AAAAGITHUB\n",
    );
    ensureGrokKnownHosts({
      grokHome,
      hostKnownHosts: path.join(sshDir, "known_hosts"),
    });
    const destDir = path.join(grokHome, "ssh");
    assert.deepEqual(fs.readdirSync(destDir).sort(), ["known_hosts"]);
    assert.ok(
      fs.readFileSync(path.join(destDir, "known_hosts"), "utf8").includes("github.com"),
    );
  });
});

test("ensureGrokKnownHosts merges missing host keys and keeps existing lines", () => {
  withTempDir((tmp) => {
    const grokHome = path.join(tmp, "grok");
    const dest = grokKnownHostsPath(grokHome);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, "gitlab.com ssh-ed25519 AAAAGITLAB\n");
    const hostKh = path.join(tmp, "host_known_hosts");
    fs.writeFileSync(
      hostKh,
      "gitlab.com ssh-ed25519 AAAAGITLAB\nbitbucket.org ssh-ed25519 AAAABB\n",
    );
    ensureGrokKnownHosts({ grokHome, hostKnownHosts: hostKh });
    const text = fs.readFileSync(dest, "utf8");
    assert.equal(
      text.split(/\r?\n/).filter((l) => l.includes("gitlab.com")).length,
      1,
    );
    assert.ok(text.includes("bitbucket.org ssh-ed25519 AAAABB"));
  });
});

test("applyNonInteractiveToolEnv does not override caller GIT_SSH_COMMAND", () => {
  withTempDir((tmp) => {
    const grokHome = path.join(tmp, "grok");
    const env = applyNonInteractiveToolEnv(
      { GROK_HOME: grokHome, GIT_SSH_COMMAND: "ssh -o BatchMode=yes" },
      { grokHome, hostKnownHosts: null },
    );
    assert.equal(env.GIT_SSH_COMMAND, "ssh -o BatchMode=yes");
  });
});

test("applyNonInteractiveToolEnv is re-exported from acp-terminals", () => {
  assert.equal(fromAcpTerminals, applyNonInteractiveToolEnv);
});

test("source must not force StrictHostKeyChecking=yes", () => {
  const dir = path.dirname(fileURLToPath(import.meta.url));
  for (const rel of [
    "../electron/acp-terminals.mjs",
    "../electron/terminal-sandbox.mjs",
    "../electron/tool-git-env.mjs",
  ]) {
    const src = fs.readFileSync(path.join(dir, rel), "utf8");
    assert.equal(
      src.includes("StrictHostKeyChecking=yes"),
      false,
      `${rel} must not force StrictHostKeyChecking=yes (jailed ~/.ssh is unreadable)`,
    );
  }
});
