/**
 * Minimal ACP (Agent Client Protocol) client over `grok agent stdio`.
 * Backbone: Grok Build agent runtime via ACP (same path as other embeds).
 *
 * Skills, MCP servers, plugins, and auth all come from the installed Grok CLI
 * (`~/.grok`). We pass `mcpServers: []` on session/new the same way VS Code /
 * official embeds do — the agent merges config.toml + plugins itself.
 */
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import path from "node:path";
import { agentEnv } from "./auth.mjs";
import { resolveGrokBinary } from "./grok-home.mjs";
import { AcpTerminalManager } from "./acp-terminals.mjs";
import { resolveProjectPath } from "./path-safety.mjs";
import { sessionsRootForCwd } from "./sessions.mjs";
import {
  normalizePermissionMode,
  toAgentPermissionMode,
} from "./permission-mode.mjs";

const DEFAULT_REQUEST_TIMEOUT_MS = 120_000;
const INIT_TIMEOUT_MS = 60_000;
const LOAD_TIMEOUT_MS = 90_000;
/** Client extension methods used by Grok for plan UI / questions (not plain tools). */
const EXT_EXIT_PLAN = "x.ai/exit_plan_mode";
const EXT_ASK_USER = "x.ai/ask_user_question";

export class GrokAcpClient extends EventEmitter {
  constructor({
    cwd,
    grokPath,
    alwaysApprove = false,
    /** ask | auto | always-approve — see permission-mode.mjs */
    permissionMode,
    /** When false (default), ACP fs/* and terminal cwd stay inside project */
    allowOutsideProject = false,
    /** When true (default), wrap ACP tool shells in an OS FS jail */
    sandboxTerminal = true,
    clientVersion = "0.1.2",
  } = {}) {
    super();
    this.cwd = cwd || process.cwd();
    this.grokPath = grokPath || resolveGrokBinary();
    this.permissionMode = normalizePermissionMode(
      permissionMode,
      alwaysApprove,
    );
    /** Client-side auto-respond to session/request_permission */
    this.alwaysApprove = this.permissionMode === "always-approve";
    this.allowOutsideProject = Boolean(allowOutsideProject);
    this.sandboxTerminal = sandboxTerminal !== false;
    this.clientVersion = clientVersion;
    this.proc = null;
    this.rl = null;
    this.nextId = 1;
    /** @type {Map<number, { resolve: Function, reject: Function, timer?: NodeJS.Timeout }>} */
    this.pending = new Map();
    this.sessionId = null;
    this.ready = false;
    this.stderrBuf = "";
    /** @type {Record<string, any>} */
    this.agentCapabilities = {};
    this.terminals = new AcpTerminalManager({
      defaultCwd: this.cwd,
      allowOutsideProject: this.allowOutsideProject,
      sandboxTerminal: this.sandboxTerminal,
    });
    // Forward terminal lifecycle for optional UI live-output later
    for (const ev of ["created", "output", "exit", "released"]) {
      this.terminals.on(ev, (payload) => this.emit(`terminal:${ev}`, payload));
    }
  }

  /**
   * Session store dir for this project + session (where plan.md lives).
   * @returns {string | null}
   */
  sessionDir() {
    if (!this.cwd || !this.sessionId) return null;
    return path.join(sessionsRootForCwd(this.cwd), this.sessionId);
  }

  /**
   * True if absolute path is inside the current CLI session folder.
   * Plan mode writes plan.md there (outside the open project tree).
   * @param {string} abs
   */
  _isUnderSessionDir(abs) {
    const root = this.sessionDir();
    if (!root) return false;
    let realRoot = root;
    let realAbs = abs;
    try {
      realRoot = fs.realpathSync(root);
    } catch {
      /* session dir may not exist yet */
    }
    try {
      realAbs = fs.realpathSync(abs);
    } catch {
      /* write targets may not exist */
    }
    const rel = path.relative(realRoot, realAbs);
    return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
  }

