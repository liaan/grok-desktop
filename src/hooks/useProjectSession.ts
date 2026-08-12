import {
  useCallback,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import { isAuthError, isMissingBinaryError, type ConnState } from "../lib/conn";
import { basen } from "../lib/path-utils";
import { uid } from "../lib/timeline";
import type {
  AppInfo,
  AuthStatus,
  AvailableModel,
  BackboneSummary,
  SessionSummary,
  TimelineItem,
} from "../vite-env";
import type { SlashCommand } from "../lib/commands";

/**
 * Open / resume project sessions and apply agent open results.
 */
export function useProjectSession(opts: {
  auth: AuthStatus | null;
  project: string | null;
  busyRef: MutableRefObject<boolean>;
  openingRef: MutableRefObject<boolean>;
  /** Cleared on open — typed loosely so App can pass its queue refs. */
  promptQueueRef: MutableRefObject<unknown>;
  sendNowRef: MutableRefObject<unknown>;
  clearSessionScoped: () => void;
  hydrateBackgroundTasks: (tasks: import("../lib/background-tasks").BackgroundTask[]) => void;
  hydrateSessionUsage: (usage: import("../lib/usage").SessionUsage | null | undefined) => void;
  /** Mirror open permission gates from main (source of truth). */
  syncPermissionsFromMain: () => void | Promise<void>;
  hydrateFromInfo: (i: AppInfo) => void;
  refreshAuth: () => Promise<AuthStatus>;
  refreshBackbone: (cwd?: string) => Promise<BackboneSummary>;
  setBackbone: Dispatch<SetStateAction<BackboneSummary | null>>;
  /** Fired after a successful open/restart hydrate (new agent process exists). */
  onOpenApplied?: () => void;
  setAuth: Dispatch<SetStateAction<AuthStatus | null>>;
  setInfo: Dispatch<SetStateAction<AppInfo | null>>;
  setProject: Dispatch<SetStateAction<string | null>>;
  setSessionId: Dispatch<SetStateAction<string | null>>;
  setSessions: Dispatch<SetStateAction<SessionSummary[]>>;
  setModelId: Dispatch<SetStateAction<string | null>>;
  setModelName: Dispatch<SetStateAction<string | null>>;
  setAvailableModels: Dispatch<SetStateAction<AvailableModel[]>>;
  setConn: Dispatch<SetStateAction<ConnState>>;
  setOpeningLabel: Dispatch<SetStateAction<string | null>>;
  setError: Dispatch<SetStateAction<string | null>>;
  setItems: Dispatch<SetStateAction<TimelineItem[]>>;
  setAgentCommands: Dispatch<SetStateAction<SlashCommand[]>>;
  clearPromptQueue: () => void;
  /** Leave the project and return to AuthGate install when grok is missing. */
  onMissingBinary?: () => void | Promise<void>;
}) {
  const {
    auth,
    project,
    busyRef,
    openingRef,
    promptQueueRef,
    sendNowRef,
    clearSessionScoped,
    hydrateBackgroundTasks,
    hydrateSessionUsage,
    syncPermissionsFromMain,
    hydrateFromInfo,
    refreshAuth,
    refreshBackbone,
    setBackbone,
    onOpenApplied,
    setAuth,
    setInfo,
    setProject,
    setSessionId,
    setSessions,
    setModelId,
    setModelName,
    setAvailableModels,
    setConn,
    setOpeningLabel,
    setError,
    setItems,
    setAgentCommands,
    clearPromptQueue,
    onMissingBinary,
  } = opts;

  const applyOpenResult = useCallback(
    async (
      res: Awaited<
        | ReturnType<typeof window.grokDesktop.openProject>
        | ReturnType<typeof window.grokDesktop.restartAgent>
      > & {
        warning?: string | null;
        backgroundTasks?: import("../lib/background-tasks").BackgroundTask[];
        usage?: import("../lib/usage").SessionUsage | null;
      },
      openOpts?: { note?: string },
    ) => {
      setProject(res.cwd);
      setSessionId(res.sessionId);
      setSessions(res.sessions || []);
      setModelId(res.modelId || null);
      setModelName(res.modelName || null);
      setAvailableModels(res.availableModels || []);
      clearSessionScoped();
      // While openingRef is true, live usage is ignored — disk replace is safe.
      hydrateBackgroundTasks(res.backgroundTasks || []);
      hydrateSessionUsage(res.usage);
      // Await so we do not mark online with a stale empty mirror.
      await syncPermissionsFromMain();
      setAgentCommands([]);
      // Composer draft/slash menu remounts via key=sessionId — no reset needed.
      clearPromptQueue();
      promptQueueRef.current = [];
      sendNowRef.current = null;

      const history = (res.history || []) as TimelineItem[];
      if (res.backbone) setBackbone(res.backbone);
      const bb = res.backbone ?? (await refreshBackbone(res.cwd));
      const skillN = bb.ok ? bb.skills.length : "?";
      const mcpN = bb.ok ? bb.mcpServers.length : "?";
      const runningBg = (res.backgroundTasks || []).filter(
        (t) => t.status === "running",
      ).length;
      const modelLabel = res.modelName
        ? res.modelId
          ? `${res.modelName} (${res.modelId})`
          : res.modelName
        : res.modelId || null;
      const banner: TimelineItem = {
        id: uid("sys"),
        kind: "system",
        text: [
          openOpts?.note ||
            (res.resumed
              ? "Resumed Grok session (same store as CLI ~/.grok/sessions)"
              : "New Grok session (same store as CLI)"),
          res.warning ? `Note: ${res.warning}` : null,
          `Project: ${res.cwd}`,
          `Session: ${res.sessionId}`,
          modelLabel ? `Model: ${modelLabel}` : null,
          history.length
            ? `History: ${history.length} message(s) restored`
            : "History: empty (fresh chat)",
          runningBg
            ? `Background tasks: ${runningBg} still running (see Tasks dock)`
            : null,
          `Binary: ${res.grokBinary}`,
          `Skills: ${skillN} · MCP: ${mcpN}`,
        ]
          .filter(Boolean)
          .join("\n"),
        at: Date.now(),
      };
      setItems([banner, ...history]);
      setConn("online");
      setOpeningLabel(null);
      setError(res.warning || null);

      const i = await window.grokDesktop.getInfo();
      setInfo(i);
      setAuth(i.auth);
      hydrateFromInfo(i);
      onOpenApplied?.();
    },
    [
      clearSessionScoped,
      hydrateBackgroundTasks,
      hydrateSessionUsage,
      syncPermissionsFromMain,
      hydrateFromInfo,
      promptQueueRef,
      refreshBackbone,
      setBackbone,
      onOpenApplied,
      sendNowRef,
      setAgentCommands,
      setAuth,
      setConn,
      setError,
      setInfo,
      setItems,
      setOpeningLabel,
      setProject,
      clearPromptQueue,
      setSessionId,
      setSessions,
      setModelId,
      setModelName,
      setAvailableModels,
    ],
  );

  const openProject = useCallback(
    async (
      cwd: string,
      openOpts?: {
        mode?: "continue" | "new" | "resume";
        sessionId?: string;
      },
    ) => {
      const status = auth || (await refreshAuth());
      if (!status.authenticated || status.expired) {
        setError("Sign in to Grok before opening a project.");
        return;
      }
      if (busyRef.current || openingRef.current) {
        setError("Wait for the current turn or open to finish.");
        return;
      }

      openingRef.current = true;
      setConn("connecting");
      setOpeningLabel(basen(cwd));
      setError(null);
      setItems([]);
      clearSessionScoped();
      try {
        const res = await window.grokDesktop.openProject(cwd, {
          mode: openOpts?.mode || "continue",
          sessionId: openOpts?.sessionId,
        });
        await applyOpenResult(res);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        setOpeningLabel(null);
        if (isMissingBinaryError(msg)) {
          setConn("idle");
          await onMissingBinary?.();
          setError(msg);
        } else {
          setConn("error");
          setError(msg);
          if (isAuthError(msg)) {
            void refreshAuth();
          }
        }
      } finally {
        openingRef.current = false;
      }
    },
    [
      auth,
      applyOpenResult,
      busyRef,
      clearSessionScoped,
      onMissingBinary,
      openingRef,
      refreshAuth,
      setConn,
      setError,
      setItems,
      setOpeningLabel,
    ],
  );

  const openSession = useCallback(
    async (sessionOpts: { sessionId?: string; mode?: "new" | "resume" }) => {
      if (!project) return;
      const status = auth || (await refreshAuth());
      if (!status.authenticated || status.expired) {
        setError("Sign in to Grok first.");
        return;
      }
      if (busyRef.current) {
        setError("Stop the current turn before switching chats.");
        return;
      }
      if (openingRef.current) return;

      openingRef.current = true;
      setConn("connecting");
      setOpeningLabel(sessionOpts.mode === "new" ? "New chat" : "Resuming…");
      setError(null);
      setItems([]);
      clearSessionScoped();
      try {
        const res = await window.grokDesktop.openSession({
          cwd: project,
          sessionId: sessionOpts.sessionId,
          mode: sessionOpts.mode || "resume",
        });
        await applyOpenResult(res, {
          note:
            sessionOpts.mode === "new"
              ? "Started a new chat (CLI /new)"
              : "Resumed previous chat (CLI /resume)",
        });
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        setOpeningLabel(null);
        if (isMissingBinaryError(msg)) {
          setConn("idle");
          await onMissingBinary?.();
          setError(msg);
        } else {
          setConn("error");
          setError(msg);
        }
      } finally {
        openingRef.current = false;
      }
    },
    [
      auth,
      applyOpenResult,
      busyRef,
      clearSessionScoped,
      onMissingBinary,
      openingRef,
      project,
      refreshAuth,
      setConn,
      setError,
      setItems,
      setOpeningLabel,
    ],
  );

  const restartAgent = useCallback(async () => {
    if (!project) {
      setError("Open a project before restarting the agent.");
      return;
    }
    const status = auth || (await refreshAuth());
    if (!status.authenticated || status.expired) {
      setError("Sign in to Grok first.");
      return;
    }
    if (openingRef.current) return;

    openingRef.current = true;
    busyRef.current = false;
    clearPromptQueue();
    setConn("connecting");
    setOpeningLabel("Restarting agent…");
    setError(null);
    try {
      const res = await window.grokDesktop.restartAgent();
      await applyOpenResult(res, {
        note: res.resumed
          ? "Restarted Grok agent (same session)"
          : "Restarted Grok agent (new session)",
      });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setOpeningLabel(null);
      if (isMissingBinaryError(msg)) {
        setConn("idle");
        await onMissingBinary?.();
        setError(msg);
      } else {
        setConn("error");
        setError(msg);
        if (isAuthError(msg)) {
          void refreshAuth();
        }
      }
    } finally {
      openingRef.current = false;
    }
  }, [
    auth,
    applyOpenResult,
    busyRef,
    clearPromptQueue,
    onMissingBinary,
    openingRef,
    project,
    refreshAuth,
    setConn,
    setError,
    setOpeningLabel,
  ]);

  return { openProject, openSession, restartAgent, isAuthError };
}

export { isAuthError };
