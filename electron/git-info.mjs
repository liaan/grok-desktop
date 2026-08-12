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
 * @param {string} raw
 * @returns {{ value: string, rest: string }}
 */
export function unquoteGitPath(raw) {
  const s = String(raw ?? "");
  if (!s.startsWith('"')) {
    return { value: s, rest: "" };
  }
  let out = "";
  for (let i = 1; i < s.length; i++) {
    const c = s[i];
    if (c === '"') {
      return { value: out, rest: s.slice(i + 1) };
    }
    if (c === "\\" && i + 1 < s.length) {
      const n = s[i + 1];
      if (n === "n") {
        out += "\n";
        i += 1;
        continue;
      }
      if (n === "t") {
        out += "\t";
        i += 1;
        continue;
      }
      if (n === "r") {
        out += "\r";
        i += 1;
        continue;
      }
      if (n === '"' || n === "\\") {
        out += n;
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
        out += String.fromCharCode(parseInt(oct, 8));
        i = j - 1;
        continue;
      }
      out += n;
      i += 1;
      continue;
    }
    out += c;
  }
  return { value: s.slice(1), rest: "" };
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
  /** @type {string} */
  let filePath;
  /** @type {string | null} */
  let origPath = null;

  if (rest.startsWith('"')) {
    const first = unquoteGitPath(rest);
    if (isRename) {
      origPath = first.value;
      const after = first.rest.replace(/^\s*->\s*/, "");
      filePath = after.startsWith('"')
        ? unquoteGitPath(after).value
        : after;
    } else {
      filePath = first.value;
    }
  } else if (isRename) {
    const sep = " -> ";
    const idx = rest.lastIndexOf(sep);
    if (idx >= 0) {
      origPath = rest.slice(0, idx);
      filePath = rest.slice(idx + sep.length);
    } else {
      filePath = rest;
    }
  } else {
    filePath = rest;
  }

  filePath = String(filePath || "").trim();
  if (!filePath) return null;
  if (origPath != null) origPath = String(origPath).trim() || null;

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
 * @param {string} cwd
 * @returns {Promise<{ files: NonNullable<ReturnType<typeof parsePorcelainLine>>[] }>}
 */
export async function getGitStatus(cwd) {
  if (!cwd || typeof cwd !== "string") {
    return { files: [] };
  }
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["status", "--porcelain=v1", "-uall"],
      gitExecOpts(cwd, { timeout: 8000, maxBuffer: 1024 * 1024 }),
    );
    return { files: parsePorcelain(stdout) };
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
