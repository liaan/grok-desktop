/**
 * Minimal ACP (Agent Client Protocol) client over `grok agent stdio`.
 * Backbone: Grok Build agent runtime via ACP (same path as other embeds).
 *
 * Skills, MCP servers, plugins, and auth all come from the installed Grok CLI
 * (`~/.grok`). session/new `mcpServers` is *merged* with user config — we
 * only add the Desktop Preview MCP so the agent can drive the Preview window.
 */
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import { createInterface } from "node:readline";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import path from "node:path";
import { agentEnv } from "./auth.mjs";
import { resolveGrokBinary } from "./grok-home.mjs";
import {
  isMissingGrokBinaryError,
  missingGrokBinaryMessage,
} from "./grok-cli.mjs";
import { AcpTerminalManager } from "./acp-terminals.mjs";
import { expandUserPath, resolveProjectPath } from "./path-safety.mjs";
import { readFileForAcp } from "./fs-content.mjs";
import { sessionsRootForCwd } from "./sessions.mjs";
import { desktopPreviewMcpServers } from "./preview-mcp.mjs";
import { PREVIEW_SESSION_RULE } from "./preview-mcp-protocol.mjs";
import {

  initializeClientMeta,
  normalizePermissionMode,
  sessionPermissionMeta,
  YOLO_MODE_CHANGED_METHOD,
  yoloModeChangedParams,
} from "./permission-mode.mjs";
import {
  DEFAULT_REASONING_EFFORT,
  normalizeReasoningEffort,
} from "./reasoning-effort.mjs";
import { cancelledPermissionResult } from "../shared/permission-options.mjs";
import { compressPromptImage } from "./image-compress.mjs";
import {
  interjectAcceptedResult,
  interjectAttempts,
  interjectFromAttemptErrors,
  isInterjectMethodMissing,
  unwrapSessionInterjection,
} from "../shared/acp-interject.mjs";
import {
  classifyInboundMessage,
  compactConversationAttempts,
  unwrapExtMethodResult,
  worktreeCreateFromSyncAttempts,
  worktreeListAttempts,
  parseWorktreeCreateResponse,
  parseWorktreeListResponse,
  sessionRenameAttempts,
  sessionDeleteAttempts,
  isMcpLiveEventMethod,
  isMcpElicitCompleteMethod,
  isMcpElicitMethod,
  mcpAuthTriggerAttempts,
  mcpSessionListAttempts,
  unwrapMcpExtNotification,
  createOnceResponder,
  isFsReadMethod,
  isFsWriteMethod,
  isFolderTrustMethod,
  isPermissionMethod,
  isTerminalMethod,
  jsonRpcErrorCode,
  formatAcpError,
  acpClientCapabilities,
} from "../shared/acp-rpc.mjs";
import { handleAcpPermissionRequest } from "./acp-protocol.mjs";
import { mapMcpSessionCatalog } from "../shared/mcp-status.mjs";
import {
  handleAskUserQuestion,
  handleExitPlanMode,
  handleFolderTrustRequest,
  handleMcpElicit,
} from "./acp-ext-methods.mjs";
import { shouldAutoTrustFolder } from "./desktop-worktrees.mjs";
import { debugLog } from "./debug-log.mjs";
import { errorFields, writeCrashLog } from "./crash-log.mjs";

const DEFAULT_REQUEST_TIMEOUT_MS = 120_000;
const INIT_TIMEOUT_MS = 60_000;
const LOAD_TIMEOUT_MS = 90_000;
/** Client extension methods used by Grok for plan UI / questions (not plain tools). */
const EXT_EXIT_PLAN = "x.ai/exit_plan_mode";
const EXT_ASK_USER = "x.ai/ask_user_question";

/** @param {any} entry */
function modelEntryName(entry) {
  const name =
    entry?.name ||
    entry?.title ||
    entry?.displayName ||
    entry?._meta?.name ||
    null;
  return name ? String(name) : null;
}

