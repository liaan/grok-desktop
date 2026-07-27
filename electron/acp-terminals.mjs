/**
 * ACP client-side terminals (agent → client).
 * Spec: https://agentclientprotocol.com/protocol/v1/terminals
 *
 * Methods: terminal/create | output | wait_for_exit | kill | release
 *
 * Critical: the Grok agent often packs a full shell line as `command` with
 * empty or bogus `args` (e.g. command = `/bin/bash -lc 'git status'`).
 * Spawning that string as an executable → ENOENT. Always normalize to argv.
 */
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildGrokEnv } from "./grok-home.mjs";

const DEFAULT_OUTPUT_BYTE_LIMIT = 1_048_576; // 1 MiB
const KILL_ESCALATE_MS = 1500;

/**
 * @typedef {{
 *   id: string,
 *   sessionId: string,
 *   proc: import('node:child_process').ChildProcess | null,
 *   pid: number | null,
 *   output: string,
 *   truncated: boolean,
 *   outputByteLimit: number,
 *   exitCode: number | null,
 *   signal: string | null,
 *   exited: boolean,
 *   waiters: Array<(status: { exitCode: number | null, signal: string | null }) => void>,
 *   command: string,
 *   args: string[],
 *   cwd: string,
 * }} ManagedTerminal
 */

function bashPath() {
  if (process.platform === "win32") return "bash";
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
  if (process.platform === "win32") return "sh";
  return fs.existsSync("/bin/sh") ? "/bin/sh" : "sh";
}

/**
 * Strip matching outer quotes from a shell script payload.
 * @param {string} s
 */
function stripOuterQuotes(s) {
  const t = s.trim();
  if (t.length >= 2) {
    const a = t[0];
    const b = t[t.length - 1];
    if ((a === "'" && b === "'") || (a === '"' && b === '"')) {
      return t.slice(1, -1);
    }
  }
  return t;
}

/**
 * If `command` is a full shell invocation line, return { shell, flag, script }.
 * Matches what the Grok agent packs: `/bin/bash -lc 'git status'`
 * @param {string} command
 * @returns {{ shell: string, flag: string, script: string } | null}
 */
function parseEmbeddedShellLine(command) {
  const c = command.trim();
  // /bin/bash -lc '…' | bash -c "…" | /bin/sh -c … | bash -l -c '…'
  const m = c.match(
    /^(?:\/usr)?(?:\/bin\/)?(bash|sh|zsh)((?:\s+-[lcp]+)+)\s+([\s\S]+)$/i,
  );
  if (!m) return null;
  const shellName = m[1].toLowerCase();
  const flagTokens = m[2].trim().split(/\s+/);
  const script = stripOuterQuotes(m[3]);
  const joined = flagTokens.join("");
  const flag = /c/i.test(joined) ? (/l/i.test(joined) ? "-lc" : "-c") : "-lc";
  const shell =
    shellName === "bash"
      ? bashPath()
      : shellName === "zsh"
        ? process.platform === "win32"
          ? "zsh"
          : fs.existsSync("/bin/zsh")
            ? "/bin/zsh"
            : "zsh"
        : shPath();
  return { shell, flag, script };
}

/**
 * Normalize agent packing into a safe spawn argv.
 * Never returns a multi-word string as the executable path.
 *
 * @param {string} command
 * @param {string[]} argsIn
 * @returns {{ execCommand: string, args: string[], useShell: boolean }}
 */
