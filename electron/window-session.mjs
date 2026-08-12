/**
 * Per-window agent sessions for File → New Window.
 *
 * Owns: BrowserWindow → agent map, ensureAgent lifecycle, dispose, IPC routing
 * helpers (sessionFromEvent / send). Main only creates windows + registers IPC.
 */
import { app, BrowserWindow } from "electron";
import path from "node:path";
import { GrokAcpClient } from "./acp-client.mjs";
import {
  cancelAllPermissions,
  listPendingPermissionRequests,
  pendingPermissionCount,
  registerPermissionRequest,
} from "./pending-permissions.mjs";
import { startBackgroundTaskFileTail } from "./sessions.mjs";
import {
  debugLog,
  isDebugLogging,
  summarizeSessionUpdate,
} from "./debug-log.mjs";
import { restartTargetFromSources } from "./agent-restart.mjs";

/**
 * Desktop state loader — set once from main at startup.
 * @type {() => Record<string, any>}
 */
let loadDesktopState = () => ({
  permissionMode: "ask",
  reasoningEffort: "high",
  allowOutsideProject: false,
  sandboxTerminal: true,
});

/**
 * Wire desktop-state.json loader (call from main whenReady / registerIpc).
 * @param {() => Record<string, any>} fn
 */
export function setDesktopStateLoader(fn) {
  if (typeof fn === "function") loadDesktopState = fn;
}

/**
 * Per-window session: each File → New Window owns its own agent process.
 * @typedef {{
 *   win: import('electron').BrowserWindow,
 *   agent: GrokAcpClient | null,
 *   agentChain: Promise<unknown>,
 *   stopBackgroundTaskTail: (() => void) | null,
 *   pendingPlanApprovals: Map<string, (decision: any) => void>,
 *   pendingUserQuestions: Map<string, (decision: any) => void>,
 *   disposed: boolean,
 *   generation: number,
 *   lastCwd: string | null,
 *   lastSessionId: string | null,
 * }} WindowSession
 */

/**
 * Keep last project so Restart still works after a failed spawn nulled `agent`.
 * @param {WindowSession} ws
 * @param {string | null | undefined} cwd
 * @param {string | null | undefined} sessionId
 */
function rememberProjectOnWindow(ws, cwd, sessionId) {
  if (!ws || !cwd) return;
  ws.lastCwd = cwd;
  ws.lastSessionId = sessionId || null;
}

/** @type {Map<number, WindowSession>} */
export const windowSessions = new Map();

/** @returns {string} */
export function ownerIdFor(ws) {
  return String(ws.win.id);
}

/**
 * @param {WindowSession} ws
 * @param {number} generation
 */
export function isSessionLive(ws, generation) {
  return (
    !ws.disposed &&
    Boolean(ws.win) &&
    !ws.win.isDestroyed() &&
    ws.generation === generation
  );
}

/**
 * @param {import('electron').IpcMainInvokeEvent | { sender?: Electron.WebContents }} event
 * @returns {WindowSession | null}
 */
export function sessionFromEvent(event) {
  const wc = event?.sender;
  if (!wc || wc.isDestroyed?.()) return null;
  const win = BrowserWindow.fromWebContents(wc);
  if (!win || win.isDestroyed()) return null;
  return windowSessions.get(win.id) || null;
}

/** Focused window's session, else the first open window. */
export function focusedSession() {
  const focused = BrowserWindow.getFocusedWindow();
  if (focused && !focused.isDestroyed() && windowSessions.has(focused.id)) {
    return windowSessions.get(focused.id) || null;
  }
  for (const ws of windowSessions.values()) {
    if (ws.win && !ws.win.isDestroyed()) return ws;
  }
  return null;
}

/**
 * @param {WindowSession} ws
 * @returns {WindowSession}
 */
export function trackWindowSession(ws) {
  windowSessions.set(ws.win.id, ws);
  ws.win.on("closed", () => {
    void disposeWindowSession(ws);
    windowSessions.delete(ws.win.id);
  });
  return ws;
}

