/**
 * ACP client-side terminals (agent → client).
 * Spec: https://agentclientprotocol.com/protocol/v1/terminals
 *
 * Methods: terminal/create | output | wait_for_exit | kill | release
 *
 * Spawn argv planning lives in terminal-spawn.mjs (normalize + multi-line files).
 * This module owns process lifecycle, output buffer, and sandbox hookup.
 */
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import path from "node:path";
import { buildGrokEnv } from "./grok-home.mjs";
import { resolveProjectPath } from "./path-safety.mjs";
import {
  resolveRetrySpawnPlan,
  resolveSpawnPlan,
} from "./terminal-spawn.mjs";
// Re-export for tests that import from acp-terminals historically
export {
  materializeMultilineScript,
  maybeMaterializeScriptSpawn,
  normalizeTerminalSpawn,
  resolveSpawnPlan,
} from "./terminal-spawn.mjs";
import { planSandboxedSpawn } from "./terminal-sandbox.mjs";
import { debugLog } from "./debug-log.mjs";

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
 *   cleanup?: (() => void) | null,
 *   sandboxBackend?: string | null,
 * }} ManagedTerminal
 */

/**
 * Env so agent tool shells never block on editors / credential TTY prompts.
 * ACP terminals use stdin "ignore" — interactive git/gpg hangs forever ("pending").
 * @param {Record<string, string | undefined>} env
 */
function applyNonInteractiveToolEnv(env) {
  const defaults = {
    GIT_EDITOR: "true",
    EDITOR: "true",
    VISUAL: "true",
    GIT_TERMINAL_PROMPT: "0",
    GCM_INTERACTIVE: "never",
    GIT_PAGER: "cat",
    PAGER: "cat",
    GIT_SSH_COMMAND: "ssh -o BatchMode=yes -o StrictHostKeyChecking=yes -o ConnectTimeout=15",
    GPG_TTY: "",
  };
  for (const [k, v] of Object.entries(defaults)) {
    if (env[k] == null || env[k] === "") env[k] = v;
  }
  return env;
}

/**
 * Run and clear a terminal's optional post-spawn cleanup (e.g. temp files).
 * @param {{ cleanup?: (() => void) | null }} term
 */
