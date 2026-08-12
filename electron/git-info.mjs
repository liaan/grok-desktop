/**
 * Lightweight git helpers for the status bar and Changes pane.
 * Uses the system `git` binary; never throws — returns empty/nulls on failure.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/**
 * @param {string} cwd
 * @param {{ timeout?: number, maxBuffer?: number }} [extra]
 */
function gitExecOpts(cwd, extra = {}) {
  return {
    cwd,
    timeout: extra.timeout ?? 4000,
    maxBuffer: extra.maxBuffer ?? 64 * 1024,
    windowsHide: true,
    env: process.env,
    encoding: "utf8",
  };
}

/**
 * Unquote a git C-style path (`core.quotePath`).
 * Octal escapes are bytes, decoded as UTF-8 (`\303\274` → `ü`).
 * @param {string} raw
 * @returns {{ value: string, rest: string }}
 */
export function unquoteGitPath(raw) {
  const s = String(raw ?? "");
  if (!s.startsWith('"')) {
    return { value: s, rest: "" };
  }
  /** @type {number[]} */
  const bytes = [];
  const pushUtf8 = (str) => {
    const buf = Buffer.from(str, "utf8");
    for (const b of buf) bytes.push(b);
  };
  for (let i = 1; i < s.length; i++) {
    const c = s[i];
    if (c === '"') {
      return {
        value: Buffer.from(bytes).toString("utf8"),
        rest: s.slice(i + 1),
      };
    }
    if (c === "\\" && i + 1 < s.length) {
      const n = s[i + 1];
      if (n === "n") {
        bytes.push(0x0a);
        i += 1;
        continue;
      }
      if (n === "t") {
        bytes.push(0x09);
        i += 1;
        continue;
      }
      if (n === "r") {
        bytes.push(0x0d);
        i += 1;
        continue;
      }
      if (n === '"' || n === "\\") {
        bytes.push(n.charCodeAt(0));
        i += 1;
        continue;
      }
      if (n >= "0" && n <= "7") {
        let oct = n;
        let j = i + 2;
        while (j < s.length && j < i + 4 && s[j] >= "0" && s[j] <= "7") {
          oct += s[j];
          j += 1;
        }
        bytes.push(parseInt(oct, 8) & 0xff);
        i = j - 1;
        continue;
      }
      pushUtf8(n);
      i += 1;
      continue;
    }
    pushUtf8(c);
  }
  return { value: Buffer.from(bytes).toString("utf8"), rest: "" };
}

/**
 * One path token from porcelain remainder.
 * Quoted → C-unquote; unquoted → until ` -> ` (rename) or EOL.
 * @param {string} raw
 * @returns {{ value: string, rest: string }}
 */
export function takePorcelainPath(raw) {
  const s = String(raw ?? "");
  if (s.startsWith('"')) return unquoteGitPath(s);
  const sep = " -> ";
  const idx = s.indexOf(sep);
  if (idx >= 0) {
    return { value: s.slice(0, idx), rest: s.slice(idx) };
  }
  return { value: s, rest: "" };
}

/**
 * @param {string} index
 * @param {string} worktree
 * @returns {string}
 */
export function porcelainStatusLetter(index, worktree) {
  if (index === "?" || worktree === "?") return "?";
  if (index === "D" || worktree === "D") return "D";
  if (index === "A" || worktree === "A") return "A";
  if (index === "R" || worktree === "R") return "R";
  if (index === "M" || worktree === "M") return "M";
  if (index === "C" || worktree === "C") return "C";
  if (index === "U" || worktree === "U") return "U";
  const y = worktree && worktree !== " " ? worktree : index;
  return y && y !== " " ? y : "M";
}

/**
 * Parse one `git status --porcelain=v1` line.
 * @param {string} line
 * @returns {{
 *   path: string,
 *   origPath: string | null,
 *   index: string,
 *   worktree: string,
 *   status: string,
 *   untracked: boolean,
 *   staged: boolean,
 *   unstaged: boolean,
 * } | null}
 */
export function parsePorcelainLine(line) {
  const raw = String(line ?? "").replace(/\r$/, "");
  if (raw.length < 3 || raw[2] !== " ") return null;
  const index = raw[0];
  const worktree = raw[1];
  if (index === "!" || worktree === "!") return null;

  const rest = raw.slice(3);
  const isRename = index === "R" || index === "C";
  const first = takePorcelainPath(rest);
  /** @type {string} */
  let filePath;
  /** @type {string | null} */
  let origPath = null;

  if (isRename) {
    origPath = first.value;
    const after = first.rest.replace(/^\s*->\s*/, "");
    filePath = takePorcelainPath(after).value;
  } else {
    filePath = first.value;
  }

  if (!filePath) return null;
  if (origPath != null && !origPath) origPath = null;

  const untracked = index === "?" && worktree === "?";
  return {
    path: filePath,
    origPath,
    index,
    worktree,
    status: porcelainStatusLetter(index, worktree),
    untracked,
    staged: !untracked && index !== " ",
    unstaged: untracked || worktree !== " ",
  };
}