/**
 * Push an IPC event to one window's renderer.
 * @param {WindowSession | null | undefined} ws
 * @param {string} channel
 * @param {unknown} [payload]
 */
export function send(ws, channel, payload) {
  if (!ws?.win || ws.win.isDestroyed()) return;
  try {
    ws.win.webContents.send(channel, payload);
  } catch (err) {
    debugLog("ipc", "send-failed", {
      channel,
      error: err?.message || String(err),
    });
  }
}

export const APP_WINDOW_TITLE = "Grok Desktop";

/**
 * Native title from session state: project basename, else empty shell.
 * Multi empty shells use window id (not DevTools BrowserWindows).
 * @param {WindowSession | null | undefined} ws
 * @param {string | null | undefined} cwd
 */
export function setWindowTitle(ws, cwd) {
  if (!ws?.win || ws.win.isDestroyed()) return;
  if (cwd) {
    const trimmed = String(cwd).replace(/[/\\]+$/, "");
    const short =
      path.basename(trimmed) ||
      trimmed ||
      String(cwd);
    ws.win.setTitle(`${short} · Grok`);
    return;
  }
  let shells = 0;
  for (const s of windowSessions.values()) {
    if (s.win && !s.win.isDestroyed()) shells++;
  }
  ws.win.setTitle(
    shells <= 1 ? APP_WINDOW_TITLE : `${APP_WINDOW_TITLE} · ${ws.win.id}`,
  );
}

/** @param {any} client */
async function killAgentClient(client) {
  if (!client) return;
  try {
    const p = client.dispose();
    if (p && typeof p.then === "function") await p.catch(() => {});
  } catch {
    /* ignore */
  }
  try {
    if (client.proc && !client.proc.killed) {
      client.proc.kill("SIGKILL");
    }
  } catch {
    /* ignore */
  }
}

/**
 * Drop the project/agent on a live window (keep the BrowserWindow).
 * Title follows session state — no separate "reset title" API.
 * Nulls agent before kill so the client `exit` handler does not push
 * "Agent process exited" into the renderer.
 * @param {WindowSession | null | undefined} ws
 * @returns {boolean}
 */
export function clearProjectOnWindow(ws) {
  if (!ws || ws.disposed || !ws.win || ws.win.isDestroyed()) return false;
  ws.generation = (ws.generation || 0) + 1;
  try {
    ws.stopBackgroundTaskTail?.();
  } catch {
    /* ignore */
  }
  ws.stopBackgroundTaskTail = null;
  const a = ws.agent;
  ws.agent = null;
  ws.lastCwd = null;
  ws.lastSessionId = null;
  try {
    clearPendingPermissions(ws);
  } catch {
    /* ignore */
  }
  ws.agentChain = ws.agentChain
    .then(() => killAgentClient(a), () => killAgentClient(a))
    .then(
      () => undefined,
      () => undefined,
    );
  setWindowTitle(ws, null);
  return true;
}