export function normalizeTerminalSpawn(command, argsIn) {
  const isWin = process.platform === "win32";
  const bash = bashPath();
  const args = Array.isArray(argsIn)
    ? argsIn.map(String).filter((a) => a.length > 0)
    : [];

  // 1) Full shell line stuffed into `command` (with or without extra args)
  const embedded = parseEmbeddedShellLine(command);
  if (embedded) {
    // If agent also passed the script as args, prefer embedded script
    return {
      execCommand: embedded.shell,
      args: [embedded.flag, embedded.script],
      useShell: false,
    };
  }

  // 2) command is a single token, args are real argv
  if (args.length > 0 && !/\s/.test(command)) {
    return {
      execCommand: command,
      args,
      // Windows needs shell for .cmd shims (npm, etc.)
      useShell: isWin,
    };
  }

  // 3) command has spaces OR metacharacters → always bash -lc (never spawn as path)
  if (/\s/.test(command) || /[|&;<>$`"'\\]/.test(command) || args.length > 0) {
    const script =
      args.length > 0 ? [command, ...args].join(" ") : command;
    return {
      execCommand: bash,
      args: ["-lc", script],
      useShell: false,
    };
  }

  // 4) Simple single-token command (e.g. "ls", "git")
  return {
    execCommand: command,
    args: [],
    useShell: isWin,
  };
}

/** Kill a pid (and process group on Unix) without relying on ChildProcess state. */
function killPidTree(pid, signal) {
  if (!pid) return;
  if (process.platform === "win32") {
    try {
      spawn("taskkill", ["/pid", String(pid), "/T", "/F"], {
        stdio: "ignore",
        windowsHide: true,
      });
    } catch {
      /* ignore */
    }
    return;
  }
  try {
    process.kill(-pid, signal);
  } catch {
    try {
      process.kill(pid, signal);
    } catch {
      /* ignore */
    }
  }
}

function resolveCwd(requested, fallback) {
  const candidates = [
    requested,
    fallback,
    process.cwd(),
    os.homedir(),
  ].filter((p) => typeof p === "string" && p.trim());

  for (const c of candidates) {
    const abs = path.isAbsolute(c) ? c : path.resolve(c);
    try {
      if (fs.existsSync(abs) && fs.statSync(abs).isDirectory()) {
        return abs;
      }
    } catch {
      /* try next */
    }
  }
  return os.homedir();
}

export class AcpTerminalManager extends EventEmitter {
  constructor({ defaultCwd } = {}) {
    super();
    /** @type {Map<string, ManagedTerminal>} */
    this.terminals = new Map();
    this.defaultCwd = defaultCwd || process.cwd();
  }

  setDefaultCwd(cwd) {
    if (cwd) this.defaultCwd = cwd;
  }

  /**
   * @param {{
   *   sessionId: string,
   *   command: string,
   *   args?: string[],
   *   env?: Array<{ name: string, value: string }>,
   *   cwd?: string | null,
   *   outputByteLimit?: number | null,
   * }} params
   */
  create(params) {
    const command = params?.command;
    if (!command || typeof command !== "string") {
      throw Object.assign(new Error("terminal/create: command is required"), {
        code: -32602,
      });
    }

    const rawArgs = Array.isArray(params.args) ? params.args.map(String) : [];

    if (params.cwd != null && String(params.cwd).trim()) {
      if (!path.isAbsolute(String(params.cwd).trim())) {
        throw Object.assign(
          new Error("terminal/create: cwd must be an absolute path"),
          { code: -32602 },
        );
      }
    }

    const cwd = resolveCwd(
      typeof params.cwd === "string" ? params.cwd.trim() : null,
      this.defaultCwd,
    );

    const limit =
      typeof params.outputByteLimit === "number" && params.outputByteLimit >= 0
        ? params.outputByteLimit
        : DEFAULT_OUTPUT_BYTE_LIMIT;

    // GUI apps (macOS Dock) get a thin PATH — use the same enrichment as agent spawn
    /** @type {Record<string, string | undefined>} */
    const envExtra = {};
    if (Array.isArray(params.env)) {
      for (const entry of params.env) {
        if (entry?.name == null) continue;
        const key = String(entry.name);
        if (/^(LD_PRELOAD|DYLD_INSERT_LIBRARIES|DYLD_LIBRARY_PATH)$/i.test(key)) {
          continue;
        }
        envExtra[key] = String(entry.value ?? "");
      }
    }
    const env = buildGrokEnv(envExtra);

    let { execCommand, args, useShell } = normalizeTerminalSpawn(
      command,
      rawArgs,
    );

    // Safety: never spawn a multi-word string as the executable
    if (/\s/.test(execCommand)) {
      const fixed = normalizeTerminalSpawn(execCommand, args);
      execCommand = fixed.execCommand;
      args = fixed.args;
      useShell = fixed.useShell;
      if (/\s/.test(execCommand)) {
        // Last resort
        execCommand = bashPath();
        args = ["-lc", command];
        useShell = false;
      }
    }

    const id = `term_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
    /** @type {ManagedTerminal} */
    const term = {
      id,
      sessionId: params.sessionId || "",
      proc: null,
      pid: null,
      output: "",
      truncated: false,
      outputByteLimit: limit,
      exitCode: null,
      signal: null,
      exited: false,
      waiters: [],
      command: execCommand,
      args,
      cwd,
    };

    const spawnOnce = (file, fileArgs, shell) =>
      spawn(file, fileArgs, {
        cwd,
        env,
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
        shell,
        // detached process groups are fragile under Electron; keep attached
        detached: false,
      });

    let proc;
    try {
      proc = spawnOnce(execCommand, args, useShell);
    } catch (err) {
      throw Object.assign(
        new Error(`terminal/create failed: ${err?.message || err}`),
        { code: -32000 },
      );
    }

    term.proc = proc;
    term.pid = proc.pid ?? null;
    this.terminals.set(id, term);

    const onChunk = (buf) => {
      this._append(term, buf.toString("utf8"));
      this.emit("output", {
        terminalId: id,
        sessionId: term.sessionId,
        output: term.output,
        truncated: term.truncated,
        exited: term.exited,
      });
    };

    const attachProcess = (child, label) => {
      child.stdout?.on("data", onChunk);
      child.stderr?.on("data", onChunk);

      child.on("error", (err) => {
        // Only the active process may finish the terminal
        if (term.proc !== child) return;

        // ENOENT: retry once via absolute bash -lc (common GUI-packaging failure)
        if (err?.code === "ENOENT" && !term._retried) {
          term._retried = true;
          try {
            const script =
              rawArgs.length > 0
                ? [command, ...rawArgs].join(" ")
                : command;
            const retry = spawnOnce(bashPath(), ["-lc", script], false);
            term.proc = retry;
            term.pid = retry.pid ?? null;
            term.command = bashPath();
            term.args = ["-lc", script];
            attachProcess(retry, "retry");
            return;
          } catch (err2) {
            this._append(
              term,
              `\n[spawn error] ${err.message}; retry failed: ${err2?.message || err2}\n` +
                `(exec=${execCommand} args=${JSON.stringify(args)}; cwd=${cwd})\n`,
            );
            this._markExited(term, 1, null);
            return;
          }
        }

        this._append(
          term,
          `\n[spawn error] ${err.message}\n` +
            `(${label}: exec=${term.command} args=${JSON.stringify(term.args)}; cwd=${cwd})\n`,
        );
        this._markExited(term, 1, null);
      });

      child.on("close", (code, signal) => {
        if (term.proc !== child) return;
        this._markExited(
          term,
          typeof code === "number" ? code : null,
          signal ? String(signal) : null,
        );
      });
    };

    attachProcess(proc, "initial");

    this.emit("created", {
      terminalId: id,
      sessionId: term.sessionId,
      command: execCommand,
      args,
      cwd,
    });

    return { terminalId: id };
  }

  /**
   * @param {{ sessionId?: string, terminalId: string }} params
   */
  output(params) {
    const term = this._require(params?.terminalId, params?.sessionId);
    const result = {
      output: term.output,
      truncated: term.truncated,
    };
    if (term.exited) {
      result.exitStatus = {
        exitCode: term.exitCode,
        signal: term.signal,
      };
    }
    return result;
  }

  /**
   * @param {{ sessionId?: string, terminalId: string }} params
   * @returns {Promise<{ exitCode: number | null, signal: string | null }>}
   */
  waitForExit(params) {
    const term = this._require(params?.terminalId, params?.sessionId);
    if (term.exited) {
      return Promise.resolve({
        exitCode: term.exitCode,
        signal: term.signal,
      });
    }
    return new Promise((resolve) => {
      term.waiters.push(resolve);
    });
  }

  /**
   * @param {{ sessionId?: string, terminalId: string }} params
   */
  kill(params) {
    const term = this._require(params?.terminalId, params?.sessionId);
    this._killProcess(term, { escalate: true });
    return {};
  }

  /**
   * @param {{ sessionId?: string, terminalId: string }} params
   */
  release(params) {
    const term = this.terminals.get(params?.terminalId);
    if (!term) {
      return {};
    }
    if (
      params?.sessionId &&
      term.sessionId &&
      params.sessionId !== term.sessionId
    ) {
      throw Object.assign(
        new Error(
          `terminal/release: sessionId mismatch for ${params.terminalId}`,
        ),
        { code: -32602 },
      );
    }
    this._killProcess(term, { escalate: true });
    if (!term.exited) {
      this._markExited(term, term.exitCode, term.signal ?? "SIGTERM");
    }
    this.terminals.delete(term.id);
    this.emit("released", { terminalId: term.id, sessionId: term.sessionId });
    return {};
  }

  snapshot(terminalId) {
    const term = this.terminals.get(terminalId);
    if (!term) return null;
    return {
      terminalId: term.id,
      sessionId: term.sessionId,
      command: term.command,
      args: term.args,
      cwd: term.cwd,
      output: term.output,
      truncated: term.truncated,
      exited: term.exited,
      exitCode: term.exitCode,
      signal: term.signal,
    };
  }

  disposeAll() {
    for (const id of [...this.terminals.keys()]) {
      try {
        this.release({ terminalId: id });
      } catch {
        /* ignore */
      }
    }
    this.terminals.clear();
  }

  /**
   * @param {string} terminalId
   * @param {string} [sessionId]
   */
  _require(terminalId, sessionId) {
    const term = this.terminals.get(terminalId);
    if (!term) {
      throw Object.assign(
        new Error(`Unknown terminalId: ${terminalId || "(missing)"}`),
        { code: -32602 },
      );
    }
    if (sessionId && term.sessionId && sessionId !== term.sessionId) {
      throw Object.assign(
        new Error(`terminal: sessionId mismatch for ${terminalId}`),
        { code: -32602 },
      );
    }
    return term;
  }

  /**
   * @param {ManagedTerminal} term
   * @param {string} chunk
   */
  _append(term, chunk) {
    if (!chunk) return;
    term.output += chunk;
    const limit = term.outputByteLimit;
    if (limit === 0) {
      if (term.output.length > 0) {
        term.output = "";
        term.truncated = true;
      }
      return;
    }
    if (limit == null || limit < 0) return;

    const byteLen = Buffer.byteLength(term.output, "utf8");
    if (byteLen <= limit) return;

    term.truncated = true;
    const buf = Buffer.from(term.output, "utf8");
    let start = byteLen - limit;
    while (start < buf.length && (buf[start] & 0xc0) === 0x80) {
      start += 1;
    }
    term.output = buf.subarray(start).toString("utf8");
  }

  /**
   * @param {ManagedTerminal} term
   * @param {number | null} exitCode
   * @param {string | null} signal
   */
  _markExited(term, exitCode, signal) {
    if (term.exited) return;
    term.exited = true;
    term.exitCode = exitCode;
    term.signal = signal;
    term.proc = null;
    const status = { exitCode, signal };
    const waiters = term.waiters.splice(0, term.waiters.length);
    for (const w of waiters) w(status);
    this.emit("exit", {
      terminalId: term.id,
      sessionId: term.sessionId,
      ...status,
      output: term.output,
      truncated: term.truncated,
    });
  }

  /**
   * @param {ManagedTerminal} term
   * @param {{ escalate?: boolean }} [opts]
   */
  _killProcess(term, opts = {}) {
    const proc = term.proc;
    if (!proc || term.exited) return;

    const pid = term.pid || proc.pid || null;
    if (pid) term.pid = pid;

    if (!pid) {
      try {
        proc.kill("SIGTERM");
      } catch {
        /* ignore */
      }
      return;
    }

    if (process.platform === "win32") {
      killPidTree(pid, "SIGKILL");
      return;
    }

    try {
      proc.kill("SIGTERM");
    } catch {
      killPidTree(pid, "SIGTERM");
    }

    if (opts.escalate !== false) {
      const escalatePid = pid;
      setTimeout(() => {
        killPidTree(escalatePid, "SIGKILL");
      }, KILL_ESCALATE_MS).unref?.();
    }
  }
}
