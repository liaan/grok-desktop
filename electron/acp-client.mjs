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
  sessionPermissionMeta,
  yoloModeChangedExtNotification,
} from "./permission-mode.mjs";
import {
  DEFAULT_REASONING_EFFORT,
  normalizeReasoningEffort,
} from "./reasoning-effort.mjs";
import {
  cancelledPermissionResult,
  pickAllowOptionId,
  selectedPermissionResult,
} from "../shared/permission-options.mjs";
import {
  classifyInboundMessage,
  createOnceResponder,
  createPermissionOneshot,
  isFsReadMethod,
  isFsWriteMethod,
  isPermissionMethod,
  isTerminalMethod,
  jsonRpcErrorCode,
} from "../shared/acp-rpc.mjs";
import {
  handleAskUserQuestion,
  handleExitPlanMode,
} from "./acp-ext-methods.mjs";
import { debugLog } from "./debug-log.mjs";

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
    /** @deprecated use permissionMode */
    alwaysApprove = false,
    /** ask | auto | always-approve — see permission-mode.mjs */
    permissionMode,
    /** When false (default), ACP fs/* and terminal cwd stay inside project */
    allowOutsideProject = false,
    /** When true (default), wrap ACP tool shells in an OS FS jail */
    sandboxTerminal = true,
    /**
     * Reasoning effort for models that support it (`/effort`, `--reasoning-effort`).
     * low | medium | high | xhigh
     */
    reasoningEffort = DEFAULT_REASONING_EFFORT,
    clientVersion = "0.1.2",
  } = {}) {
    super();
    this.cwd = cwd || process.cwd();
    this.grokPath = grokPath || resolveGrokBinary();
    this.permissionMode = normalizePermissionMode(
      permissionMode,
      alwaysApprove,
    );
    this.allowOutsideProject = Boolean(allowOutsideProject);
    this.sandboxTerminal = sandboxTerminal !== false;
    this.reasoningEffort = normalizeReasoningEffort(reasoningEffort);
    this.clientVersion = clientVersion;
    this.proc = null;
    this.rl = null;
    this.nextId = 1;
    /** @type {Map<number, { resolve: Function, reject: Function, timer?: NodeJS.Timeout }>} */
    this.pending = new Map();
    /**
     * Open agent→client permission oneshots (ACP request id → gate).
     * Cancel MUST settle each with outcome cancelled (spec).
     * @type {Map<string, ReturnType<typeof createPermissionOneshot>>}
     */
    this._openPermissionGates = new Map();
    /** @type {ReturnType<typeof createOnceResponder> | null} */
    this._once = null;
    this.sessionId = null;
    this.ready = false;
    this.stderrBuf = "";
    /** @type {Record<string, any>} */
    this.agentCapabilities = {};
    /** Last known ACP model id (from session/new|load models.currentModelId). */
    this.currentModelId = null;
    /**
     * Effort levels advertised by the current model (ids). Empty when unknown.
     * @type {string[]}
     */
    this.availableReasoningEfforts = [];
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

    // Agent flags go after `agent` and before the transport (`stdio`).
    // Top-level `grok --flag … agent stdio` is ignored by the CLI.
    const args = ["agent"];
    if (this.permissionMode === "always-approve") {
      // Match TUI/CLI always-approve so the agent sets yoloMode for the process
      // (session/_meta alone is not enough on resume / late UI toggles).
      args.push("--always-approve");
    }
    if (this.reasoningEffort) {
      args.push("--reasoning-effort", this.reasoningEffort);
    }
    // Optional agent debug file (same folder as desktop-debug when env set)
    if (/^(1|true|yes|on)$/i.test(String(process.env.GROK_DESKTOP_DEBUG || ""))) {
      args.push("--debug");
    }
    args.push("stdio");
    debugLog("agent", "spawn", {
      bin: this.grokPath,
      args,
      cwd: this.cwd,
      effort: this.reasoningEffort,
      sandbox: this.sandboxTerminal,
      allowOutside: this.allowOutsideProject,
    });
    this.proc = spawn(this.grokPath, args, {
      cwd: this.cwd,
      env: agentEnv(),
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });

    this.proc.on("error", (err) => {
      debugLog("agent", "spawn error", { message: err?.message || String(err) });
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
   * same permission mode the Desktop UI shows (grok-build yoloMode + autoMode).
   */
  _sessionPermissionMeta() {
    return sessionPermissionMeta(this.permissionMode || "ask");
  }

  /**
   * Remember model id + advertised effort menu from session/new|load result.
   * @param {any} session
   */
  _rememberModels(session) {
    const models = session?.models;
    const current =
      models?.currentModelId ||
      session?._meta?.["x.ai/sessionDetail"]?.currentModelId ||
      null;
    if (current) this.currentModelId = String(current);

    const list = Array.isArray(models?.availableModels)
      ? models.availableModels
      : [];
    const entry =
      list.find((m) => String(m?.modelId || "") === this.currentModelId) ||
      list[0];
    const efforts = entry?._meta?.reasoningEfforts;
    if (Array.isArray(efforts)) {
      this.availableReasoningEfforts = efforts
        .map((e) => String(e?.id || e?.value || "").toLowerCase())
        .filter(Boolean);
    } else {
      this.availableReasoningEfforts = [];
    }

    // Prefer live session value when present and we have no stronger client pref
    // (spawn flag already applied; keep client preference as source of truth).
    const live = entry?._meta?.reasoningEffort;
    if (live && !this.reasoningEffort) {
      this.reasoningEffort = normalizeReasoningEffort(live);
    }
  }

  /**
   * Align live session effort with Desktop preference after session/new|load.
   * Spawn flag usually already matches; this covers load + mid-process /new.
   */
  async _syncReasoningEffortToSession() {
    if (!this.sessionId || !this.ready || !this.reasoningEffort) return;
    if (!this.currentModelId) return;
    try {
      await this.request(
        "session/set_model",
        {
          sessionId: this.sessionId,
          modelId: this.currentModelId,
          _meta: { reasoningEffort: this.reasoningEffort },
        },
        { timeoutMs: 15_000 },
      );
    } catch {
      /* Best-effort — spawn flag / next agent start still apply. */
    }
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
    this._rememberModels(session);
    this.terminals.setDefaultCwd(this.cwd);
    this.ready = true;
    await this._syncReasoningEffortToSession();
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
    this._rememberModels(result);
    this.terminals.setDefaultCwd(this.cwd);
    this.ready = true;
    await this._syncReasoningEffortToSession();
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
    // Unblock any parked session/request_permission oneshots
    this._cancelOpenPermissionGates();
  }

  /**
   * ACP: Client MUST respond to all pending request_permission with cancelled
   * when the prompt turn is cancelled. Only settle the oneshot here — the
   * parked handler awaits wait() then issues the single JSON-RPC response.
   */
  _cancelOpenPermissionGates() {
    const cancelled = cancelledPermissionResult();
    for (const [, gate] of this._openPermissionGates) {
      gate.settle(cancelled);
    }
    // Do not clear the map here: finally blocks on the handlers remove entries
    // after they _respond once.
  }

  _ensureOnce() {
    if (!this._once) {
      this._once = createOnceResponder((msg) => this._write(msg));
    }
    return this._once;
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

    const c = classifyInboundMessage(msg);

    if (c.kind === "session-update") {
      // Progress only — does not complete tools; agent still needs client RPCs.
      this.emit("session-update", c.params);
      if (c.expectsEmptyAck) {
        this._ensureOnce().beginRequest(c.id);
        this._respond(c.id, {});
      }
      return;
    }

    if (c.kind === "server-request") {
      // Fresh response slot for this id (JSON-RPC may reuse ids after completion).
      this._ensureOnce().beginRequest(c.id);
      // Concurrent handlers (grok-build gateway spawn): one long permission
      // wait must not block later fs/* / terminal/* lines.
      this._handleServerRequest({
        method: c.method,
        id: c.id,
        params: c.params,
      }).catch((err) => {
        debugLog("acp", "server-request-error", {
          id: c.id,
          method: c.method,
          error: err?.message || String(err),
          code: err?.code,
        });
        this._respond(c.id, null, {
          code: jsonRpcErrorCode(err?.code),
          message: err?.message || String(err),
        });
      });
      return;
    }

    if (c.kind === "notification") {
      this.emit("notification", { method: c.method, params: c.params });
      return;
    }

    if (c.kind === "client-response" && this.pending.has(c.id)) {
      const p = this.pending.get(c.id);
      this.pending.delete(c.id);
      if (p.timer) clearTimeout(p.timer);
      if (c.error) {
        p.reject(
          Object.assign(new Error(c.error.message || "ACP error"), c.error),
        );
      } else {
        p.resolve(c.result);
      }
    }
  }

  async _handleServerRequest(msg) {
    const { method, params, id } = msg;
    const started = Date.now();
    debugLog("acp", "server-request", {
      id,
      method: String(method || ""),
      path: params?.path,
      tool:
        params?.toolCall?.title ||
        params?.toolCall?._meta?.["x.ai/tool"]?.name ||
        null,
    });

    const extCtx = {
      emitter: this,
      respond: (rid, result, error) => this._respond(rid, result, error),
      sessionDir: () => this.sessionDir(),
    };

    try {
      // Grok extension: plan approval popup (must not auto-approve / no-op)
      if (
        method === EXT_EXIT_PLAN ||
        method === "exit_plan_mode" ||
        method?.endsWith("/exit_plan_mode")
      ) {
        await handleExitPlanMode(extCtx, id, params);
        return;
      }

      // Grok extension: multi-choice questions
      if (
        method === EXT_ASK_USER ||
        method === "ask_user_question" ||
        method?.endsWith("/ask_user_question")
      ) {
        await handleAskUserQuestion(extCtx, id, params);
        return;
      }

      if (isPermissionMethod(method)) {
        const toolName = String(
          params?.toolCall?.title ||
            params?.toolCall?._meta?.["x.ai/tool"]?.name ||
            params?.toolCall?._meta?.["x.ai/tool"]?.kind ||
            "",
        );
        const allowId = pickAllowOptionId(params?.options, {
          allowAlwaysOk: this.permissionMode === "always-approve",
        });

        // exit_plan_mode: ACP permission is a formality; real UI is x.ai/exit_plan_mode
        if (/exit_plan/i.test(toolName)) {
          this._respond(
            id,
            selectedPermissionResult(
              pickAllowOptionId(params?.options, { allowAlwaysOk: false }),
            ),
          );
          return;
        }

        if (this.permissionMode === "always-approve") {
          this._respond(id, selectedPermissionResult(allowId));
          return;
        }

        // No main listener → never resolve (agent tools stay pending forever).
        if (this.listenerCount("permission-request") === 0) {
          console.error(
            "[acp] session/request_permission with no listener — cancelling",
            { id, toolName },
          );
          debugLog("acp", "permission-no-listener", { id, toolName });
          this._respond(id, cancelledPermissionResult());
          return;
        }

        // Oneshot wait for UI settle — exactly one respond(id) after settle.
        const oneshot = createPermissionOneshot();
        this._openPermissionGates.set(id, oneshot);
        try {
          this.emit("permission-request", {
            params,
            requestId: id,
            respond: (outcome) => {
              oneshot.settle(outcome || cancelledPermissionResult());
            },
          });
          const decision = await oneshot.wait();
          this._respond(id, decision ?? cancelledPermissionResult());
        } finally {
          this._openPermissionGates.delete(id);
        }
        return;
      }

      if (isFsReadMethod(method)) {
        // Grok write/edit: when clientCapabilities.fs.writeTextFile is true the
        // agent often fs/read_text_file's the path first, then write_text_file.
        // ENOENT must NOT be a hard JSON-RPC error — that stalls the tool forever
        // (create-new-file write hangs on "pending" / Working…).
        const filePath = this._resolveFsPath(params?.path);
        let text = "";
        try {
          text = await fs.promises.readFile(filePath, "utf8");
        } catch (err) {
          if (err?.code === "ENOENT") {
            debugLog("acp", "fs-read-missing", { path: filePath });
            this._respond(id, { content: "" });
            return;
          }
          throw err;
        }
        // Optional line/limit (1-based line, ACP fs/read_text_file)
        const line = Number(params?.line);
        const limit = Number(params?.limit);
        if (Number.isFinite(line) && line >= 1) {
          const lines = text.split("\n");
          const start = Math.max(0, Math.floor(line) - 1);
          const take =
            Number.isFinite(limit) && limit >= 0
              ? Math.floor(limit)
              : lines.length - start;
          text = lines.slice(start, start + take).join("\n");
        }
        this._respond(id, { content: text });
        return;
      }

      if (isFsWriteMethod(method)) {
        const filePath = this._resolveFsPath(params?.path);
        const content =
          params?.content != null
            ? String(params.content)
            : params?.text != null
              ? String(params.text)
              : "";
        await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
        await fs.promises.writeFile(filePath, content, "utf8");
        debugLog("acp", "fs-write-ok", {
          path: filePath,
          bytes: content.length,
        });
        // ACP: empty result on success (null or {})
        this._respond(id, {});
        return;
      }

      if (isTerminalMethod(method)) {
        await this._handleTerminal(method, params, id);
        return;
      }

      console.error("[acp] unhandled client method (agent may hang):", method, {
        id,
      });
      debugLog("acp", "unhandled-method", { id, method: String(method || "") });
      this._respond(id, null, {
        code: -32601,
        message: `Unhandled client method: ${method}`,
      });
    } finally {
      debugLog("acp", "server-request-done", {
        id,
        method: String(method || ""),
        ms: Date.now() - started,
      });
    }
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
        code: jsonRpcErrorCode(err?.code),
        message: err?.message || String(err),
      });
    }
  }

  /**
   * Exactly one JSON-RPC response per agent request id.
   * @param {string|number} id
   * @param {any} [result]
   * @param {{ code?: number, message?: string } | null} [error]
   */
  _respond(id, result, error = null) {
    this._ensureOnce().respond(id, result, error);
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
    // ACP: Client MUST respond to pending request_permission with cancelled.
    // Also settle extension gates via main (plan/ask) — caller should use
    // clearPendingPermissions. Kill tool shells so terminal/wait_for_exit
    // cannot park the turn after cancel.
    this._cancelOpenPermissionGates();
    try {
      this.terminals.disposeAll();
    } catch {
      /* ignore */
    }
    // Do not clear once-responder here — in-flight fs may still need to answer.
    if (!this.sessionId) return;
    this.notify("session/cancel", { sessionId: this.sessionId });
  }

  /**
   * Apply permission mode on the client and push it into the live agent session.
   * Live path matches TUI/pager: ACP `ext_notification` → `x.ai/yolo_mode_changed`
   * (`yolo_mode` / `auto_mode` / `permission_mode`). Do **not** use
   * `session/set_mode` for tool permission — that API is plan/default/ask only.
   *
   * @param {string} mode
   * @returns {Promise<{
   *   mode: 'ask'|'auto'|'always-approve',
   *   agentSynced: boolean,
   *   error?: string,
   * }>}
   */
  async setPermissionMode(mode) {
    this.permissionMode = normalizePermissionMode(mode);

    // No live session yet — client gate is set; agent gets _meta on next session/new|load
    if (!this.sessionId || !this.ready || !this.proc) {
      return { mode: this.permissionMode, agentSynced: false };
    }

    try {
      // Fire-and-forget notification (same as pager); no response expected.
      this.notify(
        "ext_notification",
        yoloModeChangedExtNotification(this.permissionMode),
      );
      return { mode: this.permissionMode, agentSynced: true };
    } catch (err) {
      const error = err?.message || String(err);
      return {
        mode: this.permissionMode,
        agentSynced: false,
        error,
      };
    }
  }

  /**
   * Set reasoning effort (same as CLI `/effort <level>`).
   * Live path: `session/set_model` with `_meta.reasoningEffort` (Grok 0.2.101+).
   * Spawn also passes `--reasoning-effort` so new agent processes match.
   *
   * @param {string} level
   * @returns {Promise<{
   *   effort: string,
   *   agentSynced: boolean,
   *   error?: string,
   * }>}
   */
  async setReasoningEffort(level) {
    this.reasoningEffort = normalizeReasoningEffort(level);

    if (!this.sessionId || !this.ready || !this.proc) {
      return { effort: this.reasoningEffort, agentSynced: false };
    }

    const modelId = this.currentModelId;
    if (!modelId) {
      return {
        effort: this.reasoningEffort,
        agentSynced: false,
        error: "No current model id from the agent yet",
      };
    }

    try {
      await this.request(
        "session/set_model",
        {
          sessionId: this.sessionId,
          modelId,
          _meta: { reasoningEffort: this.reasoningEffort },
        },
        { timeoutMs: 15_000 },
      );
      return { effort: this.reasoningEffort, agentSynced: true };
    } catch (err) {
      const error = err?.message || String(err);
      return {
        effort: this.reasoningEffort,
        agentSynced: false,
        error,
      };
    }
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
      this._once?.clear();
    } catch {
      /* ignore */
    }
    this._once = null;
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