export function makeReqId(prefix) {
  if (typeof crypto.randomUUID === "function") {
    return `${prefix}_${crypto.randomUUID()}`;
  }
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Clear pending UI gates for one window. Each stored callback is a main-owned
 * settle wrapper that also dismisses the renderer modal.
 * @param {WindowSession} ws
 */
export function clearPendingPermissions(ws) {
  const owner = ownerIdFor(ws);
  cancelAllPermissions(undefined, owner);
  const plans = [...ws.pendingPlanApprovals.values()];
  const asks = [...ws.pendingUserQuestions.values()];
  ws.pendingPlanApprovals.clear();
  ws.pendingUserQuestions.clear();
  for (const settle of plans) {
    try {
      settle({ type: "abandoned" });
    } catch {
      /* ignore */
    }
  }
  for (const settle of asks) {
    try {
      settle({ type: "declined" });
    } catch {
      /* ignore */
    }
  }
  send(ws, "agent:permissions-cleared", {});
}

/**
 * Follow updates.jsonl for background task events for the live session.
 * @param {WindowSession} ws
 * @param {string} cwd
 * @param {string | null | undefined} sessionId
 */
export function restartBackgroundTaskTail(ws, cwd, sessionId) {
  try {
    ws.stopBackgroundTaskTail?.();
  } catch {
    /* ignore */
  }
  ws.stopBackgroundTaskTail = null;
  if (!cwd || !sessionId) return;
  ws.stopBackgroundTaskTail = startBackgroundTaskFileTail({
    cwd,
    sessionId,
    onParams: (params) => {
      send(ws, "agent:session-update", params);
    },
  });
}

/**
 * Drop a client that was created after the window closed / was replaced.
 * @param {GrokAcpClient | null | undefined} client
 */
export async function disposeOrphanClient(client) {
  if (!client) return;
  try {
    const p = client.dispose();
    if (p && typeof p.then === "function") await p.catch(() => {});
  } catch {
    /* ignore */
  }
  try {
    if (client.proc && !client.proc.killed) client.proc.kill("SIGKILL");
  } catch {
    /* ignore */
  }
}

/**
 * Ensure agent process for cwd on this window, optionally resuming a CLI session.
 * Serialized per window — concurrent open/switch cannot race dispose/start.
 * Aborts cleanly if the window is closed mid-flight (no orphaned grok processes).
 * @param {WindowSession} ws
 * @param {string} cwd
 * @param {{
 *   resumeSessionId?: string | null,
 *   forceNew?: boolean,
 *   forceRestart?: boolean,
 * }} [opts]
 *   forceRestart — dispose and respawn even if cwd/session match (CLI flags
 *   like --always-approve are fixed at process spawn).
 */
export function ensureAgent(ws, cwd, opts = {}) {
  const run = async () => {
    const gen = ws.generation;
    if (!isSessionLive(ws, gen)) {
      throw new Error("Window closed");
    }

    const resumeSessionId = opts.resumeSessionId || null;
    const forceNew = Boolean(opts.forceNew);
    const forceRestart = Boolean(opts.forceRestart);
    let agent = ws.agent;

    // Always-approve boundary: must respawn process for CLI flags.
    if (forceRestart && agent) {
      rememberProjectOnWindow(ws, agent.cwd, agent.sessionId);
      clearPendingPermissions(ws);
      await agent.dispose();
      if (ws.agent === agent) ws.agent = null;
      agent = null;
      if (!isSessionLive(ws, gen)) {
        throw new Error("Window closed");
      }
    }

    if (agent?.ready && agent.cwd === cwd && agent.proc) {
      if (forceNew) {
        clearPendingPermissions(ws);
        await agent.newSession();
        if (!isSessionLive(ws, gen) || ws.agent !== agent) {
          throw new Error("Window closed");
        }
        rememberProjectOnWindow(ws, cwd, agent.sessionId);
        restartBackgroundTaskTail(ws, cwd, agent.sessionId);
        return agent;
      }
      if (resumeSessionId && resumeSessionId !== agent.sessionId) {
        clearPendingPermissions(ws);
        await agent.loadSession(resumeSessionId);
        if (!isSessionLive(ws, gen) || ws.agent !== agent) {
          throw new Error("Window closed");
        }
        rememberProjectOnWindow(ws, cwd, agent.sessionId);
        restartBackgroundTaskTail(ws, cwd, agent.sessionId);
        return agent;
      }
      if (resumeSessionId && resumeSessionId === agent.sessionId) {
        rememberProjectOnWindow(ws, cwd, agent.sessionId);
        restartBackgroundTaskTail(ws, cwd, agent.sessionId);
        return agent;
      }
      if (!resumeSessionId && !forceNew) {
        rememberProjectOnWindow(ws, cwd, agent.sessionId);
        restartBackgroundTaskTail(ws, cwd, agent.sessionId);
        return agent;
      }
    }

    if (agent) {
      rememberProjectOnWindow(ws, agent.cwd, agent.sessionId);
      clearPendingPermissions(ws);
      await agent.dispose();
      if (ws.agent === agent) ws.agent = null;
      agent = null;
      if (!isSessionLive(ws, gen)) {
        throw new Error("Window closed");
      }
    }

    const state = loadDesktopState();
    agent = new GrokAcpClient({
      cwd,
      permissionMode: state.permissionMode,
      reasoningEffort: state.reasoningEffort,
      allowOutsideProject: Boolean(state.allowOutsideProject),
      sandboxTerminal: state.sandboxTerminal !== false,
      clientVersion: app.getVersion(),
    });

    if (!isSessionLive(ws, gen)) {
      await disposeOrphanClient(agent);
      throw new Error("Window closed");
    }
    ws.agent = agent;

    /** Only deliver events while this client is still the window's live agent. */
    const ifCurrent = (fn) => {
      return (...args) => {
        if (ws.agent !== agent || ws.disposed) return;
        return fn(...args);
      };
    };

    agent.on(
      "session-update",
      ifCurrent((params) => {
        if (isDebugLogging()) {
          debugLog("acp", "session-update", summarizeSessionUpdate(params));
        }
        send(ws, "agent:session-update", params);
      }),
    );

    agent.on(
      "permission-request",
      ifCurrent(({ params, respond }) => {
        const reqId = makeReqId("perm");
        const owner = ownerIdFor(ws);
        const request = registerPermissionRequest({
          reqId,
          params,
          respond,
          ownerId: owner,
          onSettled: (id, outcome) => {
            debugLog("permission", "respond", { reqId: id, outcome });
            if (ws.agent === agent) {
              send(ws, "agent:permission-dismiss", { reqId: id });
            }
          },
        });
        const tool =
          request.params?.toolCall?.title ||
          request.params?.toolCall?.kind ||
          "tool";
        const toolCallId = request.params?.toolCall?.toolCallId;
        // Always log — silent missed approvals look like a hung "Working…" turn.
        console.warn(
          `[permission] request ${reqId} tool=${tool} toolCallId=${toolCallId || "?"}`,
        );
        debugLog("permission", "request", { reqId, tool, toolCallId, owner });
        // JSON-RPC is still answered once (pending map). Re-push the UI event once
        // so HMR / late renderer subscribe still show the approval card.
        send(ws, "agent:permission-request", request);
        setTimeout(() => {
          if (ws.agent !== agent) return;
          if (pendingPermissionCount(owner) === 0) return;
          const still = listPendingPermissionRequests(owner).find(
            (p) => p.reqId === reqId,
          );
          if (still) send(ws, "agent:permission-request", still);
        }, 750);
        // Make escalations unmissable when the window is in the background.
        try {
          if (ws.win && !ws.win.isDestroyed()) {
            if (typeof ws.win.flashFrame === "function") {
              ws.win.flashFrame(true);
            }
            if (process.platform === "darwin" && app.dock?.bounce) {
              app.dock.bounce("informational");
            }
          }
        } catch {
          /* ignore */
        }
      }),
    );

    agent.on(
      "plan-approval-request",
      ifCurrent(({ params, respond }) => {
        const reqId = makeReqId("plan");
        let settled = false;
        /** @type {ReturnType<typeof setTimeout> | null} */
        let timer = null;
        const settle = (decision) => {
          if (settled) return;
          settled = true;
          if (timer) clearTimeout(timer);
          timer = null;
          ws.pendingPlanApprovals.delete(reqId);
          try {
            respond(decision || { type: "abandoned" });
          } catch {
            /* ignore */
          }
          if (ws.agent === agent) {
            send(ws, "agent:plan-approval-dismiss", {
              reqId,
              timedOut: Boolean(decision?.timedOut),
            });
          }
        };
        // Main owns timeout so map + UI dismiss go through the same settle path
        timer = setTimeout(
          () => settle({ type: "abandoned", timedOut: true }),
          30 * 60_000,
        );
        ws.pendingPlanApprovals.set(reqId, settle);
        send(ws, "agent:plan-approval-request", { reqId, params });
      }),
    );

    agent.on(
      "user-question-request",
      ifCurrent(({ params, respond }) => {
        const reqId = makeReqId("ask");
        let settled = false;
        /** @type {ReturnType<typeof setTimeout> | null} */
        let timer = null;
        const settle = (decision) => {
          if (settled) return;
          settled = true;
          if (timer) clearTimeout(timer);
          timer = null;
          ws.pendingUserQuestions.delete(reqId);
          try {
            respond(decision || { type: "declined" });
          } catch {
            /* ignore */
          }
          if (ws.agent === agent) {
            send(ws, "agent:user-question-dismiss", {
              reqId,
              timedOut: Boolean(decision?.timedOut),
            });
          }
        };
        timer = setTimeout(
          () => settle({ type: "declined", timedOut: true }),
          10 * 60_000,
        );
        ws.pendingUserQuestions.set(reqId, settle);
        send(ws, "agent:user-question-request", { reqId, params });
      }),
    );

    agent.on(
      "stderr",
      ifCurrent((text) => send(ws, "agent:stderr", text)),
    );
    agent.on(
      "error",
      ifCurrent((err) =>
        send(ws, "agent:error", { message: err?.message || String(err) }),
      ),
    );
    agent.on("exit", (info) => {
      // Stale exit after replace must not clear the *new* agent's permissions
      if (ws.agent !== agent) return;
      clearPendingPermissions(ws);
      send(ws, "agent:exit", info);
    });
    // Do not push agent:ready for conn — renderer only trusts open IPC results
    agent.on(
      "ready",
      ifCurrent((info) => send(ws, "agent:ready", info)),
    );

    try {
      await agent.start({
        resumeSessionId: forceNew ? null : resumeSessionId,
      });
    } catch (err) {
      if (ws.agent === agent) ws.agent = null;
      await disposeOrphanClient(agent);
      throw err;
    }

    if (!isSessionLive(ws, gen) || ws.agent !== agent) {
      await disposeOrphanClient(agent);
      if (ws.agent === agent) ws.agent = null;
      throw new Error("Window closed");
    }
    rememberProjectOnWindow(ws, cwd, agent.sessionId);
    restartBackgroundTaskTail(ws, cwd, agent.sessionId);
    return agent;
  };

  const next = ws.agentChain.then(run, run);
  ws.agentChain = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}


export function disposeWindowSession(ws) {
  if (ws.disposed) return;
  ws.disposed = true;
  ws.generation = (ws.generation || 0) + 1;
  try {
    ws.stopBackgroundTaskTail?.();
  } catch {
    /* ignore */
  }
  ws.stopBackgroundTaskTail = null;
  const a = ws.agent;
  ws.agent = null;
  ws.lastCwd = null;
  ws.lastSessionId = null;
  try {
    clearPendingPermissions(ws);
  } catch {
    /* ignore */
  }

  // Serialize with ensureAgent so mid-flight start() cannot outlive the window.
  const cleanup = async () => {
    await killAgentClient(a);
    const leftover = ws.agent;
    ws.agent = null;
    if (leftover && leftover !== a) {
      await killAgentClient(leftover);
    }
  };
  ws.agentChain = ws.agentChain.then(cleanup, cleanup).then(
    () => undefined,
    () => undefined,
  );
  void ws.agentChain;
}

/**
 * Tear down every window agent without blocking quit (auto-update / before-quit).
 */
export function disposeAgentQuick() {
  for (const ws of [...windowSessions.values()]) {
    disposeWindowSession(ws);
  }
}


/**
 * Open / resume a session on a window: ensureAgent + history load.
 * Shared by project:open and sessions:open IPC.
 *
 * @param {WindowSession} ws
 * @param {{
 *   cwd: string,
 *   mode?: 'continue' | 'new' | 'resume',
 *   sessionId?: string | null,
 *   loadState?: (cwd: string, sessionId: string) => { items?: any[], tasks?: any[], usage?: any },
 *   listSessions?: (cwd: string) => any[],
 *   mostRecent?: (cwd: string) => { id: string } | null,
 *   remember?: (cwd: string, sessionId: string) => void,
 * }} opts
 */
export async function openSessionOnWindow(ws, opts) {
  const cwd = opts.cwd;
  const mode = opts.mode || "continue";
  let resumeSessionId = null;
  let forceNew = false;

  if (mode === "new") {
    forceNew = true;
  } else if (mode === "resume" && opts.sessionId) {
    resumeSessionId = opts.sessionId;
  } else if (mode === "continue" || !mode) {
    resumeSessionId = opts.mostRecent?.(cwd)?.id || null;
  } else if (opts.sessionId) {
    resumeSessionId = opts.sessionId;
  }

  let client;
  let resumeWarning = null;
  try {
    client = await ensureAgent(ws, cwd, { resumeSessionId, forceNew });
  } catch (err) {
    if (resumeSessionId && !forceNew) {
      console.warn(
        "[openSessionOnWindow] resume failed, starting new session:",
        err?.message || err,
      );
      resumeWarning = err?.message || "Could not resume that chat; started a new session.";
      client = await ensureAgent(ws, cwd, { forceNew: true });
      forceNew = true;
      resumeSessionId = null;
    } else {
      throw err;
    }
  }

  opts.remember?.(cwd, client.sessionId);
  setWindowTitle(ws, client.cwd);
  restartBackgroundTaskTail(ws, cwd, client.sessionId);

  let history = [];
  /** @type {any[]} */
  let backgroundTasks = [];
  /** @type {any} */
  let usage = null;
  if (client.sessionId && !forceNew && opts.loadState) {
    const loaded = opts.loadState(cwd, client.sessionId);
    history = loaded.items || [];
    backgroundTasks = loaded.tasks || [];
    usage = loaded.usage || null;
  }

  return {
    cwd: client.cwd,
    sessionId: client.sessionId,
    grokBinary: client.grokPath,
    resumed: Boolean(resumeSessionId) && !forceNew,
    modelId: client.currentModelId || null,
    modelName: client.currentModelName || null,
    history,
    backgroundTasks,
    usage,
    sessions: opts.listSessions?.(cwd) || [],
    warning: resumeWarning,
  };
}

/**
 * Force-respawn this window's agent and resume the current chat.
 * ~/.grok / CLI flags bind at spawn — must dispose even when cwd matches.
 *
 * @param {WindowSession} ws
 * @param {{
 *   loadState?: (cwd: string, sessionId: string) => { items?: any[], tasks?: any[], usage?: any },
 *   listSessions?: (cwd: string) => any[],
 *   remember?: (cwd: string, sessionId: string) => void,
 * }} [opts]
 */
export async function restartAgentOnWindow(ws, opts = {}) {
  if (!ws || ws.disposed || !ws.win || ws.win.isDestroyed()) {
    throw new Error("No window for agent:restart");
  }
  const target = restartTargetFromSources(ws.agent, {
    cwd: ws.lastCwd,
    sessionId: ws.lastSessionId,
  });
  if (!target) {
    throw new Error("No project open");
  }
  rememberProjectOnWindow(ws, target.cwd, target.resumeSessionId);

  let client;
  let resumeWarning = null;
  let resumed = Boolean(target.resumeSessionId);
  try {
    client = await ensureAgent(ws, target.cwd, {
      resumeSessionId: target.resumeSessionId,
      forceRestart: true,
    });
  } catch (err) {
    if (target.resumeSessionId) {
      console.warn(
        "[restartAgentOnWindow] resume failed, starting new session:",
        err?.message || err,
      );
      resumeWarning =
        err?.message || "Could not resume that chat; started a new session.";
      client = await ensureAgent(ws, target.cwd, {
        forceNew: true,
        forceRestart: true,
      });
      resumed = false;
    } else {
      throw err;
    }
  }

  opts.remember?.(target.cwd, client.sessionId);
  setWindowTitle(ws, client.cwd);
  restartBackgroundTaskTail(ws, target.cwd, client.sessionId);

  let history = [];
  /** @type {any[]} */
  let backgroundTasks = [];
  /** @type {any} */
  let usage = null;
  if (client.sessionId && resumed && opts.loadState) {
    const loaded = opts.loadState(target.cwd, client.sessionId);
    history = loaded.items || [];
    backgroundTasks = loaded.tasks || [];
    usage = loaded.usage || null;
  }

  return {
    cwd: client.cwd,
    sessionId: client.sessionId,
    grokBinary: client.grokPath,
    resumed,
    modelId: client.currentModelId || null,
    modelName: client.currentModelName || null,
    history,
    backgroundTasks,
    usage,
    sessions: opts.listSessions?.(target.cwd) || [],
    warning: resumeWarning,
  };
}

/**
 * Fan out permission mode; restart all agents when always-approve boundary crosses.
 * @param {string} mode
 * @param {string} prev
 */
export async function applyPermissionModeToAllWindows(mode, prev) {
  const prevAlways = prev === "always-approve";
  const nextAlways = mode === "always-approve";
  /** @type {{ mode: string, agentSynced: boolean, error?: string, restarted?: boolean }} */
  let result = { mode, agentSynced: false };

  if (prevAlways !== nextAlways) {
    let anyRestarted = false;
    let allSynced = true;
    /** @type {string | undefined} */
    let lastError;
    let liveCount = 0;
    for (const other of [...windowSessions.values()]) {
      if (other.disposed || !other.win || other.win.isDestroyed()) continue;
      const a = other.agent;
      if (!a?.ready || !a.cwd) {
        if (a?.setPermissionMode) {
          try {
            await a.setPermissionMode(mode);
          } catch {
            /* ignore */
          }
        }
        continue;
      }
      liveCount++;
      anyRestarted = true;
      const cwd = a.cwd;
      const sid = a.sessionId;
      // Serialize dispose+respawn on the window's agentChain (via ensureAgent)
      try {
        await ensureAgent(other, cwd, {
          resumeSessionId: sid || null,
          forceRestart: true,
        });
      } catch (err) {
        allSynced = false;
        lastError = err?.message || String(err);
      }
    }
    // No live agents → state already consistent, nothing to attach
    if (liveCount === 0) {
      return { mode, agentSynced: true, restarted: false };
    }
    result = {
      mode,
      agentSynced: allSynced,
      restarted: anyRestarted,
    };
    if (lastError) result.error = lastError;
    return result;
  }

  let synced = false;
  for (const other of windowSessions.values()) {
    if (other.disposed || !other.agent?.setPermissionMode) continue;
    try {
      result = await other.agent.setPermissionMode(mode);
      synced = true;
    } catch {
      /* ignore */
    }
  }
  if (!synced) result = { mode, agentSynced: true, restarted: false };
  return result;
}

/**
 * Create and register a WindowSession for a BrowserWindow.
 * Owns shell chrome that is session-scoped: block page title clobber,
 * apply empty-shell title. Project titles come from openSessionOnWindow.
 * @param {import('electron').BrowserWindow} win
 * @returns {WindowSession}
 */
export function createWindowSession(win) {
  /** @type {WindowSession} */
  const ws = {
    win,
    agent: null,
    agentChain: Promise.resolve(),
    stopBackgroundTaskTail: null,
    pendingPlanApprovals: new Map(),
    pendingUserQuestions: new Map(),
    disposed: false,
    generation: 0,
    lastCwd: null,
    lastSessionId: null,
  };
  // Main owns native titles; HTML <title> / document.title must not clobber.
  win.on("page-title-updated", (e) => {
    e.preventDefault();
  });
  trackWindowSession(ws);
  setWindowTitle(ws, null);
  return ws;
}
