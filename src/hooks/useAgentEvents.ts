import {
  useCallback,
  useEffect,
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
import { applySessionUpdate } from "../lib/timeline";
import type { PlanApprovalRequest } from "../components/PlanApprovalDialog";
import type { AskUserRequest } from "../components/AskUserDialog";
import type { PermissionRequest, TimelineItem } from "../vite-env";
import {
  classifyOptionId,
  extractToolCallId,
  permissionOutcomeFromUi,
} from "../../shared/permission-options.mjs";

type ConnState = "idle" | "connecting" | "online" | "busy" | "error";

function isAllowChoice(optionId: string, options?: PermissionRequest["params"]["options"]): boolean {
  if (optionId === "cancelled" || optionId === "cancel") return false;
  const cls = classifyOptionId(optionId, options);
  return cls === "allow_once" || cls === "allow_always";
}

function toolCallIdFromPermission(p: PermissionRequest | undefined): string | null {
  if (!p) return null;
  return extractToolCallId(p.params) || extractToolCallId(p.params?.toolCall);
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

  useEffect(() => {
    const offs = [
      window.grokDesktop.on("agent:session-update", (params) => {
        const update = params?.update ?? params;
        const kind = update?.sessionUpdate || update?.session_update;
        if (kind === "available_commands_update") {
          setAgentCommands(agentCommandsFromUpdate(update));
          return;
        }
        if (kind === "current_mode_update") {
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
            // Preserve reference when tool events are unrelated (avoids re-renders)
            return next === prev ? prev : next;
          });
        }
        setItems((prev) => applySessionUpdate(prev, params));
      }),
      window.grokDesktop.on("agent:permission-request", (payload) => {
        const p = payload as PermissionRequest;
        if (!p?.reqId) return;
        setPermissions((prev) => {
          if (prev.some((x) => x.reqId === p.reqId)) return prev;
          return [...prev, p];
        });
      }),
      window.grokDesktop.on("agent:permission-dismiss", (payload) => {
        const reqId = (payload as { reqId?: string })?.reqId;
        if (!reqId) return;
        setPermissions((prev) => prev.filter((p) => p.reqId !== reqId));
      }),
      window.grokDesktop.on("agent:plan-approval-request", (payload) => {
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
        const reqId = (payload as { reqId?: string })?.reqId;
        setPlanApproval((cur) => {
          if (!cur) return null;
          if (reqId && cur.reqId !== reqId) return cur;
          return null;
        });
        setSessionMode(null);
      }),
      window.grokDesktop.on("agent:user-question-request", (payload) => {
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
        const reqId = (payload as { reqId?: string })?.reqId;
        setUserQuestion((cur) => {
          if (!cur) return null;
          if (reqId && cur.reqId !== reqId) return cur;
          return null;
        });
      }),
      window.grokDesktop.on("agent:permissions-cleared", () => {
        setPermissions([]);
        setPlanApproval(null);
        setUserQuestion(null);
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
        setPermissions([]);
        setPlanApproval(null);
        setUserQuestion(null);
      }),
      window.grokDesktop.on("agent:ready", () => {
        /* session id / online only from open IPC */
      }),
      window.grokDesktop.on("agent:stderr", () => {}),
      window.grokDesktop.on("app:open-settings", () => {
        setSettingsOpen(true);
      }),
    ];
    return () => offs.forEach((off) => off());
  }, [
    openingRef,
    setAgentCommands,
    setConn,
    setError,
    setItems,
    setSessionId,
    setSettingsOpen,
  ]);

  const clearSessionScoped = useCallback(() => {
    setPermissions([]);
    setBackgroundTasks([]);
    setSessionMode(null);
    setPlanApproval(null);
    setUserQuestion(null);
  }, []);

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
          : `${failed.length} approval(s) could not be applied. Retry from Approvals.`;
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
      await window.grokDesktop.respondPlanApproval(reqId, decision);
      setPlanApproval(null);
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
      await window.grokDesktop.respondUserQuestion(reqId, decision);
      setUserQuestion(null);
    },
    [],
  );

  return {
    permissions,
    backgroundTasks,
    sessionMode,
    planApproval,
    userQuestion,
    clearSessionScoped,
    onPermission,
    onAllowAllPermissions,
    onPlanApproval,
    onUserQuestion,
  };
}