  /**
   * Resolve ACP fs path (relative → project cwd) and optionally sandbox.
   * Always allows the current session directory so plan.md can be written.
   * @param {string} filePath
   */
  _resolveFsPath(filePath) {
    const empty = filePath == null || String(filePath).trim() === "";
    if (empty) {
      throw Object.assign(new Error("Path is required"), { code: -32602 });
    }
    const asStr = String(filePath);
    const abs = path.isAbsolute(asStr)
      ? path.resolve(asStr)
      : path.resolve(this.cwd || process.cwd(), asStr);

    if (this._isUnderSessionDir(abs)) {
      return abs;
    }

    try {
      return resolveProjectPath(this.cwd, filePath, {
        allowOutside: this.allowOutsideProject,
      });
    } catch (err) {
      throw Object.assign(new Error(err?.message || String(err)), {
        code: err?.code ?? -32000,
      });
    }
  }

  /**
   * Spawn agent + initialize. Optionally resume a persisted session (ACP session/load).
   * @param {{ resumeSessionId?: string | null }} [opts]
   */
  async start(opts = {}) {
    if (this.proc) return this;

    const args = ["agent", "stdio"];
    this.proc = spawn(this.grokPath, args, {
      cwd: this.cwd,
      env: agentEnv(),
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });

    this.proc.on("error", (err) => {
      this.emit("error", err);
    });

    this.proc.on("exit", (code, signal) => {
      this.ready = false;
      try {
        this.terminals.disposeAll();
      } catch {
        /* ignore */
      }
      this._rejectAllPending(
        new Error(`Agent exited (code=${code}, signal=${signal})`),
      );
      this.emit("exit", { code, signal });
    });

    this.proc.stderr.on("data", (chunk) => {
      const text = chunk.toString();
      this.stderrBuf += text;
      this.emit("stderr", text);
    });

    this.rl = createInterface({ input: this.proc.stdout });
    this.rl.on("line", (line) => this._onLine(line));

    const init = await this.request(
      "initialize",
      {
        protocolVersion: 1,
        clientInfo: {
          name: "grok-desktop",
          version: this.clientVersion,
        },
        clientCapabilities: {
          fs: { readTextFile: true, writeTextFile: true },
          terminal: true,
        },
      },
      { timeoutMs: INIT_TIMEOUT_MS },
    );
    this.agentCapabilities = init?.agentCapabilities || {};

    if (opts.resumeSessionId) {
      await this.loadSession(opts.resumeSessionId);
    } else {
      await this.newSession();
    }
    return this;
  }

  /**
   * Meta passed on session/new and session/load so the agent starts in the
   * same permission mode the Desktop UI shows.
   */
  _sessionPermissionMeta() {
    const mode = this.permissionMode || "ask";
    return {
      yoloMode: mode === "always-approve",
      permissionMode: toAgentPermissionMode(mode),
    };
  }

  async newSession() {
    // Drop prior chat's processes so /new and session switch don't leak shells
    try {
      this.terminals.disposeAll();
    } catch {
      /* ignore */
    }
    const session = await this.request(
      "session/new",
      {
        cwd: this.cwd,
        mcpServers: [],
        _meta: this._sessionPermissionMeta(),
      },
      { timeoutMs: LOAD_TIMEOUT_MS },
    );
    this.sessionId = session.sessionId;
    this.terminals.setDefaultCwd(this.cwd);
    this.ready = true;
    this.emit("ready", {
      sessionId: this.sessionId,
      cwd: this.cwd,
      grokBinary: this.grokPath,
      resumed: false,
    });
    return this.sessionId;
  }

  /**
   * @param {string} sessionId
   */
  async loadSession(sessionId) {
    if (!sessionId) throw new Error("sessionId required");
    const caps = this.agentCapabilities || {};
    if (caps.loadSession === false) {
      throw new Error("This Grok agent does not support session/load");
    }

    try {
      this.terminals.disposeAll();
    } catch {
      /* ignore */
    }

    const result = await this.request(
      "session/load",
      {
        sessionId,
        cwd: this.cwd,
        mcpServers: [],
        _meta: this._sessionPermissionMeta(),
      },
      { timeoutMs: LOAD_TIMEOUT_MS },
    );

    this.sessionId =
      result?.sessionId || result?._meta?.sessionId || sessionId;
    this.terminals.setDefaultCwd(this.cwd);
    this.ready = true;
    this.emit("ready", {
      sessionId: this.sessionId,
      cwd: this.cwd,
      grokBinary: this.grokPath,
      resumed: true,
    });
    return this.sessionId;
  }