/**
 * @param {any} raw
 */
function summarizeCompactResult(raw) {
  const r = raw && typeof raw === "object" ? raw : {};
  const nested = r.result && typeof r.result === "object" ? r.result : r;
  const before = Number(
    nested.tokens_before ??
      nested.tokensBefore ??
      nested.pre_tokens ??
      nested.preTokens,
  );
  const after = Number(
    nested.tokens_after ??
      nested.tokensAfter ??
      nested.post_tokens ??
      nested.postTokens,
  );
  let message = "Compress finished.";
  if (Number.isFinite(before) && before > 0 && Number.isFinite(after)) {
    message = `Conversation compacted: ${before.toLocaleString()} → ${after.toLocaleString()} tokens.`;
  } else if (nested.message) {
    message = String(nested.message);
  } else if (nested.error) {
    message = String(nested.error);
  }
  return {
    ok: true,
    tokens_before: Number.isFinite(before) ? before : undefined,
    tokens_after: Number.isFinite(after) ? after : undefined,
    message,
  };
}

/**
 * grok-build `McpAuthTriggerResponse` — status is authenticated / failed /
 * setup_required. Do not forward `setup` field schemas (may include labels).
 * @param {any} raw
 * @param {string} serverName
 */
function summarizeMcpAuthResult(raw, serverName) {
  const r = raw && typeof raw === "object" ? raw : {};
  const nested = r.result && typeof r.result === "object" ? r.result : r;
  const status = String(nested.status || "").toLowerCase();
  const error =
    nested.error == null || nested.error === ""
      ? null
      : String(nested.error);
  if (status === "authenticated") {
    return { ok: true, status: "authenticated", serverName, error: null };
  }
  if (status === "setup_required") {
    return {
      ok: false,
      status: "setup_required",
      serverName,
      error:
        error ||
        "This server needs extra setup values before sign-in. Add them in the TUI /mcps modal, or set headers when adding the server.",
    };
  }
  return {
    ok: false,
    status: status || "failed",
    serverName,
    error:
      error || `Authentication failed for MCP server “${serverName}”.`,
  };
}

/**
 * Deduped `{ modelId, name }` list for IPC / open-session results.
 * @param {any[]} list
 * @returns {{ modelId: string, name: string }[]}
 */
