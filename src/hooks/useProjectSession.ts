import {
  useCallback,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import { uid } from "../lib/timeline";
import type {
  AppInfo,
  AuthStatus,
  BackboneSummary,
  SessionSummary,
  TimelineItem,
} from "../vite-env";
import type { SlashCommand } from "../lib/commands";

type ConnState = "idle" | "connecting" | "online" | "busy" | "error";

function basename(p: string) {
  return p.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || p;
}

function isAuthError(msg: string) {
  return /auth|login|unauthor|401|credential|sign in|sign-in/i.test(msg);
}

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
  hydrateFromInfo: (i: AppInfo) => void;
  refreshAuth: () => Promise<AuthStatus>;
  refreshBackbone: (cwd?: string) => Promise<BackboneSummary>;
  setAuth: Dispatch<SetStateAction<AuthStatus | null>>;
  setInfo: Dispatch<SetStateAction<AppInfo | null>>;
  setProject: Dispatch<SetStateAction<string | null>>;
  setSessionId: Dispatch<SetStateAction<string | null>>;
  setSessions: Dispatch<SetStateAction<SessionSummary[]>>;
  setConn: Dispatch<SetStateAction<ConnState>>;
  setOpeningLabel: Dispatch<SetStateAction<string | null>>;
  setError: Dispatch<SetStateAction<string | null>>;
  setItems: Dispatch<SetStateAction<TimelineItem[]>>;
  setAgentCommands: Dispatch<SetStateAction<SlashCommand[]>>;
  setCmdIndex: Dispatch<SetStateAction<number>>;
  setSlashDismissed: Dispatch<SetStateAction<boolean>>;
  clearPromptQueue: () => void;
}) {
  const {
    auth,
    project,
    busyRef,
    openingRef,
    promptQueueRef,
    sendNowRef,
    clearSessionScoped,
    hydrateFromInfo,
    refreshAuth,
    refreshBackbone,
    setAuth,
    setInfo,
    setProject,
    setSessionId,
    setSessions,
    setConn,
    setOpeningLabel,
    setError,
    setItems,
    setAgentCommands,
    setCmdIndex,
    setSlashDismissed,
    clearPromptQueue,
  } = opts;

  const applyOpenResult = useCallback(
    async (
      res: Awaited<ReturnType<typeof window.grokDesktop.openProject>> & {
        warning?: string | null;
      },
      openOpts?: { note?: string },
    ) => {
      setProject(res.cwd);
      setSessionId(res.sessionId);
      setSessions(res.sessions || []);
      clearSessionScoped();
      setAgentCommands([]);
      setCmdIndex(0);
      setSlashDismissed(false);
      clearPromptQueue();
      promptQueueRef.current = [];
      sendNowRef.current = null;

      const history = (res.history || []) as TimelineItem[];
      const bb = await refreshBackbone(res.cwd);
      const skillN = bb.ok ? bb.skills.length : "?";
      const mcpN = bb.ok ? bb.mcpServers.length : "?";
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
          history.length
            ? `History: ${history.length} message(s) restored`
            : "History: empty (fresh chat)",
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
    },
    [
      clearSessionScoped,
      hydrateFromInfo,
      promptQueueRef,
      refreshBackbone,
      sendNowRef,
      setAgentCommands,
      setAuth,
      setCmdIndex,
      setConn,
      setError,
      setInfo,
      setItems,
      setOpeningLabel,
      setProject,
      clearPromptQueue,
      setSessionId,
      setSessions,
      setSlashDismissed,
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
      setOpeningLabel(basename(cwd));
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
        setConn("error");
        setOpeningLabel(null);
        setError(msg);
        if (isAuthError(msg)) {
          void refreshAuth();
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
        setConn("error");
        setOpeningLabel(null);
        setError(msg);
      } finally {
        openingRef.current = false;
      }
    },
    [
      auth,
      applyOpenResult,
      busyRef,
      clearSessionScoped,
      openingRef,
      project,
      refreshAuth,
      setConn,
      setError,
      setItems,
      setOpeningLabel,
    ],
  );

  return { openProject, openSession, isAuthError };
}