  _rejectAllPending(err) {
    for (const [, p] of this.pending) {
      if (p.timer) clearTimeout(p.timer);
      p.reject(err);
    }
    this.pending.clear();
  }

  _onLine(line) {
    const trimmed = line.trim();
    if (!trimmed) return;
    let msg;
    try {
      msg = JSON.parse(trimmed);
    } catch {
      this.emit("parse-error", trimmed);
      return;
    }

    if (msg.method && msg.id !== undefined && !msg.result && !msg.error) {
      this._handleServerRequest(msg).catch((err) => {
        this._respond(msg.id, null, {
          code: err?.code ?? -32000,
          message: err?.message || String(err),
        });
      });
      return;
    }

    if (msg.method && msg.id === undefined) {
      if (msg.method === "session/update") {
        this.emit("session-update", msg.params);
      } else {
        this.emit("notification", msg);
      }
      return;
    }

    if (msg.id !== undefined && this.pending.has(msg.id)) {
      const p = this.pending.get(msg.id);
      this.pending.delete(msg.id);
      if (p.timer) clearTimeout(p.timer);
      if (msg.error) {
        p.reject(
          Object.assign(new Error(msg.error.message || "ACP error"), msg.error),
        );
      } else {
        p.resolve(msg.result);
      }
    }
  }

  async _handleServerRequest(msg) {
    const { method, params, id } = msg;

    // Grok extension: plan approval popup (must not auto-approve / no-op)
    if (
      method === EXT_EXIT_PLAN ||
      method === "exit_plan_mode" ||
      method?.endsWith("/exit_plan_mode")
    ) {
      await this._handleExitPlanMode(id, params);
      return;
    }

    // Grok extension: multi-choice questions
    if (
      method === EXT_ASK_USER ||
      method === "ask_user_question" ||
      method?.endsWith("/ask_user_question")
    ) {
      await this._handleAskUserQuestion(id, params);
      return;
    }

    if (method === "session/request_permission") {
      const toolName = String(
        params?.toolCall?.title ||
          params?.toolCall?._meta?.["x.ai/tool"]?.name ||
          params?.toolCall?._meta?.["x.ai/tool"]?.kind ||
          "",
      );
      // exit_plan_mode: ACP permission is a formality; real UI is x.ai/exit_plan_mode
      if (/exit_plan/i.test(toolName)) {
        this._respond(id, {
          outcome: { outcome: "selected", optionId: "allow-once" },
        });
        return;
      }

      if (this.alwaysApprove) {
        this._respond(id, {
          outcome: { outcome: "selected", optionId: "allow-once" },
        });
        return;
      }

      const decision = await new Promise((resolve) => {
        const timeout = setTimeout(
          () =>
            resolve({
              outcome: { outcome: "cancelled" },
            }),
          120_000,
        );
        this.emit("permission-request", {
          params,
          respond: (outcome) => {
            clearTimeout(timeout);
            resolve(outcome);
          },
        });
      });
      this._respond(id, decision);
      return;
    }

    if (method === "fs/read_text_file") {
      const filePath = this._resolveFsPath(params?.path);
      const text = await fs.promises.readFile(filePath, "utf8");
      this._respond(id, { content: text });
      return;
    }

    if (method === "fs/write_text_file") {
      const filePath = this._resolveFsPath(params?.path);
      await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
      await fs.promises.writeFile(filePath, params?.content ?? "", "utf8");
      this._respond(id, {});
      return;
    }

    if (method?.startsWith("terminal/")) {
      await this._handleTerminal(method, params, id);
      return;
    }

    this._respond(id, null, {
      code: -32601,
      message: `Unhandled client method: ${method}`,
    });
  }