function runTermCleanup(term) {
  if (typeof term.cleanup !== "function") return;
  try {
    term.cleanup();
  } catch {
    /* ignore */
  }
  term.cleanup = null;
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

/**
 * Pick an existing directory for terminal cwd.
 * When `allowOutside` is false, never fall back to process.cwd() / homedir —
 * those sit outside the project and would only surface as a confusing gate error.
 * @param {string | null | undefined} requested
 * @param {string} fallback Session/project default cwd
 * @param {{ allowOutside?: boolean }} [opts]
 * @returns {string}
 */
function resolveCwd(requested, fallback, opts = {}) {
  const allowOutside = Boolean(opts.allowOutside);
  const candidates = [requested, fallback].filter(
    (p) => typeof p === "string" && p.trim(),
  );
  if (allowOutside) {
    candidates.push(process.cwd(), os.homedir());
  }

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

  // Prefer session cwd even if missing (gate / spawn will error clearly)
  if (fallback && String(fallback).trim()) {
    return path.resolve(fallback);
  }
  if (allowOutside) return os.homedir();
  throw Object.assign(
    new Error("terminal/create: no usable cwd under the open project"),
    { code: -32000 },
  );
}

export class AcpTerminalManager extends EventEmitter {
  constructor({
    defaultCwd,
    allowOutsideProject = false,
    /** When true (default), wrap tool shells in an OS FS jail */
    sandboxTerminal = true,
  } = {}) {
    super();
    /** @type {Map<string, ManagedTerminal>} */
    this.terminals = new Map();
    this.defaultCwd = defaultCwd || process.cwd();
    this.allowOutsideProject = Boolean(allowOutsideProject);
    this.sandboxTerminal = sandboxTerminal !== false;
  }

  setDefaultCwd(cwd) {
    if (cwd) this.defaultCwd = cwd;
  }

  setAllowOutsideProject(value) {
    this.allowOutsideProject = Boolean(value);
  }

  setSandboxTerminal(value) {
    this.sandboxTerminal = Boolean(value);
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

    let cwd = resolveCwd(
      typeof params.cwd === "string" ? params.cwd.trim() : null,
      this.defaultCwd,
      { allowOutside: this.allowOutsideProject },
    );

    // Safety gate: terminal cwd must stay under session/project cwd unless allowed
    try {
      cwd = resolveProjectPath(this.defaultCwd, cwd, {
        allowOutside: this.allowOutsideProject,
      });
    } catch (err) {
      throw Object.assign(
        new Error(
          err?.message ||
            "terminal/create: cwd is outside the open project (enable “Allow outside project” in the sidebar to override)",
        ),
        { code: err?.code ?? -32000 },
      );
    }

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
    const env = applyNonInteractiveToolEnv(buildGrokEnv(envExtra));

    const planned = resolveSpawnPlan(command, rawArgs, {
      fallbackCommand: command,
      cwd,
    });
    const execCommand = planned.execCommand;
    const args = planned.args;
    const useShell = planned.useShell;

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
      cleanup: planned.cleanup,
      sandboxBackend: null,
    };

    /**
     * Single spawn site. Sandbox off → identity plan; sandbox on → OS jail.
     * Fail closed when sandbox is enabled but the backend cannot plan a spawn.
     * @param {string} file
     * @param {string[]} fileArgs
     * @param {boolean} shell
     */
    const spawnOnce = (file, fileArgs, shell) => {
      // Do NOT runTermCleanup here — multi-line temp scripts must stay on disk
      // until the process exits. Retry paths clear cleanup explicitly first.
      const plan = this.sandboxTerminal
        ? planSandboxedSpawn({
            file,
            fileArgs,
            shell,
            cwd,
            env,
            projectRoot: this.defaultCwd,
          })
        : {
            file,
            fileArgs,
            shell,
            cwd,
            env,
            backend: null,
          };
      term.sandboxBackend = plan.backend || null;
      term._spawnPlan = {
        file: plan.file,
        fileArgs: (plan.fileArgs || []).map((a) => String(a).slice(0, 160)),
        cwd: plan.cwd,
        backend: plan.backend,
      };
      if (typeof plan.cleanup === "function") {
        // Compose sandbox temp cleanup with multi-line script cleanup
        const prev = term.cleanup;
        const sand = plan.cleanup;
        term.cleanup = () => {
          try {
            sand();
          } catch {
            /* ignore */
          }
          try {
            prev?.();
          } catch {
            /* ignore */
          }
        };
      }
      return spawn(plan.file, plan.fileArgs, {
        cwd: plan.cwd,
        env: plan.env,
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
        shell: plan.shell,
        detached: false,
      });
    };

    let proc;
    try {
      proc = spawnOnce(execCommand, args, useShell);
    } catch (err) {
      runTermCleanup(term);
      debugLog("terminal", "create-failed", {
        message: err?.message || String(err),
        command: execCommand,
        cwd,
        sandbox: this.sandboxTerminal,
      });
      throw Object.assign(
        new Error(`terminal/create failed: ${err?.message || err}`),
        { code: err?.code ?? -32000 },
      );
    }

    term.proc = proc;
    term.pid = proc.pid ?? null;
    this.terminals.set(id, term);

    // Safety net: Docker/WSL tool shells that never exit leave UI on in_progress.
    // Default 15 minutes; override with GROK_DESKTOP_TERMINAL_TIMEOUT_MS (0 = off).
    const timeoutMs = Number(
      process.env.GROK_DESKTOP_TERMINAL_TIMEOUT_MS ?? 15 * 60_000,
    );
    if (Number.isFinite(timeoutMs) && timeoutMs > 0) {
      term._timeout = setTimeout(() => {
        if (term.exited) return;
        debugLog("terminal", "timeout-kill", {
          terminalId: id,
          timeoutMs,
          backend: term.sandboxBackend,
          command: term.command,
        });
        this._append(
          term,
          `\n[timeout] tool shell exceeded ${Math.round(timeoutMs / 1000)}s — killed\n`,
        );
        try {
          if (term.pid) killPidTree(term.pid, "SIGKILL");
        } catch {
          /* ignore */
        }
        this._markExited(term, 124, "TIMEOUT");
      }, timeoutMs);
      if (typeof term._timeout.unref === "function") term._timeout.unref();
    }

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

        // ENOENT: retry once via absolute bash (common GUI-packaging failure)
        if (err?.code === "ENOENT" && !term._retried) {
          term._retried = true;
          try {
            const retryPlan = resolveRetrySpawnPlan(command, rawArgs, { cwd });
            runTermCleanup(term);
            term.cleanup = retryPlan.cleanup;
            const retry = spawnOnce(
              retryPlan.execCommand,
              retryPlan.args,
              retryPlan.useShell,
            );
            term.proc = retry;
            term.pid = retry.pid ?? null;
            term.command = retryPlan.execCommand;
            term.args = retryPlan.args;
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

    debugLog("terminal", "create", {
      terminalId: id,
      command: execCommand,
      args: args.map((a) => String(a).slice(0, 120)),
      cwd,
      sandbox: this.sandboxTerminal ? term.sandboxBackend || true : false,
      plan: term._spawnPlan || null,
      pid: term.pid,
    });

    this.emit("created", {
      terminalId: id,
      sessionId: term.sessionId,
      command: execCommand,
      args,
      cwd,
      sandbox: this.sandboxTerminal ? term.sandboxBackend || true : false,
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
    if (term._timeout) {
      clearTimeout(term._timeout);
      term._timeout = null;
    }
    runTermCleanup(term);
    const status = { exitCode, signal };
    debugLog("terminal", "exit", {
      terminalId: term.id,
      exitCode,
      signal,
      command: term.command,
      outBytes: term.output?.length || 0,
    });
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
