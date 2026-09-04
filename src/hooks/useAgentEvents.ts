import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import { agentCommandsFromUpdate, type SlashCommand } from "../lib/commands";
import {
  applyBackgroundUpdate,
  type BackgroundTask,
} from "../lib/background-tasks";
import { applySessionInterjection, applySessionUpdate } from "../lib/timeline";
import { selfInterjectionIds } from "../lib/self-interjections";
import {
  applyUsageUpdate,
  emptyUsage,
  type SessionUsage,
} from "../lib/usage";
import type { PlanApprovalRequest } from "../components/PlanApprovalDialog";
import type { AskUserRequest } from "../components/AskUserDialog";
import type { FolderTrustRequest } from "../components/FolderTrustDialog";
import type { ConnState } from "../lib/conn";
import type { PermissionRequest, TimelineItem } from "../vite-env";
import {
  classifyOptionId,
  extractToolCallId,
  permissionOutcomeFromUi,
} from "../../shared/permission-options.mjs";
import type { McpElicitRequest } from "../components/McpElicitDialog";

function isAllowChoice(optionId: string, options?: PermissionRequest["params"]["options"]): boolean {
  if (optionId === "cancelled" || optionId === "cancel") return false;
  const cls = classifyOptionId(optionId, options);
  return (
    cls === "allow_once" ||
    cls === "allow_always" ||
    cls === "enable_always_approve"
  );
}

function toolCallIdFromPermission(p: PermissionRequest | undefined): string | null {
  if (!p) return null;
  return extractToolCallId(p.params) || extractToolCallId(p.params?.toolCall);
}

function keepIfSameReq<T extends { reqId: string }>(
  cur: T | null,
  next: T | null,
): T | null {
  if (!next) return null;
  if (cur?.reqId === next.reqId) return cur;
  return next;
}

function folderTrustFromRow(row: {
  reqId?: string;
  params?: {
    cwd?: string;
    workspace?: string;
    configKinds?: string[];
  };
} | null | undefined): FolderTrustRequest | null {
  if (!row?.reqId) return null;
  return {
    reqId: row.reqId,
    cwd: row.params?.cwd,
    workspace: row.params?.workspace,
    configKinds: row.params?.configKinds,
  };
}

function planApprovalFromRow(row: {
  reqId?: string;
  params?: { planContent?: string; planFilePath?: string | null };
} | null | undefined): PlanApprovalRequest | null {
  if (!row?.reqId) return null;
  return {
    reqId: row.reqId,
    planContent: row.params?.planContent || "",
    planFilePath: row.params?.planFilePath,
  };
}

function userQuestionFromRow(row: {
  reqId?: string;
  params?: { questions?: unknown };
} | null | undefined): AskUserRequest | null {
  if (!row?.reqId) return null;
  return {
    reqId: row.reqId,
    questions: Array.isArray(row.params?.questions)
      ? (row.params.questions as AskUserRequest["questions"])
      : [],
  };
}

function mcpElicitFromRow(row: {
  reqId?: string;
  params?: {
    serverName?: string;
    message?: string;
    mode?: "form" | "url";
    url?: string;
    elicitationId?: string;
    requestedSchema?: unknown;
  };
} | null | undefined): McpElicitRequest | null {
  if (!row?.reqId) return null;
  return {
    reqId: row.reqId,
    serverName: row.params?.serverName || "",
    message: row.params?.message || "",
    mode: row.params?.mode === "url" ? "url" : "form",
    url: row.params?.url,
    elicitationId: row.params?.elicitationId,
    requestedSchema: row.params?.requestedSchema,
  };
}

/**
 * Subscribe to agent IPC: timeline updates, permissions, plan/ask modals,
 * background tasks, session mode.
 */