  /**
   * Plan approval extension. Agent parks until the client responds.
   * @param {number|string} id
   * @param {any} params
   */
  async _handleExitPlanMode(id, params) {
    const planContent =
      params?.planContent ??
      params?.plan_content ??
      params?.content ??
      params?.plan ??
      "";
    const planFilePath =
      params?.planFilePath ??
      params?.plan_file_path ??
      params?.planPath ??
      null;

    let markdown = typeof planContent === "string" ? planContent : "";
    if (!markdown && planFilePath) {
      try {
        markdown = await fs.promises.readFile(String(planFilePath), "utf8");
      } catch {
        /* empty plan UI still opens */
      }
    }
    if (!markdown) {
      const sd = this.sessionDir();
      if (sd) {
        try {
          markdown = await fs.promises.readFile(
            path.join(sd, "plan.md"),
            "utf8",
          );
        } catch {
          /* ignore */
        }
      }
    }

    const decision = await new Promise((resolve) => {
      const timeout = setTimeout(
        () => resolve({ type: "abandoned" }),
        30 * 60_000,
      );
      this.emit("plan-approval-request", {
        params: {
          planContent: markdown,
          planFilePath,
          raw: params,
        },
        respond: (outcome) => {
          clearTimeout(timeout);
          resolve(outcome);
        },
      });
    });

    // Prefer `outcome` tag (same pattern as ask_user_question); keep type aliases.
    const type = decision?.type || decision?.outcome || "abandoned";
    if (type === "approved" || type === "approve" || type === "Accepted") {
      this._respond(id, { outcome: "approved", type: "approved" });
      return;
    }
    if (type === "request_changes" || type === "requestChanges") {
      this._respond(id, {
        outcome: "request_changes",
        type: "request_changes",
        feedback: String(decision?.feedback || decision?.message || ""),
      });
      return;
    }
    this._respond(id, { outcome: "abandoned", type: "abandoned" });
  }

  /**
   * @param {number|string} id
   * @param {any} params
   */
  async _handleAskUserQuestion(id, params) {
    const questions = Array.isArray(params?.questions)
      ? params.questions
      : [];

    const decision = await new Promise((resolve) => {
      const timeout = setTimeout(
        () => resolve({ type: "declined" }),
        10 * 60_000,
      );
      this.emit("user-question-request", {
        params: { questions, raw: params },
        respond: (outcome) => {
          clearTimeout(timeout);
          resolve(outcome);
        },
      });
    });

    // Grok expects AskUserQuestionExtResponse with tag field `outcome`:
    //   Accepted { answers, partial_answers } | SkipInterview | ChatAboutThis
    // (error when missing: "invalid response to user question / missing field `outcome`")
    const type = decision?.type || decision?.outcome || "declined";
    if (
      type === "answered" ||
      type === "answers" ||
      type === "Accepted" ||
      type === "accepted"
    ) {
      this._respond(id, {
        outcome: "Accepted",
        answers: decision?.answers ?? [],
        partial_answers: decision?.partial_answers ?? decision?.partialAnswers ?? [],
      });
      return;
    }
    if (
      type === "chat" ||
      type === "ChatAboutThis" ||
      type === "chat_about_this"
    ) {
      this._respond(id, {
        outcome: "ChatAboutThis",
        message: String(decision?.message || decision?.feedback || ""),
      });
      return;
    }
    // Skip / decline
    this._respond(id, { outcome: "SkipInterview" });
  }

  /**
   * ACP terminal/* — agent runs commands in the desktop client's environment.
   * @param {string} method
   * @param {any} params
   * @param {number|string} id
   */
  async _handleTerminal(method, params, id) {
    try {
      switch (method) {
        case "terminal/create": {
          const result = this.terminals.create(params || {});
          this._respond(id, result);
          return;
        }
        case "terminal/output": {
          this._respond(id, this.terminals.output(params || {}));
          return;
        }
        case "terminal/wait_for_exit": {
          const status = await this.terminals.waitForExit(params || {});
          this._respond(id, status);
          return;
        }
        case "terminal/kill": {
          this._respond(id, this.terminals.kill(params || {}));
          return;
        }
        case "terminal/release": {
          this._respond(id, this.terminals.release(params || {}));
          return;
        }
        default:
          this._respond(id, null, {
            code: -32601,
            message: `Unhandled terminal method: ${method}`,
          });
      }
    } catch (err) {
      this._respond(id, null, {
        code: err?.code ?? -32000,
        message: err?.message || String(err),
      });
    }
  }