function snapshotAvailableModels(list) {
  const seen = new Set();
  /** @type {{ modelId: string, name: string }[]} */
  const out = [];
  for (const m of list || []) {
    const modelId = String(m?.modelId || "").trim();
    if (!modelId || seen.has(modelId)) continue;
    seen.add(modelId);
    out.push({ modelId, name: modelEntryName(m) || modelId });
  }
  return out;
}

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
    /** BrowserWindow id so Preview MCP Send screenshot returns to this chat. */
    windowId = 0,
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
    this.windowId = Number.parseInt(String(windowId || ""), 10) || 0;
    this.proc = null;
    this.rl = null;
    this.nextId = 1;
    /** @type {Map<number, { resolve: Function, reject: Function, timer?: NodeJS.Timeout }>} */
    this.pending = new Map();
    /**
     * Open agent→client permission oneshots (ACP request id → gate).
     * Cancel MUST settle each with outcome cancelled (spec).
     * @type {Map<any, { settle: (outcome: any) => boolean, wait: () => Promise<any> }>}
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
    /** Human-readable name for the current model when the agent provides one. */
    this.currentModelName = null;
    /**
     * Models advertised on session/new|load (`models.availableModels`).
     * @type {{ modelId: string, name: string }[]}
     */
    this.availableModels = [];
    /**
     * Effort levels advertised by the current model (ids). Empty when unknown.
     * @type {string[]}
     */
    this.availableReasoningEfforts = [];
    /** Session-scoped: auto-allow remaining write/edit/post prompts. */
    this.allowWritesThisSession = false;
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
   * Always allows the current session directory so plan.md can be written,
   * and GROK_HOME (~/.grok) so skills / agents / personas stay readable when
   * “Allow outside project” is off.
   * @param {string} filePath
   */
  _resolveFsPath(filePath) {
    const empty = filePath == null || String(filePath).trim() === "";
    if (empty) {
      throw Object.assign(new Error("Path is required"), { code: -32602 });
    }
    // Agents often pass ~/… — Node does not expand tilde.
    const asStr = expandUserPath(String(filePath).trim());
    const abs = path.isAbsolute(asStr)
      ? path.resolve(asStr)
      : path.resolve(this.cwd || process.cwd(), asStr);

    if (this._isUnderSessionDir(abs)) {
      return abs;
    }

    try {
      return resolveProjectPath(this.cwd, filePath, {
        allowOutside: this.allowOutsideProject,
        // Skills, agents, personas, sessions, MCP config live under GROK_HOME.
        allowGrokHome: true,
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
      const wrapped = isMissingGrokBinaryError(err)
        ? Object.assign(new Error(missingGrokBinaryMessage(this.grokPath)), {
            code: "ENOENT",
          })
        : err;
      debugLog("agent", "spawn error", {
        message: wrapped?.message || String(wrapped),
      });
      // Unblock initialize / session RPCs — do not wait for the 60s timeout.
      this._rejectAllPending(wrapped);
      this.emit("error", wrapped);
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
        clientCapabilities: acpClientCapabilities(),
        _meta: initializeClientMeta(),
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
    return {
      ...sessionPermissionMeta(this.permissionMode || "ask"),
      rules: PREVIEW_SESSION_RULE,
    };
  }

  _previewMcpPayload() {
    const servers = desktopPreviewMcpServers(this.windowId);
    debugLog("preview", "session-mcp", {
      count: servers.length,
      names: servers.map((s) => s.name),
      types: servers.map((s) => s.type || "stdio"),
    });
    return servers;
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
    this.availableModels = snapshotAvailableModels(list);
    const entry =
      list.find((m) => String(m?.modelId || "") === this.currentModelId) ||
      list[0];
    const name = modelEntryName(entry);
    this.currentModelName = name || null;
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

  /** Snapshot of session model state for IPC / open-session results. */
  _modelsPublic() {
    return {
      modelId: this.currentModelId || null,
      modelName: this.currentModelName || null,
      availableModels: this.availableModels.slice(),
    };
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
        mcpServers: this._previewMcpPayload(),
        _meta: this._sessionPermissionMeta(),
      },
      { timeoutMs: LOAD_TIMEOUT_MS },
    );
    this.sessionId = session.sessionId;
    this.allowWritesThisSession = false;
    this.emit("writes-session", false);
    this._rememberModels(session);
    this.terminals.setDefaultCwd(this.cwd);
    this.ready = true;
    await this._syncReasoningEffortToSession();
    this.emit("ready", {
      sessionId: this.sessionId,
      cwd: this.cwd,
      grokBinary: this.grokPath,
      resumed: false,
      ...this._modelsPublic(),
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
        mcpServers: this._previewMcpPayload(),
        _meta: this._sessionPermissionMeta(),
      },
      { timeoutMs: LOAD_TIMEOUT_MS },
    );

    this.sessionId =
      result?.sessionId || result?._meta?.sessionId || sessionId;
    this.allowWritesThisSession = false;
    this.emit("writes-session", false);
    this._rememberModels(result);
    this.terminals.setDefaultCwd(this.cwd);
    this.ready = true;
    await this._syncReasoningEffortToSession();
    this.emit("ready", {
      sessionId: this.sessionId,
      cwd: this.cwd,
      grokBinary: this.grokPath,
      resumed: true,
      ...this._modelsPublic(),
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
    try {
      this._dispatchLine(line);
    } catch (err) {
      debugLog("acp", "on-line-error", {
        error: err?.message || String(err),
      });
      writeCrashLog("acp", "on-line-error", errorFields(err));
    }
  }

  _dispatchLine(line) {
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
    const interjection = unwrapSessionInterjection(msg.method, msg.params);
    if (interjection) {
      this.emit("session-interjection", interjection);
      if (msg.id !== undefined) {
        this._ensureOnce().beginRequest(msg.id);
        this._respond(msg.id, {});
      }
      return;
    }

    const mcpEvent = unwrapMcpExtNotification(msg.method, msg.params);
    if (mcpEvent && isMcpElicitCompleteMethod(mcpEvent.method)) {
      if (msg.id !== undefined) {
        this._ensureOnce().beginRequest(msg.id);
        this._respond(msg.id, {});
      }
      return;
    }

    if (mcpEvent && isMcpLiveEventMethod(mcpEvent.method)) {
      this.emit("mcp-status", mcpEvent);
      if (msg.id !== undefined) {
        this._ensureOnce().beginRequest(msg.id);
        this._respond(msg.id, {});
      }
      return;
    }

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
        const err = new Error(formatAcpError(c.error));
        if (typeof c.error.code === "number") err.code = c.error.code;
        debugLog("acp", "rpc-error", {
          id: c.id,
          code: c.error.code,
          message: err.message,
        });
        p.reject(err);
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

      // MCP elicitation (form fields or URL consent). Must not -32601 —
      // the MCP server waits on this reverse-request.
      if (isMcpElicitMethod(method) || isMcpElicitMethod(params?.method)) {
        await handleMcpElicit(
          {
            ...extCtx,
            listenerCount: this.listenerCount("mcp-elicit-request"),
          },
          id,
          params,
          method,
        );
        return;
      }

      // Grok worktrees under ~/.grok are a new git root — project MCP is gated
      // until this reverse-request is answered (TUI /hooks-trust).
      if (isFolderTrustMethod(method) || isFolderTrustMethod(params?.method)) {
        await handleFolderTrustRequest(
          {
            ...extCtx,
            listenerCount: this.listenerCount("folder-trust-request"),
            shouldAutoTrust: shouldAutoTrustFolder,
          },
          id,
          params,
          method,
        );
        return;
      }

      if (isPermissionMethod(method)) {
        await handleAcpPermissionRequest({
          id,
          params,
          permissionMode: this.permissionMode,
          allowWritesThisSession: this.allowWritesThisSession,
          listenerCount: this.listenerCount("permission-request"),
          gates: this._openPermissionGates,
          respond: (rid, result, error) => this._respond(rid, result, error),
          onPark: ({ params: p, oneshot, requestId }) => {
            this.emit("permission-request", {
              params: p,
              requestId,
              respond: (outcome) => {
                oneshot.settle(outcome || cancelledPermissionResult());
              },
            });
          },
          onNoListener: (toolName) => {
            console.error(
              "[acp] session/request_permission with no listener — cancelling",
              { id, toolName },
            );
            debugLog("acp", "permission-no-listener", { id, toolName });
          },
        });
        return;
      }

      if (isFsReadMethod(method)) {
        // Grok write/edit: when clientCapabilities.fs.writeTextFile is true the
        // agent often fs/read_text_file's the path first, then write_text_file.
        // ENOENT must NOT be a hard JSON-RPC error — that stalls the tool forever
        // (create-new-file write hangs on "pending" / Working…).
        //
        // Images / binaries: metadata-only text (see fs-content.mjs). No base64
        // smuggling through ACP read_text_file — attach in composer for vision.
        const filePath = this._resolveFsPath(params?.path);
        try {
          const line = Number(params?.line);
          const limit = Number(params?.limit);
          const result = await readFileForAcp(filePath, {
            line: Number.isFinite(line) ? line : undefined,
            limit: Number.isFinite(limit) ? limit : undefined,
          });
          if (result.kind !== "text") {
            debugLog("acp", "fs-read-nontext", {
              path: filePath,
              kind: result.kind,
              mime: result.mime,
              chars: result.content?.length,
            });
          }
          this._respond(id, { content: result.content });
        } catch (err) {
          if (err?.code === "ENOENT") {
            debugLog("acp", "fs-read-missing", { path: filePath });
            this._respond(id, { content: "" });
            return;
          }
          throw err;
        }
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
    try {
      this._ensureOnce().respond(id, result, error);
    } catch (err) {
      // Agent already gone (HMR / restart / crash). Do not reject the
      // inbound-line handler — that surfaces as an unhandled rejection.
      debugLog("acp", "respond-failed", {
        id,
        error: err?.message || String(err),
      });
    }
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
    try {
      this._write({ jsonrpc: "2.0", method, params });
    } catch (err) {
      debugLog("acp", "notify-failed", {
        method,
        error: err?.message || String(err),
      });
    }
  }

  /**
   * Compact via grok-build `ext_method` → `x.ai/compact_conversation`.
   * Never send `/compact` as session/prompt. Response body may be `{}`;
   * token counts arrive on `x.ai/session_notification`.
   * @param {string} [hint]
   */
  async compactConversation(hint = "") {
    if (!this.sessionId) throw new Error("No ACP session");
    const longMs = 3 * 60_000;
    const methodMissing = (err) => {
      if (err?.code === -32601) return true;
      return /method not found|-32601|unknown method/i.test(
        String(err?.message || err),
      );
    };

    const attempts = compactConversationAttempts(this.sessionId, hint);
    const misses = [];
    for (const attempt of attempts) {
      try {
        const raw = await this.request(attempt.method, attempt.params, {
          timeoutMs: longMs,
        });
        debugLog("acp", "compact-ok", { path: attempt.method });
        return summarizeCompactResult(raw);
      } catch (err) {
        const message = err?.message || String(err);
        debugLog("acp", "compact-try", {
          path: attempt.method,
          error: message,
          code: err?.code,
        });
        if (methodMissing(err)) {
          misses.push(`${attempt.method}: ${message}`);
          continue;
        }
        throw err instanceof Error ? err : new Error(message);
      }
    }
    throw new Error(
      `Compress is not available on this Grok CLI connection (${misses.join(" · ") || "no methods accepted"}).`,
    );
  }

  /**
   * Same as TUI `/new` worktree: ACP `x.ai/git/worktree/create_from_worktree_sync`.
   * Grok picks the path under ~/.grok/worktrees — no git CLI in Desktop.
   * @param {{ sourceCwd?: string, label?: string }} [opts]
   */
  async createWorktreeFromCurrent(opts = {}) {
    if (!this.ready) throw new Error("Agent not connected");
    const source =
      String(opts.sourceCwd || this.cwd || "").trim() || this.cwd;
    if (!source) throw new Error("No project path for worktree create");
    const newSessionId = `desktop-${
      typeof crypto.randomUUID === "function"
        ? crypto.randomUUID().slice(0, 12)
        : Date.now().toString(36)
    }`;
    const attempts = worktreeCreateFromSyncAttempts({
      sourceWorktreePath: source,
      newSessionId,
      copyMode: "dirty",
      label: opts.label,
    });
    const methodMissing = (err) => {
      if (err?.code === -32601) return true;
      return /method not found|-32601|unknown method/i.test(
        String(err?.message || err),
      );
    };
    const misses = [];
    const longMs = 5 * 60_000;
    for (const attempt of attempts) {
      try {
        const raw = await this.request(attempt.method, attempt.params, {
          timeoutMs: longMs,
        });
        debugLog("acp", "worktree-create-ok", { path: attempt.method });
        return parseWorktreeCreateResponse(raw);
      } catch (err) {
        const message = err?.message || String(err);
        debugLog("acp", "worktree-create-try", {
          path: attempt.method,
          error: message,
          code: err?.code,
        });
        if (methodMissing(err)) {
          misses.push(`${attempt.method}: ${message}`);
          continue;
        }
        throw err instanceof Error ? err : new Error(message);
      }
    }
    throw new Error(
      `Worktree create is not available on this Grok CLI (${misses.join(" · ") || "no methods accepted"}).`,
    );
  }

  /**
   * ACP `x.ai/git/worktree/list` (Grok-managed worktrees).
   * @param {{ repo?: string, includeAll?: boolean }} [opts]
   */
  async listWorktrees(opts = {}) {
    if (!this.ready) return [];
    const repo =
      opts.repo == null || String(opts.repo).trim() === ""
        ? undefined
        : String(opts.repo).trim();
    const attempts = worktreeListAttempts({
      repo,
      includeAll: Boolean(opts.includeAll),
    });
    const methodMissing = (err) => {
      if (err?.code === -32601) return true;
      return /method not found|-32601|unknown method/i.test(
        String(err?.message || err),
      );
    };
    for (const attempt of attempts) {
      try {
        const raw = await this.request(attempt.method, attempt.params, {
          timeoutMs: 20_000,
        });
        return parseWorktreeListResponse(raw);
      } catch (err) {
        if (methodMissing(err)) continue;
        debugLog("acp", "worktree-list-failed", {
          error: err?.message || String(err),
        });
        return [];
      }
    }
    return [];
  }

  /**
   * Same as TUI `/rename`: ACP `x.ai/session/rename` pins generated_title.
   * Works for the live session or a dormant chat under the same cwd.
   * @param {{ sessionId: string, title: string, cwd?: string }} opts
   */
  async renameSession(opts) {
    if (!this.ready) throw new Error("Agent not connected");
    const sessionId = String(opts?.sessionId || "").trim();
    const title = String(opts?.title || "");
    const cwd = String(opts?.cwd || this.cwd || "").trim();
    if (!sessionId) throw new Error("Session id is required");
    const methodMissing = (err) => {
      if (err?.code === -32601) return true;
      return /method not found|-32601|unknown method/i.test(
        String(err?.message || err),
      );
    };
    const attempts = sessionRenameAttempts({ sessionId, title, cwd });
    const misses = [];
    for (const attempt of attempts) {
      try {
        const raw = await this.request(attempt.method, attempt.params, {
          timeoutMs: 20_000,
        });
        debugLog("acp", "session-rename-ok", {
          path: attempt.method,
          sessionId,
        });
        return raw ?? { ok: true };
      } catch (err) {
        const message = err?.message || String(err);
        debugLog("acp", "session-rename-try", {
          path: attempt.method,
          sessionId,
          error: message,
          code: err?.code,
        });
        if (methodMissing(err)) {
          misses.push(`${attempt.method}: ${message}`);
          continue;
        }
        throw err instanceof Error ? err : new Error(message);
      }
    }
    const miss = new Error(
      `Rename is not available on this Grok CLI connection (${misses.join(" · ") || "no methods accepted"}).`,
    );
    miss.code = -32601;
    throw miss;
  }

  /**
   * Same as TUI / CLI `grok sessions delete`: ACP `x.ai/session/delete`.
   * @param {{ sessionId: string, cwd?: string }} opts
   */
  async deleteSession(opts) {
    if (!this.ready) throw new Error("Agent not connected");
    const sessionId = String(opts?.sessionId || "").trim();
    const cwd = String(opts?.cwd || this.cwd || "").trim();
    if (!sessionId) throw new Error("Session id is required");
    const methodMissing = (err) => {
      if (err?.code === -32601) return true;
      return /method not found|-32601|unknown method/i.test(
        String(err?.message || err),
      );
    };
    const attempts = sessionDeleteAttempts({ sessionId, cwd });
    const misses = [];
    for (const attempt of attempts) {
      try {
        const raw = await this.request(attempt.method, attempt.params, {
          timeoutMs: 20_000,
        });
        debugLog("acp", "session-delete-ok", {
          path: attempt.method,
          sessionId,
        });
        return raw ?? { ok: true };
      } catch (err) {
        const message = err?.message || String(err);
        debugLog("acp", "session-delete-try", {
          path: attempt.method,
          sessionId,
          error: message,
          code: err?.code,
        });
        if (methodMissing(err)) {
          misses.push(`${attempt.method}: ${message}`);
          continue;
        }
        throw err instanceof Error ? err : new Error(message);
      }
    }
    const miss = new Error(
      `Delete is not available on this Grok CLI connection (${misses.join(" · ") || "no methods accepted"}).`,
    );
    miss.code = -32601;
    throw miss;
  }

  /**
   * Same as TUI `/mcps` + `i`: ACP `x.ai/mcp/auth_trigger` opens the MCP
   * OAuth browser flow and writes `~/.grok/mcp_credentials.json`.
   * @param {string} serverName
   */
  async authenticateMcpServer(serverName) {
    if (!this.sessionId) throw new Error("No ACP session");
    const name = String(serverName || "").trim();
    if (!name) throw new Error("MCP server name is required");
    const longMs = 5 * 60_000;
    const methodMissing = (err) => {
      if (err?.code === -32601) return true;
      return /method not found|-32601|unknown method/i.test(
        String(err?.message || err),
      );
    };

    const attempts = mcpAuthTriggerAttempts(this.sessionId, name);
    const misses = [];
    for (const attempt of attempts) {
      try {
        const raw = await this.request(attempt.method, attempt.params, {
          timeoutMs: longMs,
        });
        debugLog("acp", "mcp-auth-ok", { path: attempt.method, server: name });
        return summarizeMcpAuthResult(raw, name);
      } catch (err) {
        const message = err?.message || String(err);
        debugLog("acp", "mcp-auth-try", {
          path: attempt.method,
          server: name,
          error: message,
          code: err?.code,
        });
        if (methodMissing(err)) {
          misses.push(`${attempt.method}: ${message}`);
          continue;
        }
        throw err instanceof Error ? err : new Error(message);
      }
    }
    throw new Error(
      `MCP sign-in is not available on this Grok CLI connection (${misses.join(" · ") || "no methods accepted"}).`,
    );
  }

  /**
   * Live `/mcps` catalog: `x.ai/mcp/list` annotated with session status.
   * @param {{ cache?: boolean }} [opts]
   */
  async listMcpSessionCatalog(opts = {}) {
    if (!this.sessionId) throw new Error("No ACP session");
    const methodMissing = (err) => {
      if (err?.code === -32601) return true;
      return /method not found|-32601|unknown method/i.test(
        String(err?.message || err),
      );
    };
    const attempts = mcpSessionListAttempts(this.sessionId, opts);
    const misses = [];
    for (const attempt of attempts) {
      try {
        const raw = await this.request(attempt.method, attempt.params, {
          timeoutMs: 30_000,
        });
        const payload =
          raw && typeof raw === "object" && raw.result && !raw.servers
            ? raw.result
            : raw;
        return mapMcpSessionCatalog(payload);
      } catch (err) {
        const message = err?.message || String(err);
        debugLog("acp", "mcp-list-try", {
          path: attempt.method,
          error: message,
          code: err?.code,
        });
        if (methodMissing(err)) {
          misses.push(`${attempt.method}: ${message}`);
          continue;
        }
        throw err instanceof Error ? err : new Error(message);
      }
    }
    throw new Error(
      `MCP live status is not available on this Grok CLI connection (${misses.join(" · ") || "no methods accepted"}).`,
    );
  }

  async prompt(text, { images = [], imageQuality = "compact" } = {}) {
    if (!this.sessionId) throw new Error("No ACP session");
    const prompt = [{ type: "text", text }];
    for (const img of images) {
      const compressed = compressPromptImage(img, imageQuality);
      prompt.push({
        type: "image",
        data: compressed.data,
        mimeType: compressed.mimeType || "image/png",
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

  /**
   * Mid-turn steer: grok-build `x.ai/interject`. Does not cancel the turn.
   * Wait tools abort when this lands in the pending-interjection buffer.
   *
   * @param {string} text
   * @param {{
   *   images?: { data: string, mimeType?: string }[],
   *   imageQuality?: string,
   *   interjectionId?: string,
   * }} [opts]
   */
  async interject(text, { images = [], imageQuality = "compact", interjectionId } = {}) {
    if (!this.sessionId) throw new Error("No ACP session");
    const compressed = [];
    for (const img of images) {
      const next = compressPromptImage(img, imageQuality);
      if (next?.data) compressed.push(next);
    }
    const id =
      String(interjectionId || "").trim() || crypto.randomUUID();
    const attempts = interjectAttempts({
      sessionId: this.sessionId,
      text: String(text || ""),
      interjectionId: id,
      images: compressed,
    });
    const misses = [];
    for (const attempt of attempts) {
      try {
        const raw = await this.request(attempt.method, attempt.params, {
          timeoutMs: 15_000,
        });
        debugLog("acp", "interject-ok", { path: attempt.method, id });
        const result = unwrapExtMethodResult(raw);
        const status =
          result && typeof result === "object" && typeof result.status === "string"
            ? result.status
            : "queued";
        return interjectAcceptedResult(id, status);
      } catch (err) {
        const message = err?.message || String(err);
        debugLog("acp", "interject-try", {
          path: attempt.method,
          error: message,
          code: err?.code,
        });
        if (isInterjectMethodMissing(err)) {
          misses.push(err);
          continue;
        }
        throw err instanceof Error ? err : new Error(message);
      }
    }
    debugLog("acp", "interject-unsupported", { attempts: misses.length });
    return interjectFromAttemptErrors(misses, id);
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
   * Remember write/edit/post approvals for the rest of this agent session.
   * @param {boolean} value
   */
  setAllowWritesThisSession(value) {
    this.allowWritesThisSession = Boolean(value);
    this.emit("writes-session", this.allowWritesThisSession);
    return this.allowWritesThisSession;
  }

  /**
   * Apply permission mode on the client and notify the live session via
   * `_x.ai/yolo_mode_changed` (`_` prefix = extension notification).
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
      // Fire-and-forget notification (same as pager stdio); no response expected.
      this.notify(
        YOLO_MODE_CHANGED_METHOD,
        yoloModeChangedParams(this.permissionMode),
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

  /**
   * Switch the live session model without respawning.
   * Passes current reasoning effort so Effort is not reset.
   *
   * @param {string} modelId
   * @returns {Promise<{
   *   modelId: string | null,
   *   modelName: string | null,
   *   availableModels: { modelId: string, name: string }[],
   *   agentSynced: boolean,
   *   error?: string,
   * }>}
   */
  async setModel(modelId) {
    const nextId = String(modelId || "").trim();

    if (!nextId) {
      return {
        ...this._modelsPublic(),
        agentSynced: false,
        error: "modelId required",
      };
    }
    if (nextId === this.currentModelId) {
      return { ...this._modelsPublic(), agentSynced: true };
    }
    const sessionAtStart = this.sessionId;
    if (!sessionAtStart || !this.ready || !this.proc) {
      return {
        ...this._modelsPublic(),
        agentSynced: false,
        error: "Agent is not ready",
      };
    }

    try {
      await this.request(
        "session/set_model",
        {
          sessionId: sessionAtStart,
          modelId: nextId,
          _meta: { reasoningEffort: this.reasoningEffort },
        },
        { timeoutMs: 15_000 },
      );
      // /new or load replaced the live session while this RPC was in flight.
      if (this.sessionId !== sessionAtStart) {
        return {
          ...this._modelsPublic(),
          agentSynced: false,
          error: "Session changed",
        };
      }
      this.currentModelId = nextId;
      const entry = this.availableModels.find((m) => m.modelId === nextId);
      this.currentModelName = entry?.name || nextId;
      return { ...this._modelsPublic(), agentSynced: true };
    } catch (err) {
      return {
        ...this._modelsPublic(),
        agentSynced: false,
        error: err?.message || String(err),
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