/**
 * @param {string} stdout
 * @returns {ReturnType<typeof parsePorcelainLine>[]}
 */
export function parsePorcelain(stdout) {
  /** @type {NonNullable<ReturnType<typeof parsePorcelainLine>>[]} */
  const files = [];
  for (const line of String(stdout ?? "").split("\n")) {
    const entry = parsePorcelainLine(line);
    if (entry) files.push(entry);
  }
  return files;
}

/**
 * @param {string} cwd
 * @returns {Promise<{ branch: string | null, detached: boolean }>}
 */
export async function getGitBranch(cwd) {
  if (!cwd || typeof cwd !== "string") {
    return { branch: null, detached: false };
  }

  const opts = gitExecOpts(cwd);

  try {
    const { stdout } = await execFileAsync(
      "git",
      ["rev-parse", "--abbrev-ref", "HEAD"],
      opts,
    );
    const name = String(stdout || "").trim();
    if (!name) return { branch: null, detached: false };

    if (name === "HEAD") {
      try {
        const { stdout: shaOut } = await execFileAsync(
          "git",
          ["rev-parse", "--short", "HEAD"],
          opts,
        );
        const sha = String(shaOut || "").trim();
        return { branch: sha || "HEAD", detached: true };
      } catch {
        return { branch: "HEAD", detached: true };
      }
    }

    return { branch: name, detached: false };
  } catch {
    return { branch: null, detached: false };
  }
}

/**
 * Porcelain paths are repo-root-relative. Strip `--show-prefix` so they
 * are project-cwd-relative (opening a monorepo package, not the toplevel).
 * @param {string} filePath
 * @param {string} prefix
 */
export function stripGitPrefix(filePath, prefix) {
  const p = String(filePath ?? "");
  const pre = String(prefix ?? "");
  if (!pre || !p.startsWith(pre)) return p;
  return p.slice(pre.length);
}

/**
 * @param {string} cwd
 * @returns {Promise<string>}
 */
async function gitShowPrefix(cwd) {
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["rev-parse", "--show-prefix"],
      gitExecOpts(cwd),
    );
    return String(stdout || "").replace(/\r?\n$/, "");
  } catch {
    return "";
  }
}

/**
 * @param {string} cwd
 * @returns {Promise<{ files: NonNullable<ReturnType<typeof parsePorcelainLine>>[] }>}
 */
export async function getGitStatus(cwd) {
  if (!cwd || typeof cwd !== "string") {
    return { files: [] };
  }
  try {
    const prefix = await gitShowPrefix(cwd);
    const { stdout } = await execFileAsync(
      "git",
      ["status", "--porcelain=v1", "-uall", "--", "."],
      gitExecOpts(cwd, { timeout: 8000, maxBuffer: 1024 * 1024 }),
    );
    const files = parsePorcelain(stdout)
      .map((f) => ({
        ...f,
        path: stripGitPrefix(f.path, prefix),
        origPath: f.origPath ? stripGitPrefix(f.origPath, prefix) : null,
      }))
      .filter((f) => f.path && !f.path.startsWith("../") && f.path !== "..");
    return { files };
  } catch {
    return { files: [] };
  }
}

/**
 * @param {string} cwd
 * @param {string} filePath
 * @param {{ staged?: boolean }} [opts]
 * @returns {Promise<{ path: string, staged: boolean, diff: string | null }>}
 */
export async function getGitDiff(cwd, filePath, opts = {}) {
  const staged = Boolean(opts?.staged);
  const rel = filePath == null ? "" : String(filePath);
  if (!cwd || typeof cwd !== "string" || !rel) {
    return { path: rel, staged, diff: null };
  }
  try {
    const args = staged
      ? ["diff", "--no-color", "--cached", "--", rel]
      : ["diff", "--no-color", "--", rel];
    const { stdout } = await execFileAsync(
      "git",
      args,
      gitExecOpts(cwd, { timeout: 8000, maxBuffer: 2 * 1024 * 1024 }),
    );
    return { path: rel, staged, diff: String(stdout ?? "") };
  } catch {
    return { path: rel, staged, diff: null };
  }
}
