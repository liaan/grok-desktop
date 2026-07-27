/**
 * Lightweight git status for the desktop status bar (branch name only).
 * Uses the system `git` binary; never throws — returns nulls on failure.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/**
 * @param {string} cwd
 * @returns {Promise<{ branch: string | null, detached: boolean }>}
 */
export async function getGitBranch(cwd) {
  if (!cwd || typeof cwd !== "string") {
    return { branch: null, detached: false };
  }

  const opts = {
    cwd,
    timeout: 4000,
    maxBuffer: 64 * 1024,
    windowsHide: true,
    env: process.env,
  };

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
