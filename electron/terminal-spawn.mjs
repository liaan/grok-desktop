/**
 * ACP terminal spawn planning — quote-safe argv + multi-line temp scripts.
 *
 * AcpTerminalManager only executes the plan (sandbox + child_process.spawn).
 *
 * Policy (see shell-argv.mjs):
 *   - Prefer real argv when possible.
 *   - Tokenize packed shell lines; never regex-strip outer quotes.
 *   - Freeform / multi-line → bash -lc body, then materialize multi-line to a file.
 *   - Never spawn multi-line as argv0 or as bare `bash <script-as-filename>`.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { windowsGitBashPath } from "./grok-home.mjs";
import {
  extractShellCInvocation,
  looksLikeScriptBody,
  shellBaseName,
  shellJoin,
  shellSplit,
} from "./shell-argv.mjs";

/**
 * Resolve bash for host tool shells.
 * @returns {string}
 */
export function bashPath() {
  if (process.platform === "win32") {
    const gitBash = windowsGitBashPath();
    if (gitBash) return gitBash;
    return "bash";
  }
  for (const p of ["/bin/bash", "/usr/bin/bash"]) {
    try {
      if (fs.existsSync(p)) return p;
    } catch {
      /* ignore */
    }
  }
  return "/bin/bash";
}

function shPath() {
  if (process.platform === "win32") {
    const bash = bashPath();
    if (bash !== "bash" && bash.toLowerCase().endsWith("bash.exe")) {
      const sh = path.join(path.dirname(bash), "sh.exe");
      try {
        if (fs.existsSync(sh)) return sh;
      } catch {
        /* ignore */
      }
    }
    return "sh";
  }
  return fs.existsSync("/bin/sh") ? "/bin/sh" : "sh";
}

/**
 * @param {string} shellName
 */
function resolveShellExec(shellName) {
  const n = String(shellName || "bash").toLowerCase();
  if (n === "bash") return bashPath();
  if (n === "zsh") {
    if (process.platform === "win32") return "zsh";
    return fs.existsSync("/bin/zsh") ? "/bin/zsh" : "zsh";
  }
  return shPath();
}

/**
 * @param {string} command
 */
function isSimpleExecToken(command) {
  const c = String(command ?? "");
  if (!c || /\s/.test(c)) return false;
  if (/[|&;<>$`"']/.test(c)) return false;
  return true;
}

/**
 * @param {string} script
 * @returns {{ execCommand: string, args: string[], useShell: boolean }}
 */
function spawnViaBashLc(script) {
  return {
    execCommand: bashPath(),
    args: ["-lc", String(script)],
    useShell: false,
  };
}

/**
 * Join freeform pieces without shellEscape-wrapping multi-line bodies.
 * @param {string} cmd
 * @param {string[]} args
 */
export function freeformScript(cmd, args) {
  if (!args.length) return String(cmd);
  if (looksLikeScriptBody(cmd)) {
    return `${cmd}\n${shellJoin(args)}`;
  }
  if (args.some(looksLikeScriptBody)) {
    return [cmd, ...args].filter((s) => String(s).length > 0).join("\n");
  }
  return `${cmd} ${shellJoin(args)}`.trim();
}

/**
 * Write multi-line script under project cwd when possible so Docker/bwrap
 * sandboxes (project bind only; empty /tmp) can still see the file.
 * Falls back to os.tmpdir() when no cwd is available (macOS Seatbelt allows TMPDIR).
 *
 * @param {string} script
 * @param {{ login?: boolean, cwd?: string | null }} [opts]
 * @returns {{ execCommand: string, args: string[], useShell: boolean, cleanup: () => void }}
 */
export function materializeMultilineScript(script, opts = {}) {
  const login = Boolean(opts.login);
  const cwd = opts.cwd ? String(opts.cwd) : "";
  let parent;
  if (cwd) {
    try {
      if (fs.existsSync(cwd) && fs.statSync(cwd).isDirectory()) {
        parent = path.join(cwd, ".grok-desktop", "term-scripts");
        fs.mkdirSync(parent, { recursive: true });
      }
    } catch {
      parent = null;
    }
  }
  if (!parent) {
    parent = path.join(os.tmpdir(), "grok-term");
    try {
      fs.mkdirSync(parent, { recursive: true });
    } catch {
      /* ignore */
    }
  }
  const dir = fs.mkdtempSync(path.join(parent, "run-"));
  const file = path.join(dir, "run.sh");
  let body = String(script);
  if (!body.endsWith("\n")) body += "\n";
  fs.writeFileSync(file, body, { encoding: "utf8", mode: 0o700 });
  const cleanup = () => {
    try {
      fs.unlinkSync(file);
    } catch {
      /* ignore */
    }
    try {
      fs.rmdirSync(dir);
    } catch {
      /* ignore */
    }
  };
  return {
    execCommand: bashPath(),
    args: login ? ["-l", file] : [file],
    useShell: false,
    cleanup,
  };
}

/**
 * @param {{ execCommand: string, args: string[], useShell: boolean }} norm
 * @param {{ cwd?: string | null }} [opts]
 * @returns {{ execCommand: string, args: string[], useShell: boolean, cleanup?: () => void }}
 */
export function maybeMaterializeScriptSpawn(norm, opts = {}) {
  const args = Array.isArray(norm.args) ? norm.args.map(String) : [];
  const cIdx = args.findIndex((a) => a === "-lc" || a === "-c" || a === "-cl");
  if (cIdx < 0 || args[cIdx + 1] == null) return norm;
  const script = args[cIdx + 1];
  if (!looksLikeScriptBody(script)) return norm;
  const login = args[cIdx].includes("l");
  const mat = materializeMultilineScript(script, {
    login,
    cwd: opts.cwd,
  });
  return {
    execCommand: mat.execCommand,
    args: mat.args,
    useShell: false,
    cleanup: mat.cleanup,
  };
}

/**
 * Normalize agent packing into a safe spawn argv (no temp files yet).
 *
 * @param {string} command
 * @param {string[]} argsIn
 * @returns {{ execCommand: string, args: string[], useShell: boolean }}
 */
export function normalizeTerminalSpawn(command, argsIn) {
  const isWin = process.platform === "win32";
  const rawCmd = String(command ?? "");
  const cmd = looksLikeScriptBody(rawCmd)
    ? rawCmd.replace(/^\uFEFF/, "")
    : rawCmd.trim();
  const args = Array.isArray(argsIn)
    ? argsIn.map(String).filter((a) => a.length > 0)
    : [];

  if (looksLikeScriptBody(cmd) && args.length === 0) {
    return spawnViaBashLc(cmd);
  }
  if (looksLikeScriptBody(cmd) && args.length > 0) {
    return spawnViaBashLc(freeformScript(cmd, args));
  }

  if (args.length > 0 && isSimpleExecToken(cmd)) {
    const asShell = extractShellCInvocation([cmd, ...args]);
    if (asShell) {
      return {
        execCommand: resolveShellExec(asShell.shellName),
        args: [asShell.flag, asShell.script],
        useShell: false,
      };
    }
    const base = shellBaseName(cmd);
    if (
      ["bash", "sh", "zsh"].includes(base) &&
      args.length === 1 &&
      looksLikeScriptBody(args[0])
    ) {
      return {
        execCommand: resolveShellExec(base),
        args: ["-lc", args[0]],
        useShell: false,
      };
    }
    return {
      execCommand: cmd,
      args,
      useShell: isWin,
    };
  }

  if (cmd) {
    const words = shellSplit(cmd);

    if (words && words.length >= 2) {
      const extracted = extractShellCInvocation(words);
      if (extracted) {
        if (args.length === 0) {
          return {
            execCommand: resolveShellExec(extracted.shellName),
            args: [extracted.flag, extracted.script],
            useShell: false,
          };
        }
        return spawnViaBashLc(freeformScript(cmd, args));
      }

      // Agent packing: command="bash -lc" / "/bin/bash -c", args=["script body"]
      // extractShellCInvocation fails (no script word); glue script from args.
      if (args.length === 1) {
        const glued = extractShellCInvocation([...words, args[0]]);
        if (glued) {
          return {
            execCommand: resolveShellExec(glued.shellName),
            args: [glued.flag, glued.script],
            useShell: false,
          };
        }
      }
    }

    if (
      !words ||
      words.length > 1 ||
      /[|&;<>$`"'\\]/.test(cmd) ||
      args.length > 0
    ) {
      if (args.length > 0) {
        return spawnViaBashLc(freeformScript(cmd, args));
      }
      return spawnViaBashLc(cmd);
    }

    return {
      execCommand: words[0] || cmd,
      args: [],
      useShell: isWin,
    };
  }

  if (args.length > 0) {
    if (args.length === 1 && looksLikeScriptBody(args[0])) {
      return spawnViaBashLc(args[0]);
    }
    if (args.some(looksLikeScriptBody)) {
      return spawnViaBashLc(args.join("\n"));
    }
    return spawnViaBashLc(shellJoin(args));
  }

  return spawnViaBashLc("true");
}

