/**
 * Shared Grok install discovery: binary path, ~/.grok home, spawn env.
 * Electron GUI launches often get a thin PATH (esp. macOS Dock) — enrich it.
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

export function grokHomeDir() {
  if (process.env.GROK_HOME) return process.env.GROK_HOME;
  return path.join(os.homedir(), ".grok");
}

/**
 * Candidate Git for Windows install roots (bin/cmd/usr\bin live under these).
 * Shared by PATH enrichment and bash discovery so host shells see the same git.
 * @returns {string[]}
 */
export function windowsGitInstallRoots() {
  if (process.platform !== "win32") return [];
  const pf = process.env["ProgramFiles"] || "C:\\Program Files";
  const pf86 = process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)";
  const local = process.env.LOCALAPPDATA || "";
  return [
    path.join(pf, "Git"),
    path.join(pf86, "Git"),
    local ? path.join(local, "Programs", "Git") : "",
  ].filter(Boolean);
}

/**
 * Existing Git for Windows PATH dirs (cmd, bin, usr\bin) in preference order.
 * @returns {string[]}
 */
export function windowsGitPathDirs() {
  /** @type {string[]} */
  const dirs = [];
  for (const root of windowsGitInstallRoots()) {
    for (const sub of ["cmd", "bin", path.join("usr", "bin")]) {
      const d = path.join(root, sub);
      try {
        if (fs.existsSync(d)) dirs.push(d);
      } catch {
        /* ignore */
      }
    }
  }
  return dirs;
}

/**
 * Absolute path to Git for Windows bash.exe, or null if not installed.
 * Prefer this over System32\bash.exe (WSL launcher).
 * @returns {string | null}
 */
export function windowsGitBashPath() {
  if (process.platform !== "win32") return null;
  for (const root of windowsGitInstallRoots()) {
    for (const rel of [
      path.join("bin", "bash.exe"),
      path.join("usr", "bin", "bash.exe"),
    ]) {
      const p = path.join(root, rel);
      try {
        if (fs.existsSync(p)) return p;
      } catch {
        /* ignore */
      }
    }
  }
  return null;
}

export function resolveGrokBinary() {
  if (process.env.GROK_BINARY) return process.env.GROK_BINARY;

  const home = os.homedir();
  const exe = process.platform === "win32" ? "grok.exe" : "grok";
  const candidates = [
    path.join(grokHomeDir(), "bin", exe),
    path.join(home, ".local", "bin", "grok"),
    path.join(home, ".cargo", "bin", exe),
    "/usr/local/bin/grok",
    "/opt/homebrew/bin/grok",
  ];

  for (const c of candidates) {
    try {
      if (fs.existsSync(c)) return c;
    } catch {
      /* ignore */
    }
  }

  // Last resort: rely on PATH (may work when launched from a terminal)
  return process.platform === "win32" ? "grok.exe" : "grok";
}

export function grokBinaryExists() {
  const bin = resolveGrokBinary();
  if (path.isAbsolute(bin) || bin.includes(path.sep) || bin.includes("/")) {
    try {
      return fs.existsSync(bin);
    } catch {
      return false;
    }
  }
  // PATH-only name: scan PATH for an executable
  const pathSep = process.platform === "win32" ? ";" : ":";
  const exts =
    process.platform === "win32"
      ? (process.env.PATHEXT || ".EXE;.CMD;.BAT").split(";").filter(Boolean)
      : [""];
  const dirs = (process.env.PATH || process.env.Path || "").split(pathSep);
  for (const dir of dirs) {
    if (!dir) continue;
    for (const ext of exts) {
      const candidate = path.join(
        dir,
        process.platform === "win32" && !bin.toLowerCase().endsWith(ext.toLowerCase())
          ? bin + ext
          : bin,
      );
      try {
        if (fs.existsSync(candidate)) return true;
      } catch {
        /* ignore */
      }
    }
  }
  // Also check default install locations explicitly
  const home = os.homedir();
  const exe = process.platform === "win32" ? "grok.exe" : "grok";
  for (const c of [
    path.join(home, ".grok", "bin", exe),
    path.join(home, ".local", "bin", "grok"),
  ]) {
    try {
      if (fs.existsSync(c)) return true;
    } catch {
      /* ignore */
    }
  }
  return false;
}

/**
 * Build env for child `grok` processes so they match CLI behaviour:
 * same HOME, GROK_HOME, auth, skills, MCP config, and a usable PATH.
 *
 * @param {Record<string, string | undefined>} [extra]
 */
export function buildGrokEnv(extra = {}) {
  const home = os.homedir();
  const grokHome = grokHomeDir();
  const binDir = path.join(grokHome, "bin");
  const pathSep = process.platform === "win32" ? ";" : ":";
  const extras = [
    binDir,
    path.join(home, ".local", "bin"),
    path.join(home, ".cargo", "bin"),
    // Windows: Git for Windows before thin GUI / WSL PATH entries
    ...windowsGitPathDirs(),
    "/usr/local/bin",
    "/opt/homebrew/bin",
    "/usr/bin",
    "/bin",
  ];

  const current = process.env.PATH || process.env.Path || "";
  const parts = [...extras, ...current.split(pathSep).filter(Boolean)];
  const seen = new Set();
  const pathValue = parts
    .filter((p) => {
      if (!p || seen.has(p)) return false;
      seen.add(p);
      return true;
    })
    .join(pathSep);

  /** @type {Record<string, string | undefined>} */
  const env = {
    ...process.env,
    HOME: process.env.HOME || home,
    USERPROFILE: process.env.USERPROFILE || home,
    GROK_HOME: process.env.GROK_HOME || grokHome,
    PATH: pathValue,
    Path: pathValue,
    ...extra,
  };

  // Drop empty overrides
  for (const k of Object.keys(extra)) {
    if (extra[k] === undefined || extra[k] === "") delete env[k];
  }

  return env;
}

export function authJsonPath() {
  return path.join(grokHomeDir(), "auth.json");
}

export function configTomlPath() {
  return path.join(grokHomeDir(), "config.toml");
}
