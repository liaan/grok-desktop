/**
 * Non-interactive git/SSH env for ACP tool terminals.
 *
 * Seatbelt/bwrap deny ~/.ssh (private keys stay blocked). Host keys live under
 * GROK_HOME/ssh/known_hosts — writable in the jail — so git fetch over SSH
 * works with StrictHostKeyChecking=accept-new. SSH_AUTH_SOCK is enough for
 * agent auth; do not bind id_* or ~/.git-credentials.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { grokHomeDir } from "./grok-home.mjs";
import { shellEscape } from "./shell-argv.mjs";

/** Known_hosts path inside the Docker sandbox (GROK_HOME is mounted at /grok). */
export const DOCKER_GROK_KNOWN_HOSTS = "/grok/ssh/known_hosts";

/**
 * @param {string} [grokHome]
 * @returns {string}
 */
export function grokKnownHostsPath(grokHome = grokHomeDir()) {
  return path.join(path.resolve(grokHome), "ssh", "known_hosts");
}

/**
 * SSH command for jailed git: first unseen host is recorded; later connects
 * stay strict. `knownHostsFile` must be readable/writable in the jail.
 * @param {string} knownHostsFile
 * @returns {string}
 */
export function gitSshCommand(knownHostsFile) {
  const file = shellEscape(String(knownHostsFile));
  return (
    "ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new " +
    `-o UserKnownHostsFile=${file} -o GlobalKnownHostsFile=/dev/null ` +
    "-o ConnectTimeout=15"
  );
}

/** GIT_SSH_COMMAND used inside the Docker sandbox (`GROK_HOME=/grok`). */
export function dockerGitSshCommand() {
  return gitSshCommand(DOCKER_GROK_KNOWN_HOSTS);
}

/**
 * Ensure GROK_HOME/ssh/known_hosts exists. Copies host ~/.ssh/known_hosts
 * (host keys only) when dest is new or missing lines. Never copies id_*.
 *
 * @param {{
 *   grokHome?: string,
 *   hostKnownHosts?: string | null,
 * }} [opts]
 * @returns {string} dest path
 */
export function ensureGrokKnownHosts(opts = {}) {
  const dest = grokKnownHostsPath(opts.grokHome);
  const dir = path.dirname(dest);
  const hostSrc =
    opts.hostKnownHosts === undefined
      ? path.join(os.homedir(), ".ssh", "known_hosts")
      : opts.hostKnownHosts;

  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch {
    return dest;
  }

  if (!fs.existsSync(dest)) {
    try {
      fs.writeFileSync(dest, "");
    } catch {
      return dest;
    }
  }

  if (hostSrc) mergeKnownHostsFile(dest, hostSrc);
  return dest;
}

/**
 * Append host-key lines from `src` that are not already in `dest`.
 * @param {string} dest
 * @param {string} src
 */
function mergeKnownHostsFile(dest, src) {
  let srcText;
  try {
    srcText = fs.readFileSync(src, "utf8");
  } catch {
    return;
  }
  let destText = "";
  try {
    destText = fs.readFileSync(dest, "utf8");
  } catch {
    destText = "";
  }
  const have = new Set(
    destText
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("#")),
  );
  /** @type {string[]} */
  const extra = [];
  for (const line of srcText.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    if (have.has(t)) continue;
    extra.push(t);
    have.add(t);
  }
  if (!extra.length) return;
  try {
    const prefix = destText && !destText.endsWith("\n") ? "\n" : "";
    fs.appendFileSync(dest, prefix + extra.join("\n") + "\n");
  } catch {
    /* dest may be unwritable; accept-new still helps on first connect */
  }
}

/**
 * Env so agent tool shells never block on editors / credential TTY prompts.
 * ACP terminals use stdin "ignore" — interactive git/gpg hangs forever ("pending").
 *
 * @param {Record<string, string | undefined>} env
 * @param {{ grokHome?: string, hostKnownHosts?: string | null }} [opts]
 * @returns {Record<string, string | undefined>}
 */
export function applyNonInteractiveToolEnv(env, opts = {}) {
  const grokHome = opts.grokHome || env.GROK_HOME || grokHomeDir();
  const knownHosts = ensureGrokKnownHosts({
    grokHome,
    hostKnownHosts: opts.hostKnownHosts,
  });
  const defaults = {
    GIT_EDITOR: "true",
    EDITOR: "true",
    VISUAL: "true",
    GIT_TERMINAL_PROMPT: "0",
    GCM_INTERACTIVE: "never",
    GIT_PAGER: "cat",
    PAGER: "cat",
    GIT_SSH_COMMAND: gitSshCommand(knownHosts),
    GPG_TTY: "",
    // Prefer plain stdout for tools that honor these (pytest, chalk, cargo, …).
    // UI also strips ANSI; this reduces noise at the source.
    NO_COLOR: "1",
    FORCE_COLOR: "0",
    CLICOLOR: "0",
    CLICOLOR_FORCE: "0",
    PY_COLORS: "0",
    TERM: "dumb",
  };
  for (const [k, v] of Object.entries(defaults)) {
    if (env[k] == null || env[k] === "") env[k] = v;
  }
  return env;
}