  _respond(id, result, error) {
    const msg = error
      ? { jsonrpc: "2.0", id, error }
      : { jsonrpc: "2.0", id, result: result ?? {} };
    this._write(msg);
  }

  _write(obj) {
    if (!this.proc?.stdin?.writable) throw new Error("Agent stdin not writable");
    this.proc.stdin.write(JSON.stringify(obj) + "\n");
  }

  /**
   * @param {string} method
   * @param {object} [params]
   * @param {{ timeoutMs?: number }} [opts]
   */
  request(method, params = {}, opts = {}) {
    const id = this.nextId++;
    const timeoutMs = opts.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (!this.pending.has(id)) return;
        this.pending.delete(id);
        reject(
          new Error(
            `ACP request timed out after ${timeoutMs}ms: ${method}`,
          ),
        );
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      try {
        this._write({ jsonrpc: "2.0", id, method, params });
      } catch (err) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(err);
      }
    });
  }

  notify(method, params = {}) {
    this._write({ jsonrpc: "2.0", method, params });
  }

  async prompt(text, { images = [] } = {}) {
    if (!this.sessionId) throw new Error("No ACP session");
    const prompt = [{ type: "text", text }];
    for (const img of images) {
      prompt.push({
        type: "image",
        data: img.data,
        mimeType: img.mimeType || "image/png",
      });
    }
    // Long agent turns — generous timeout
    return this.request(
      "session/prompt",
      {
        sessionId: this.sessionId,
        prompt,
      },
      { timeoutMs: 30 * 60_000 },
    );
  }

  cancel() {
    if (!this.sessionId) return;
    this.notify("session/cancel", { sessionId: this.sessionId });
  }

  setAlwaysApprove(value) {
    // Legacy boolean API — maps to always-approve vs ask
    return this.setPermissionMode(value ? "always-approve" : "ask");
  }

  /**
   * Apply permission mode on the client and push it into the live agent session.
   * @param {string} mode
   * @returns {Promise<'ask'|'auto'|'always-approve'>}
   */
  async setPermissionMode(mode) {
    this.permissionMode = normalizePermissionMode(mode);
    this.alwaysApprove = this.permissionMode === "always-approve";

    if (!this.sessionId || !this.ready || !this.proc) {
      return this.permissionMode;
    }

    const agentMode = toAgentPermissionMode(this.permissionMode);

    // Prefer ACP session/set_mode (Grok supports it alongside session modes)
    try {
      await this.request(
        "session/set_mode",
        {
          sessionId: this.sessionId,
          modeId: agentMode,
        },
        { timeoutMs: 15_000 },
      );
      return this.permissionMode;
    } catch {
      /* fall through — older agents or different mode catalog */
    }

    // Fallback: CLI slash commands (same as TUI /always-approve and /auto)
    try {
      let slash;
      if (this.permissionMode === "always-approve") {
        slash = "/always-approve on";
      } else if (this.permissionMode === "auto") {
        slash = "/auto";
      } else {
        slash = "/always-approve off";
      }
      await this.prompt(slash);
    } catch {
      /* client-side alwaysApprove still applies for always-approve mode */
    }

    return this.permissionMode;
  }

  setAllowOutsideProject(value) {
    this.allowOutsideProject = Boolean(value);
    this.terminals.setAllowOutsideProject(this.allowOutsideProject);
  }

  setSandboxTerminal(value) {
    this.sandboxTerminal = Boolean(value);
    this.terminals.setSandboxTerminal(this.sandboxTerminal);
  }

  async setCwd(cwd) {
    this.cwd = cwd;
    this.terminals.setDefaultCwd(cwd);
    this.terminals.disposeAll();
    return this.newSession();
  }

  async dispose() {
    this._rejectAllPending(new Error("Agent disposed"));
    try {
      this.terminals.disposeAll();
    } catch {
      /* ignore */
    }
    try {
      this.rl?.close();
    } catch {
      /* ignore */
    }
    if (this.proc && !this.proc.killed) {
      this.proc.kill();
    }
    this.proc = null;
    this.ready = false;
    this.sessionId = null;
  }
}

export { resolveGrokBinary } from "./grok-home.mjs";