export function useAgentEvents(opts: {
  openingRef: MutableRefObject<boolean>;
  setConn: Dispatch<SetStateAction<ConnState>>;
  setError: Dispatch<SetStateAction<string | null>>;
  setSessionId: Dispatch<SetStateAction<string | null>>;
  setItems: Dispatch<SetStateAction<TimelineItem[]>>;
  setAgentCommands: Dispatch<SetStateAction<SlashCommand[]>>;
  setSettingsOpen: Dispatch<SetStateAction<boolean>>;
}) {
  const {
    openingRef,
    setConn,
    setError,
    setSessionId,
    setItems,
    setAgentCommands,
    setSettingsOpen,
  } = opts;

  const [permissions, setPermissions] = useState<PermissionRequest[]>([]);
  const [backgroundTasks, setBackgroundTasks] = useState<BackgroundTask[]>(
    [],
  );
  const [sessionMode, setSessionMode] = useState<string | null>(null);
  const [planApproval, setPlanApproval] =
    useState<PlanApprovalRequest | null>(null);
  const [userQuestion, setUserQuestion] = useState<AskUserRequest | null>(
    null,
  );
  const [folderTrust, setFolderTrust] = useState<FolderTrustRequest | null>(
    null,
  );
  const [mcpElicit, setMcpElicit] = useState<McpElicitRequest | null>(null);
  const [sessionUsage, setSessionUsage] = useState<SessionUsage>(emptyUsage);
  const [allowWritesThisSession, setAllowWritesThisSession] =
    useState(false);

  /**
   * Bumped on every live permission push so an in-flight list→replace
   * re-syncs instead of wiping a request that landed after the snapshot.
   */
  const permissionEpoch = useRef(0);
  /** Same idea for parked plan/ask/trust/elicit (no 1.5s poll). */
  const gateEpoch = useRef(0);

  /**
   * Main owns open tool gates. Replace renderer mirror from the main list
   * (mount / open / HMR). Live push events also update the mirror.
   * Loops until no permission-request arrives mid-await (epoch stable).
   */
  const syncPermissionsFromMain = useCallback(async () => {
    for (;;) {
      const epochAtStart = permissionEpoch.current;
      try {
        const list = await window.grokDesktop.listPendingPermissions();
        if (Array.isArray(list)) {
          const next = list.filter(
            (p): p is PermissionRequest => Boolean(p?.reqId),
          );
          // Avoid re-render loops (and scroll side-effects) when nothing changed.
          setPermissions((prev) => {
            if (
              prev.length === next.length &&
              prev.every((p, i) => p.reqId === next[i]?.reqId)
            ) {
              return prev;
            }
            return next;
          });
        }
      } catch {
        /* ignore */
      }
      // Push arrived during await — list again until stable.
      if (permissionEpoch.current === epochAtStart) break;
    }
  }, []);

  /**
   * Main owns parked reverse-requests. Replace renderer modals from the
   * parked maps (open / HMR). Skip applying a snapshot if a live push
   * arrived during the await (empty list must not clobber trust-2).
   */
  const syncAgentGatesFromMain = useCallback(async () => {
    await syncPermissionsFromMain();
    for (;;) {
      const epochAtStart = gateEpoch.current;
      try {
        const gates = await window.grokDesktop.listPendingGates();
        if (gateEpoch.current !== epochAtStart) continue;
        const folder = Array.isArray(gates?.folderTrust)
          ? gates.folderTrust[0]
          : null;
        const plan = Array.isArray(gates?.planApprovals)
          ? gates.planApprovals[0]
          : null;
        const ask = Array.isArray(gates?.userQuestions)
          ? gates.userQuestions[0]
          : null;
        const elicit = Array.isArray(gates?.mcpElicits)
          ? gates.mcpElicits[0]
          : null;
        setFolderTrust((cur) => keepIfSameReq(cur, folderTrustFromRow(folder)));
        setPlanApproval((cur) => keepIfSameReq(cur, planApprovalFromRow(plan)));
        setUserQuestion((cur) => keepIfSameReq(cur, userQuestionFromRow(ask)));
        setMcpElicit((cur) => keepIfSameReq(cur, mcpElicitFromRow(elicit)));
      } catch {
        /* ignore */
      }
      if (gateEpoch.current === epochAtStart) break;
    }
  }, [syncPermissionsFromMain]);

  useEffect(() => {
    void syncAgentGatesFromMain();
    // Safety net: if a permission push was dropped (HMR, late subscribe, focus),
    // the agent still waits and the UI stays on "Working…" with no Approvals.
    // Poll while we may be mid-turn or whenever main already holds gates.
    const poll = window.setInterval(() => {
      void syncPermissionsFromMain();
    }, 1500);
    const offs = [
      window.grokDesktop.on("agent:session-interjection", (payload) => {
        const text = String(
          (payload as { text?: string } | null)?.text || "",
        );
        const interjectionId = String(
          (payload as { interjectionId?: string } | null)?.interjectionId ||
            "",
        );
        setItems((prev) =>
          applySessionInterjection(
            prev,
            { text, interjectionId },
            selfInterjectionIds(),
          ),
        );
      }),
      window.grokDesktop.on("agent:session-update", (params) => {
        const update = params?.update ?? params;
        const kind = update?.sessionUpdate || update?.session_update;

        if (kind === "available_commands_update") {
          setAgentCommands(agentCommandsFromUpdate(update));
          // Do not return before usage: stream meta often rides this event
        } else if (kind === "current_mode_update") {
          const modeId =
            update?.currentModeId ||
            update?.modeId ||
            update?.current_mode_id ||
            null;
          setSessionMode(modeId ? String(modeId) : null);
        }
        if (
          kind === "task_backgrounded" ||
          kind === "task_completed" ||
          kind === "subagent_spawned" ||
          kind === "subagent_finished" ||
          // Fallback when extension events are missed: BackgroundTaskStarted in tool result
          kind === "tool_call" ||
          kind === "tool_call_update"
        ) {
          setBackgroundTasks((prev) => {
            const next = applyBackgroundUpdate(prev, params);
            return next === prev ? prev : next;
          });
        }
        // Ordered pipeline: ignore live usage while project/session is opening;
        // disk hydrate (replace) runs in applyOpenResult, then live accumulates.
        if (
          !openingRef.current &&
          (kind === "turn_completed" ||
            kind === "turn_complete" ||
            kind === "auto_compact_completed" ||
            kind === "compact_completed" ||
            params?._meta?.totalTokens != null ||
            update?.totalTokens != null)
        ) {
          setSessionUsage((prev) => applyUsageUpdate(prev, params));
        }
        if (kind !== "available_commands_update") {
          setItems((prev) => applySessionUpdate(prev, params));
        }
      }),
      window.grokDesktop.on("agent:permission-request", (payload) => {
        const p = payload as PermissionRequest;
        if (!p?.reqId) return;
        permissionEpoch.current += 1;
        setPermissions((prev) => {
          if (prev.some((x) => x.reqId === p.reqId)) return prev;
          return [...prev, p];
        });
        // Agent is blocked on approval — do not leave the tool looking "in_progress"
        // (that reads as hung Working… with no Approvals UI).
        const toolId = toolCallIdFromPermission(p);
        const title = p.params?.toolCall?.title;
        setItems((prev) => {
          const id = toolId ? String(toolId) : null;
          let matched = false;
          const next = prev.map((item) => {
            if (item.kind !== "tool") return item;
            if (id && String(item.toolCallId) === id) {
              matched = true;
              const st = String(item.status || "").toLowerCase();
              if (st === "completed" || st === "failed" || st === "error") {
                return item;
              }
              return { ...item, status: "pending" };
            }
            return item;
          });
          if (matched || !title) return next;
          for (let i = next.length - 1; i >= 0; i--) {
            const item = next[i];
            if (item.kind !== "tool") continue;
            if (item.title !== title) continue;
            const st = String(item.status || "").toLowerCase();
            if (st === "pending" || st === "in_progress" || !st) {
              const copy = [...next];
              copy[i] = { ...item, status: "pending" };
              return copy;
            }
          }
          return next;
        });
      }),
      window.grokDesktop.on("agent:permission-dismiss", (payload) => {
        const reqId = (payload as { reqId?: string })?.reqId;
        if (!reqId) return;
        setPermissions((prev) => prev.filter((p) => p.reqId !== reqId));
      }),
      window.grokDesktop.on("agent:plan-approval-request", (payload) => {
        gateEpoch.current += 1;
        const p = payload as {
          reqId: string;
          params?: { planContent?: string; planFilePath?: string | null };
        };
        setPlanApproval({
          reqId: p.reqId,
          planContent: p.params?.planContent || "",
          planFilePath: p.params?.planFilePath,
        });
      }),
      window.grokDesktop.on("agent:plan-approval-dismiss", (payload) => {
        gateEpoch.current += 1;
        const reqId = (payload as { reqId?: string })?.reqId;
        setPlanApproval((cur) => {
          if (!cur) return null;
          if (reqId && cur.reqId !== reqId) return cur;
          return null;
        });
        setSessionMode(null);
      }),
      window.grokDesktop.on("agent:user-question-request", (payload) => {
        gateEpoch.current += 1;
        const p = payload as {
          reqId: string;
          params?: { questions?: AskUserRequest["questions"] };
        };
        setUserQuestion({
          reqId: p.reqId,
          questions: p.params?.questions || [],
        });
      }),
      window.grokDesktop.on("agent:user-question-dismiss", (payload) => {
        gateEpoch.current += 1;
        const reqId = (payload as { reqId?: string })?.reqId;
        setUserQuestion((cur) => {
          if (!cur) return null;
          if (reqId && cur.reqId !== reqId) return cur;
          return null;
        });
      }),
      window.grokDesktop.on("agent:folder-trust-request", (payload) => {
        gateEpoch.current += 1;
        setFolderTrust(
          folderTrustFromRow(
            payload as {
              reqId: string;
              params?: {
                cwd?: string;
                workspace?: string;
                configKinds?: string[];
              };
            },
          ),
        );
      }),
      window.grokDesktop.on("agent:folder-trust-dismiss", (payload) => {
        gateEpoch.current += 1;
        const reqId = (payload as { reqId?: string })?.reqId;
        setFolderTrust((cur) => {
          if (!cur) return null;
          if (reqId && cur.reqId !== reqId) return cur;
          return null;
        });
      }),
      window.grokDesktop.on("agent:mcp-elicit-request", (payload) => {
        gateEpoch.current += 1;
        const p = payload as {
          reqId: string;
          params?: {
            serverName?: string;
            message?: string;
            mode?: "form" | "url";
            url?: string;
            elicitationId?: string;
            requestedSchema?: unknown;
          };
        };
        setMcpElicit({
          reqId: p.reqId,
          serverName: p.params?.serverName || "",
          message: p.params?.message || "",
          mode: p.params?.mode === "url" ? "url" : "form",
          url: p.params?.url,
          elicitationId: p.params?.elicitationId,
          requestedSchema: p.params?.requestedSchema,
        });
      }),
      window.grokDesktop.on("agent:mcp-elicit-dismiss", (payload) => {
        gateEpoch.current += 1;
        const reqId = (payload as { reqId?: string })?.reqId;
        setMcpElicit((cur) => {
          if (!cur) return null;
          if (reqId && cur.reqId !== reqId) return cur;
          return null;
        });
      }),
      window.grokDesktop.on("agent:permissions-cleared", () => {
        gateEpoch.current += 1;
        setPermissions([]);
        setPlanApproval(null);
        setUserQuestion(null);
        setFolderTrust(null);
        setMcpElicit(null);
      }),
      window.grokDesktop.on("agent:writes-session", (payload) => {
        setAllowWritesThisSession(
          Boolean((payload as { allowWritesThisSession?: boolean })
            ?.allowWritesThisSession),
        );
      }),
      window.grokDesktop.on("agent:error", (payload) => {
        if (openingRef.current) return;
        setConn("error");
        setError(payload?.message || "Agent error");
      }),
      window.grokDesktop.on("agent:exit", () => {
        if (openingRef.current) return;
        setConn("error");
        setSessionId(null);
        setError("Agent process exited");
        gateEpoch.current += 1;
        setPermissions([]);
        setPlanApproval(null);
        setUserQuestion(null);
        setFolderTrust(null);
        setMcpElicit(null);
      }),
      window.grokDesktop.on("agent:ready", () => {
        /* session id / online only from open IPC */
      }),
      window.grokDesktop.on("agent:stderr", () => {}),
      window.grokDesktop.on("app:open-settings", () => {
        setSettingsOpen(true);
      }),
    ];
    return () => {
      window.clearInterval(poll);
      offs.forEach((off) => off());
    };
  }, [
    openingRef,
    syncPermissionsFromMain,
    syncAgentGatesFromMain,
    setAgentCommands,
    setConn,
    setError,
    setItems,
    setSessionId,
    setSettingsOpen,
  ]);

  const onAllowWritesThisSession = useCallback(async () => {
    try {
      const res = await window.grokDesktop.setAllowWritesThisSession(true);
      setAllowWritesThisSession(Boolean(res?.allowWritesThisSession));
      setPermissions([]);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(`Could not allow writes this session: ${msg}`);
    }
  }, [setError]);

  const onRevokeWritesThisSession = useCallback(async () => {
    try {
      const res = await window.grokDesktop.setAllowWritesThisSession(false);
      setAllowWritesThisSession(Boolean(res?.allowWritesThisSession));
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(`Could not revoke session writes: ${msg}`);
    }
  }, [setError]);

  const clearSessionScoped = useCallback(() => {
    setBackgroundTasks([]);
    setSessionUsage(emptyUsage());
    setSessionMode(null);
    // Parked gates + permissions stay mirrored from main; syncAgentGatesFromMain
    // replaces them after open so a still-parked request is not wiped empty.
  }, []);

  /** Awaited on successful open so a later grant cannot lose a race with revoke. */
  const revokeWritesThisSession = useCallback(async () => {
    setAllowWritesThisSession(false);
    try {
      const res = await window.grokDesktop.setAllowWritesThisSession(false);
      setAllowWritesThisSession(Boolean(res?.allowWritesThisSession));
    } catch {
      setAllowWritesThisSession(false);
    }
  }, []);

  /** Restore Tasks dock from session disk / open result. */
  const hydrateBackgroundTasks = useCallback((tasks: BackgroundTask[]) => {
    setBackgroundTasks(Array.isArray(tasks) ? tasks : []);
  }, []);

  /**
   * Replace status-bar usage from disk (call while openingRef is true so live
   * ACP events do not interleave). After open completes, live apply resumes.
   */
  const hydrateSessionUsage = useCallback(
    (usage: SessionUsage | null | undefined) => {
      if (!usage || typeof usage !== "object") {
        setSessionUsage(emptyUsage());
        return;
      }
      setSessionUsage({
        ...emptyUsage(),
        turns: Number(usage.turns) || 0,
        inputTokens: Number(usage.inputTokens) || 0,
        outputTokens: Number(usage.outputTokens) || 0,
        totalTokens: Number(usage.totalTokens) || 0,
        lastContextTokens: Number(usage.lastContextTokens) || 0,
        cachedReadTokens: Number(usage.cachedReadTokens) || 0,
        reasoningTokens: Number(usage.reasoningTokens) || 0,
        modelCalls: Number(usage.modelCalls) || 0,
        costUsdTicks: Number(usage.costUsdTicks) || 0,
        lastModel: usage.lastModel,
      });
    },
    [],
  );

  /**
   * Optimistically mark matching tool cards so they don't sit on "pending".
   * Matches toolCallId as string; falls back to latest pending with same title.
   */
  const markToolInProgress = useCallback(
    (
      toolCallId: string | null | undefined,
      hint?: { title?: string | null },
    ) => {
      setItems((prev) => {
        const id = toolCallId ? String(toolCallId) : null;
        let matched = false;
        const next = prev.map((item) => {
          if (item.kind !== "tool") return item;
          if (id && String(item.toolCallId) === id) {
            matched = true;
            const st = String(item.status || "").toLowerCase();
            if (st === "completed" || st === "failed" || st === "error") {
              return item;
            }
            return { ...item, status: "in_progress" };
          }
          return item;
        });
        if (matched || !hint?.title) return next;
        // Fallback: newest pending tool with same title
        for (let i = next.length - 1; i >= 0; i--) {
          const item = next[i];
          if (item.kind !== "tool") continue;
          if (item.title !== hint.title) continue;
          const st = String(item.status || "").toLowerCase();
          if (st === "pending" || st === "in_progress" || !st) {
            const copy = [...next];
            copy[i] = { ...item, status: "in_progress" };
            return copy;
          }
        }
        return next;
      });
    },
    [setItems],
  );

  const revertToolStatus = useCallback(
    (toolCallId: string | null | undefined, status = "pending") => {
      if (!toolCallId) return;
      const id = String(toolCallId);
      setItems((prev) =>
        prev.map((item) => {
          if (item.kind !== "tool") return item;
          if (String(item.toolCallId) !== id) return item;
          const st = String(item.status || "").toLowerCase();
          if (st === "in_progress") {
            return { ...item, status };
          }
          return item;
        }),
      );
    },
    [setItems],
  );

  /**
   * Respond to one permission. Optimistic UI remove so multi-edit batches
   * don't leave stale cards if IPC is slow.
   */
  const onPermission = useCallback(
    async (reqId: string, optionId: string | "cancelled") => {
      // Snapshot outside setState so we never lose the request under Strict Mode
      let removed: PermissionRequest | undefined;
      setPermissions((prev) => {
        removed = prev.find((p) => p.reqId === reqId);
        return prev.filter((p) => p.reqId !== reqId);
      });
      // Re-find if Strict Mode double-invoke cleared the local (use prev capture)
      // Prefer the snapshot from the filter pass; if missing, bail cleanly.
      if (!removed) {
        // Request already gone
        return;
      }

      const outcome = permissionOutcomeFromUi(
        optionId,
        removed.params?.options,
      );
      if (!outcome) {
        setPermissions((prev) =>
          prev.some((p) => p.reqId === reqId) ? prev : [...prev, removed!],
        );
        setError("Could not map that approval option. Try another choice.");
        return;
      }

      const toolId = toolCallIdFromPermission(removed);
      const title = removed.params?.toolCall?.title;
      const allowing = isAllowChoice(optionId, removed.params?.options);

      if (allowing) {
        markToolInProgress(toolId, { title });
      }

      try {
        const ok = await window.grokDesktop.respondPermission(reqId, outcome);
        if (!ok) {
          setPermissions((prev) =>
            prev.some((p) => p.reqId === reqId) ? prev : [...prev, removed!],
          );
          if (allowing) revertToolStatus(toolId);
          setError(
            "Could not apply that approval (request already closed). Try again if the tool is still waiting.",
          );
        }
      } catch (e: unknown) {
        setPermissions((prev) =>
          prev.some((p) => p.reqId === reqId) ? prev : [...prev, removed!],
        );
        if (allowing) revertToolStatus(toolId);
        const msg = e instanceof Error ? e.message : String(e);
        setError(`Permission response failed: ${msg}`);
      }
    },
    [markToolInProgress, revertToolStatus, setError],
  );

  /**
   * Allow every open permission with allow-once only (never allow-always).
   */
  const onAllowAllPermissions = useCallback(async () => {
    let batch: PermissionRequest[] = [];
    setPermissions((prev) => {
      batch = prev;
      return [];
    });
    if (batch.length === 0) return;

    for (const p of batch) {
      markToolInProgress(toolCallIdFromPermission(p), {
        title: p.params?.toolCall?.title,
      });
    }

    const failed: PermissionRequest[] = [];
    let skippedAlwaysOnly = 0;
    await Promise.all(
      batch.map(async (p) => {
        const outcome = permissionOutcomeFromUi(
          "allow-once",
          p.params?.options,
          { batchOnce: true },
        );
        if (!outcome) {
          // Catalog is allow-always only — do not escalate via Allow all
          skippedAlwaysOnly += 1;
          failed.push(p);
          return;
        }
        try {
          const ok = await window.grokDesktop.respondPermission(
            p.reqId,
            outcome,
          );
          if (!ok) failed.push(p);
        } catch {
          failed.push(p);
        }
      }),
    );

    if (failed.length) {
      for (const p of failed) {
        revertToolStatus(toolCallIdFromPermission(p));
      }
      setPermissions((prev) => {
        const ids = new Set(prev.map((p) => p.reqId));
        return [...prev, ...failed.filter((p) => !ids.has(p.reqId))];
      });
      const msg =
        skippedAlwaysOnly > 0
          ? `${failed.length} approval(s) need a manual choice (Allow all never selects Always allow).`
          : `${failed.length} approval(s) could not be applied. Retry the approval card(s) in the chat.`;
      setError(msg);
    }
  }, [markToolInProgress, revertToolStatus, setError]);

  const onPlanApproval = useCallback(
    async (
      reqId: string,
      decision:
        | { type: "approved" }
        | { type: "request_changes"; feedback: string }
        | { type: "abandoned" },
    ) => {
      const ok = await window.grokDesktop.respondPlanApproval(reqId, decision);
      if (!ok) return;
      setPlanApproval((cur) => (cur?.reqId === reqId ? null : cur));
      if (decision.type === "approved" || decision.type === "abandoned") {
        setSessionMode(null);
      }
    },
    [],
  );

  const onUserQuestion = useCallback(
    async (
      reqId: string,
      decision:
        | { type: "answered"; answers: Record<string, string> }
        | { type: "declined" },
    ) => {
      const ok = await window.grokDesktop.respondUserQuestion(reqId, decision);
      if (!ok) return;
      setUserQuestion((cur) => (cur?.reqId === reqId ? null : cur));
    },
    [],
  );

  const onFolderTrust = useCallback(
    async (reqId: string, decision: { outcome: "trust" | "reject" }) => {
      const ok = await window.grokDesktop.respondFolderTrust(reqId, decision);
      if (!ok) return;
      setFolderTrust((cur) => (cur?.reqId === reqId ? null : cur));
    },
    [],
  );

  const onMcpElicit = useCallback(
    async (
      reqId: string,
      decision:
        | { outcome: "accept"; content?: Record<string, unknown> }
        | { outcome: "decline" }
        | { outcome: "cancel" },
    ) => {
      const ok = await window.grokDesktop.respondMcpElicit(reqId, decision);
      if (!ok) return;
      setMcpElicit((cur) => (cur?.reqId === reqId ? null : cur));
    },
    [],
  );

  return {
    permissions,
    backgroundTasks,
    sessionUsage,
    sessionMode,
    planApproval,
    userQuestion,
    folderTrust,
    mcpElicit,
    clearSessionScoped,
    revokeWritesThisSession,
    hydrateBackgroundTasks,
    hydrateSessionUsage,
    syncAgentGatesFromMain,
    onPermission,
    onAllowAllPermissions,
    allowWritesThisSession,
    onAllowWritesThisSession,
    onRevokeWritesThisSession,
    onPlanApproval,
    onUserQuestion,
    onFolderTrust,
    onMcpElicit,
  };
}