/**
 * Single entry: normalize agent packing → materialize multi-line → ready argv.
 *
 * @param {string} command
 * @param {string[]} [argsIn]
 * @param {{ fallbackCommand?: string, cwd?: string | null }} [opts]
 * @returns {{
 *   execCommand: string,
 *   args: string[],
 *   useShell: boolean,
 *   cleanup: (() => void) | null,
 * }}
 */
export function resolveSpawnPlan(command, argsIn = [], opts = {}) {
  let { execCommand, args, useShell } = normalizeTerminalSpawn(
    command,
    argsIn,
  );

  if (/\s/.test(execCommand) || looksLikeScriptBody(execCommand)) {
    const fixed = normalizeTerminalSpawn(execCommand, args);
    execCommand = fixed.execCommand;
    args = fixed.args;
    useShell = fixed.useShell;
    if (/\s/.test(execCommand) || looksLikeScriptBody(execCommand)) {
      const fb = opts.fallbackCommand != null ? opts.fallbackCommand : command;
      execCommand = bashPath();
      args = ["-lc", String(fb)];
      useShell = false;
    }
  }

  const mat = maybeMaterializeScriptSpawn(
    { execCommand, args, useShell },
    { cwd: opts.cwd },
  );

  return {
    execCommand: mat.execCommand,
    args: mat.args,
    useShell: mat.useShell,
    cleanup: typeof mat.cleanup === "function" ? mat.cleanup : null,
  };
}

/**
 * ENOENT retry plan from original freeform packing.
 * @param {string} command
 * @param {string[]} rawArgs
 * @param {{ cwd?: string | null }} [opts]
 */
export function resolveRetrySpawnPlan(command, rawArgs = [], opts = {}) {
  const script =
    rawArgs.length > 0
      ? freeformScript(command, rawArgs.map(String))
      : command;
  if (looksLikeScriptBody(script)) {
    const mat = materializeMultilineScript(script, {
      login: true,
      cwd: opts.cwd,
    });
    return {
      execCommand: mat.execCommand,
      args: mat.args,
      useShell: false,
      cleanup: mat.cleanup,
    };
  }
  return {
    execCommand: bashPath(),
    args: ["-lc", script],
    useShell: false,
    cleanup: null,
  };
}
