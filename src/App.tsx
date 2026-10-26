import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Spinner } from "./components/BrandMark";
import { MessageList } from "./components/MessageList";
import { SidePanel } from "./components/SidePanel";
import { SettingsDialog } from "./components/SettingsDialog";
import { StatusBar } from "./components/StatusBar";
import { PlanApprovalDialog } from "./components/PlanApprovalDialog";
import { AskUserDialog } from "./components/AskUserDialog";
import { FolderTrustDialog } from "./components/FolderTrustDialog";
import { McpElicitDialog } from "./components/McpElicitDialog";
import {
  WorktreeDialog,
  type WorktreeDialogState,
} from "./components/WorktreeDialog";
import { ApprovalsDock } from "./components/ApprovalsDock";
import { AppSidebar } from "./components/AppSidebar";
import { ChatTopbar } from "./components/ChatTopbar";
import { ColumnResizeHandle } from "./components/ColumnResizeHandle";
import { WelcomeView } from "./components/WelcomeView";
import { Composer } from "./components/Composer";
import { useColumnLayout } from "./hooks/useColumnLayout";
import {
  DESKTOP_COMMANDS,
  mergeCommands,
  skillsToCommands,
  type SlashCommand,
} from "./lib/commands";
import {
  nextAlwaysApproveMode,
  runDesktopCommand,
} from "./lib/desktop-commands";
import { enterPlanMode } from "./lib/enter-plan-mode";
import { isMissingBinaryError, type ConnState } from "./lib/conn";
import {
  normalizeAutoCompactAt,
  shouldAutoCompact,
  type AutoCompactAt,
} from "../shared/auto-compact.mjs";
import { PrivacyProvider } from "./lib/privacy-context";
import { redactSensitiveText } from "./lib/privacy";
import { hideBootSplash } from "./lib/boot-splash";
import { applyTheme, readStoredTheme, storeTheme } from "./lib/theme";
import { localeGen, useI18n } from "./lib/i18n";
import { readHideThinking, storeHideThinking } from "./lib/hide-thinking";
import { finalizeOpenTools, uid } from "./lib/timeline";
import { useAgentEvents } from "./hooks/useAgentEvents";
import { useAgentSafety } from "./hooks/useAgentSafety";
import { useProjectSession } from "./hooks/useProjectSession";
import { usePromptDelivery } from "./hooks/usePromptDelivery";
import { useStickToBottom } from "./hooks/useStickToBottom";
import { useUnsavedGuard } from "./hooks/useUnsavedGuard";
import type {
  AppInfo,
  AuthStatus,
  AvailableModel,
  BackboneSummary,
  LoginProgress,
  OpenCheckoutRow,
  SessionSummary,
  TimelineItem,
} from "./vite-env";

export default function App() {
  const { t, setPref } = useI18n();
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [auth, setAuth] = useState<AuthStatus | null>(null);
  const [backbone, setBackbone] = useState<BackboneSummary | null>(null);
  const [authBusy, setAuthBusy] = useState(false);
  const [authMessage, setAuthMessage] = useState<string | null>(null);
  const [loginProgress, setLoginProgress] = useState<LoginProgress | null>(
    null,
  );
  const [project, setProject] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  /** Live session model from ACP (session/new|load). */
  const [modelId, setModelId] = useState<string | null>(null);
  const [modelName, setModelName] = useState<string | null>(null);
  const [availableModels, setAvailableModels] = useState<AvailableModel[]>([]);
  /** Optimistic pick while session/set_model is in flight. */
  const [pendingModelId, setPendingModelId] = useState<string | null>(null);
  /** Bumped on failed switch so the native <select> remounts onto the previous id. */
  const [modelSelectEpoch, setModelSelectEpoch] = useState(0);
  const [conn, setConn] = useState<ConnState>("idle");
  const [openingLabel, setOpeningLabel] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<TimelineItem[]>([]);
  const [theme, setTheme] = useState<"dark" | "light">(readStoredTheme);
  const [hideThinking, setHideThinking] = useState(readHideThinking);
  const [privacyMode, setPrivacyMode] = useState(false);
  /** SpaceXAI coding-data share; default opt-in (matches CLI /privacy). */
  const [codingDataOptIn, setCodingDataOptIn] = useState(true);
  const [codingDataNote, setCodingDataNote] = useState<string | undefined>();
  const [debugLogging, setDebugLogging] = useState(false);
  const [debugLogPath, setDebugLogPath] = useState("");
  const [crashLogPath, setCrashLogPath] = useState("");
  const [allowPrerelease, setAllowPrerelease] = useState(false);
  const [autoCompactAt, setAutoCompactAt] = useState<AutoCompactAt>("off");
  const autoCompactFiredRef = useRef({ sessionId: "", tokens: 0 });
  const autoCompactInFlightRef = useRef(false);
  const autoCompactFailedAtRef = useRef({ sessionId: "", tokens: 0 });
  const autoCompactUnsupportedRef = useRef(false);
  const [gitBranch, setGitBranch] = useState<string | null>(null);
  const [gitDetached, setGitDetached] = useState(false);
  const { setFilesDirty, confirmDiscardFiles } = useUnsavedGuard();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsSection, setSettingsSection] = useState<
    "mcp" | "plugins" | "skills" | null
  >(null);
  const [offerAgentRestart, setOfferAgentRestart] = useState(false);
  const [agentCommands, setAgentCommands] = useState<SlashCommand[]>([]);
  const [openCheckouts, setOpenCheckouts] = useState<OpenCheckoutRow[]>([]);
  const [worktreeDialog, setWorktreeDialog] =
    useState<WorktreeDialogState | null>(null);
  const [worktreeBusy, setWorktreeBusy] = useState(false);
  const [worktreeError, setWorktreeError] = useState<string | null>(null);

  const bottomRef = useRef<HTMLDivElement | null>(null);
  const timelineRef = useRef<HTMLDivElement | null>(null);
  const busyRef = useRef(false);
  const openingRef = useRef(false);
  const sessionIdRef = useRef(sessionId);
  sessionIdRef.current = sessionId;
  const modelApplyLock = useRef(false);
  const modelApplyGen = useRef(0);
  const loginGen = useRef(0);
  const [loginDeviceAuth, setLoginDeviceAuth] = useState(false);

  const appendSystem = useCallback((text: string) => {
    setItems((prev) => [
      ...prev,
      { id: uid("sys"), kind: "system", text, at: Date.now() },
    ]);
  }, []);

  const clearOfferAgentRestart = useCallback(() => {
    setOfferAgentRestart(false);
  }, []);

  const {
    permissionMode,
    reasoningEffort,
    allowOutsideProject,
    sandboxTerminal,
    sandboxStatus,
    hydrateFromInfo,
    applyPermissionMode,
    applyReasoningEffort,
    toggleAllowOutside,
    applySandboxTerminal,
  } = useAgentSafety({ setError, appendSystem });

  const refreshAuth = useCallback(async () => {
    const status = await window.grokDesktop.getAuthStatus();
    setAuth(status);
    return status;
  }, []);

  const refreshBackbone = useCallback(async (cwd?: string) => {
    const summary = await window.grokDesktop.inspectBackbone(cwd);
    setBackbone(summary);
    return summary;
  }, []);

  const bootstrap = useCallback(async () => {
    const gen = localeGen.current;
    try {
      const i = await window.grokDesktop.getInfo();
      setInfo(i);
      hydrateFromInfo(i);
      setPrivacyMode(Boolean(i.privacyMode));
      setCodingDataOptIn(i.codingDataOptIn !== false);
      setCodingDataNote(i.codingDataStatus?.note);
      setDebugLogging(Boolean(i.debugLogging));
      setDebugLogPath(i.debugLogPath || "");
      setCrashLogPath(i.crashLogPath || "");
      setAllowPrerelease(Boolean(i.allowPrerelease));
      setAutoCompactAt(normalizeAutoCompactAt(i.autoCompactAt));
      const nextTheme = i.theme === "light" ? "light" : "dark";
      setTheme(nextTheme);
      applyTheme(nextTheme);
      setPref(i.localePref, { gen });
      setAuth(i.auth);
      if (i.auth.authenticated && !i.auth.expired) {
        void refreshBackbone(i.lastProject || undefined);
      }
    } catch {
      /* WelcomeView still renders; native splash waits for first paint, not this. */
    }
  }, [refreshBackbone, hydrateFromInfo, setPref]);

  useEffect(() => {
    hideBootSplash();
    void bootstrap();
  }, [bootstrap]);

  const timelineScrollKey = useMemo(() => {
    const last = items[items.length - 1];
    if (!last) return "empty";
    const tail =
      last.kind === "assistant" ||
      last.kind === "thought" ||
      last.kind === "user"
        ? String((last as { text?: string }).text?.length ?? 0)
        : last.kind === "tool"
          ? `${last.status}:${String((last as { content?: unknown }).content ? 1 : 0)}`
          : last.kind;
    return `${items.length}:${last.id}:${last.kind}:${tail}`;
  }, [items]);

  const { pinToBottom } = useStickToBottom(
    timelineRef,
    timelineScrollKey,
    `${project ?? ""}:${sessionId ?? ""}`,
  );

  const {
    promptQueue,
    promptQueueRef,
    sendNowRef,
    clearPromptQueue,
    removeQueued,
    submitFromComposer,
    sendQueuedNow,
  } = usePromptDelivery({
    project,
    conn,
    busyRef,
    openingRef,
    pinToBottom,
    setConn,
    setError,
    setItems,
    refreshAuth: () => {
      void refreshAuth();
    },
  });

  const {
    permissions,
    backgroundTasks,
    sessionUsage,
    sessionMode,
    setSessionMode,
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
  } = useAgentEvents({
    openingRef,
    sessionIdRef,
    setConn,
    setError,
    setSessionId,
    setItems,
    setAgentCommands,
    setSettingsOpen,
    deliverPlanComments: (text) => {
      void submitFromComposer({ text, images: [], mode: "auto" });
    },
  });

  const signedIn = Boolean(auth?.authenticated && !auth?.expired);

  const leaveProject = useCallback(async () => {
    try {
      await window.grokDesktop.closeProject();
    } catch {
      /* ignore — still clear local UI */
    }
    setProject(null);
    setSessionId(null);
    setSessions([]);
    setModelId(null);
    setModelName(null);
    setAvailableModels([]);
    setItems([]);
    setConn("idle");
    setError(null);
    setOfferAgentRestart(false);
  }, []);

  const onMissingBinary = useCallback(async () => {
    await leaveProject();
    await refreshAuth();
  }, [leaveProject, refreshAuth]);

  const { openProject, openSession, restartAgent, isAuthError } =
    useProjectSession({
      auth,
      project,
      busyRef,
      openingRef,
      promptQueueRef,
      sendNowRef,
      clearSessionScoped,
      revokeWritesThisSession,
      hydrateBackgroundTasks,
      hydrateSessionUsage,
      hydrateSessionMode: setSessionMode,
      syncAgentGatesFromMain,
      hydrateFromInfo,
      refreshAuth,
      refreshBackbone,
      setBackbone,
      onOpenApplied: clearOfferAgentRestart,
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
      onCheckoutConflict: (conflict, cwd) => {
        setWorktreeError(null);
        setWorktreeDialog({ kind: "conflict", conflict, pendingCwd: cwd });
      },
    });

  const renameSession = useCallback(
    async (opts: { sessionId: string; title: string }) => {
      if (!project) return;
      try {
        const res = await window.grokDesktop.renameSession({
          cwd: project,
          sessionId: opts.sessionId,
          title: opts.title,
        });
        if (res?.sessions) setSessions(res.sessions);
        else setSessions(await window.grokDesktop.listSessions(project));
        setError(null);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        setError(msg);
        throw e instanceof Error ? e : new Error(msg);
      }
    },
    [project],
  );

  const deleteSession = useCallback(
    async (opts: { sessionId: string }) => {
      if (!project) return;
      const wasCurrent = opts.sessionId === sessionId;
      if (wasCurrent && conn === "busy") {
        throw new Error(t("err.stopBeforeDelete"));
      }
      try {
        const res = await window.grokDesktop.deleteSession({
          cwd: project,
          sessionId: opts.sessionId,
        });
        const nextList =
          res?.sessions || (await window.grokDesktop.listSessions(project));
        setSessions(nextList);
        setError(null);
        if (wasCurrent) {
          const next = nextList.find((s) => s.id !== opts.sessionId) || nextList[0];
          if (next) await openSession({ mode: "resume", sessionId: next.id });
          else await openSession({ mode: "new" });
        }
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        setError(msg);
        throw e instanceof Error ? e : new Error(msg);
      }
    },
    [project, sessionId, conn, openSession],
  );

  const closeWorktreeDialog = useCallback(() => {
    setWorktreeDialog(null);
    setWorktreeError(null);
    setWorktreeBusy(false);
  }, []);

  const openPathAfterWorktree = useCallback(
    async (cwd: string, newWindow: boolean) => {
      if (newWindow) {
        await window.grokDesktop.openProjectInNewWindow(cwd);
        closeWorktreeDialog();
        return;
      }
      closeWorktreeDialog();
      await openProject(cwd, { allowSameCheckout: true });
    },
    [closeWorktreeDialog, openProject],
  );

  const handleCreateWorktree = useCallback(
    async (opts: { cwd: string; newWindow: boolean }) => {
      setWorktreeBusy(true);
      setWorktreeError(null);
      try {
        const added = await window.grokDesktop.createWorktree({
          cwd: opts.cwd,
        });
        await openPathAfterWorktree(added.path, opts.newWindow);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        if (worktreeDialog) setWorktreeError(msg);
        else setError(msg);
      } finally {
        setWorktreeBusy(false);
      }
    },
    [openPathAfterWorktree, worktreeDialog],
  );

  const createWorktreeInNewWindow = useCallback(
    async (sourceCwd: string) => {
      await handleCreateWorktree({ cwd: sourceCwd, newWindow: true });
    },
    [handleCreateWorktree],
  );

  const pendingOpenTried = useRef(false);
  useEffect(() => {
    if (!signedIn || pendingOpenTried.current) return;
    pendingOpenTried.current = true;
    void window.grokDesktop.takePendingOpen().then((pending) => {
      if (!pending?.cwd) return;
      void openProject(pending.cwd, {
        allowSameCheckout: pending.allowSameCheckout,
      });
    });
  }, [signedIn, openProject]);

  const pickProject = async () => {
    if (!signedIn || conn === "connecting") {
      if (!signedIn) setError(t("welcome.signInFirst"));
      return;
    }
    if (!confirmDiscardFiles()) return;
    const cwd = await window.grokDesktop.pickProject();
    if (cwd) await openProject(cwd);
  };

  const isOpening = conn === "connecting";

  useEffect(() => {
    return window.grokDesktop.on("auth:login-progress", (payload) => {
      const next = (payload || {}) as LoginProgress;
      setLoginProgress(next);
      if (next.output) setAuthMessage(next.output);
    });
  }, []);

  useEffect(() => {
    void window.grokDesktop.setSettingsOpen(settingsOpen);
  }, [settingsOpen]);

  useEffect(() => {
    return window.grokDesktop.on("app:close-settings", () => {
      setSettingsOpen(false);
      setSettingsSection(null);
    });
  }, []);

  useEffect(() => {
    void window.grokDesktop.listOpenCheckouts().then(setOpenCheckouts);
    return window.grokDesktop.on("app:open-checkouts", (payload) => {
      setOpenCheckouts(Array.isArray(payload) ? payload : []);
    });
  }, []);

  useEffect(() => {
    return window.grokDesktop.on("app:new-worktree", () => {
      if (!project) {
        setError(t("err.openGitFirst"));
        return;
      }
      void createWorktreeInNewWindow(project);
    });
  }, [project, createWorktreeInNewWindow]);

  const handleLogin = async (deviceAuth = false) => {
    const gen = ++loginGen.current;
    setAuthBusy(true);
    setLoginDeviceAuth(deviceAuth);
    setLoginProgress(null);
    setAuthMessage(
      deviceAuth ? t("auth.startingDevice") : t("auth.openingBrowser"),
    );
    setError(null);
    try {
      const result = await window.grokDesktop.login({ deviceAuth });
      if (gen !== loginGen.current) return;
      if (result.status) setAuth(result.status);
      if (result.output) setAuthMessage(result.output);
      if (result.ok || result.status?.authenticated) {
        setLoginProgress(null);
        setAuthMessage(result.output || t("auth.signedInOk"));
        await refreshBackbone();
        await bootstrap();
      } else if (result.error) {
        setAuthMessage(result.error);
        setError(result.error);
        if (isMissingBinaryError(result.error)) {
          await refreshAuth();
        }
      }
    } catch (e: unknown) {
      if (gen !== loginGen.current) return;
      const msg = e instanceof Error ? e.message : String(e);
      setAuthMessage(msg);
      setError(msg);
      if (isMissingBinaryError(msg)) {
        await refreshAuth();
      }
    } finally {
      if (gen === loginGen.current) {
        setAuthBusy(false);
        void refreshAuth();
      }
    }
  };

  const handleCancelLogin = async () => {
    loginGen.current += 1;
    await window.grokDesktop.cancelLogin();
    setAuthBusy(false);
    setLoginDeviceAuth(false);
    setLoginProgress(null);
    setAuthMessage(t("auth.loginCancelled"));
    void refreshAuth();
  };

  const handleSubmitLoginCode = async (code: string) => {
    const result = await window.grokDesktop.submitLoginInput(code);
    if (result.ok) {
      setAuthMessage(t("auth.codeSent"));
      return;
    }
    setAuthMessage(result.error || t("err.sendCode"));
  };

  // Model is session-scoped; drop the label when the agent/session goes away.
  useEffect(() => {
    if (!sessionId) {
      setModelId(null);
      setModelName(null);
      setAvailableModels([]);
    }
    modelApplyGen.current += 1;
    modelApplyLock.current = false;
    setPendingModelId(null);
  }, [sessionId]);

  const applyModel = useCallback(
    async (nextId: string) => {
      if (!nextId || nextId === modelId || modelApplyLock.current) return;
      const sessionAtStart = sessionIdRef.current;
      const gen = modelApplyGen.current;
      modelApplyLock.current = true;
      setPendingModelId(nextId);
      try {
        const result = await window.grokDesktop.setModel(nextId);
        if (
          gen !== modelApplyGen.current ||
          sessionAtStart !== sessionIdRef.current
        ) {
          return;
        }
        if (result.agentSynced === false) {
          setPendingModelId(null);
          setModelSelectEpoch((n) => n + 1);
          setError(
            result.error
              ? t("err.switchModelErr", { error: result.error })
              : t("err.switchModel"),
          );
          return;
        }
        setModelId(result.modelId || nextId);
        setModelName(result.modelName || null);
        if (Array.isArray(result.availableModels)) {
          setAvailableModels(result.availableModels);
        }
        setPendingModelId(null);
        setError(null);
        const label = result.modelName
          ? result.modelId && result.modelName !== result.modelId
            ? `${result.modelName} (${result.modelId})`
            : result.modelName
          : result.modelId || nextId;
        appendSystem(t("sys.model", { label }));
      } catch (e: unknown) {
        if (
          gen !== modelApplyGen.current ||
          sessionAtStart !== sessionIdRef.current
        ) {
          return;
        }
        setPendingModelId(null);
        setModelSelectEpoch((n) => n + 1);
        const msg = e instanceof Error ? e.message : String(e);
        setError(t("err.setModel", { msg }));
      } finally {
        if (gen === modelApplyGen.current) {
          modelApplyLock.current = false;
        }
      }
    },
    [modelId, appendSystem, t],
  );

  const handleLogout = async () => {
    if (!confirmDiscardFiles()) return;
    setAuthBusy(true);
    try {
      await leaveProject();
      const res = await window.grokDesktop.logout();
      if (res.status) setAuth(res.status);
      setAuthMessage(res.message || t("auth.signedOut"));
      setBackbone(null);
    } finally {
      setAuthBusy(false);
    }
  };

  const handleSetApiKey = async (key: string) => {
    setAuthBusy(true);
    setError(null);
    try {
      const res = await window.grokDesktop.setApiKey(key);
      setAuth(res.status);
      if (res.ok) {
        setAuthMessage(t("auth.apiKeySet"));
        await refreshBackbone();
      }
    } finally {
      setAuthBusy(false);
    }
  };

  const allCommands = useMemo(
    () =>
      mergeCommands({
        desktop: DESKTOP_COMMANDS,
        skills: skillsToCommands(backbone?.skills || []),
        agent: agentCommands,
      }),
    [backbone?.skills, agentCommands],
  );

  const compactingRef = useRef(false);
  const [compacting, setCompacting] = useState(false);

  const runCompress = useCallback(
    async (hint?: unknown) => {
      if (!project || openingRef.current) return false;
      if (conn !== "online") {
        appendSystem(t("err.compressIdle"));
        return false;
      }
      if (compactingRef.current) return false;
      if (typeof window.grokDesktop.compact !== "function") {
        appendSystem(t("err.compressRestart"));
        return false;
      }
      const note = typeof hint === "string" ? hint.trim() : "";
      compactingRef.current = true;
      setCompacting(true);
      try {
        const result = (await window.grokDesktop.compact(note)) as {
          ok?: boolean;
          message?: string;
          tokens_before?: number;
          tokensBefore?: number;
          tokens_after?: number;
          tokensAfter?: number;
        } | null;
        if (result && result.ok === false) {
          throw new Error(result.message || t("err.compressFailed"));
        }
        const before = Number(result?.tokens_before ?? result?.tokensBefore);
        const after = Number(result?.tokens_after ?? result?.tokensAfter);
        // Empty CompactConversationResponse is success; counts come from
        // session_notification, not the RPC body.
        if (Number.isFinite(before) && Number.isFinite(after) && before > 0) {
          appendSystem(
            t("sys.compacted", {
              before: before.toLocaleString(),
              after: after.toLocaleString(),
            }),
          );
        }
        const mark = Math.max(
          sessionUsage.lastContextTokens,
          Number.isFinite(after) && after > 0 ? after : 0,
        );
        autoCompactFiredRef.current = {
          sessionId: sessionIdRef.current || "",
          tokens: mark,
        };
        return true;
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        if (
          /does not support Compress|not available on this Grok CLI|-32601|method not found/i.test(
            msg,
          )
        ) {
          autoCompactUnsupportedRef.current = true;
        }
        setError(msg || t("err.compressFailed"));
        appendSystem(t("err.compressFailedMsg", { msg }));
        return false;
      } finally {
        compactingRef.current = false;
        setCompacting(false);
      }
    },
    [project, conn, sessionUsage.lastContextTokens, appendSystem, setError, t],
  );

  const handleLocalCommand = useCallback(
    async (name: string, args = "") => {
      await runDesktopCommand(
        name,
        {
          newChat: () => void openSession({ mode: "new" }),
          toggleAlwaysApprove: () =>
            applyPermissionMode(nextAlwaysApproveMode(permissionMode)),
          compact: (hint) => {
            void runCompress(hint);
          },
          enterPlanMode: (description) =>
            enterPlanMode({
              description,
              sessionMode,
              setSessionMode,
              setError,
              appendSystem,
              setItems,
              submitFromComposer,
              t,
            }),
          preview: async (previewArgs) => {
            const a = String(previewArgs || "").trim();
            try {
              if (a.toLowerCase() === "close") {
                await window.grokDesktop.closePreview();
                appendSystem(t("sys.previewClosed"));
                return;
              }
              if (a.toLowerCase() === "snapshot") {
                const snap = await window.grokDesktop.previewSnapshot();
                const tokens = Math.ceil((snap.chars || snap.text.length) / 4);
                appendSystem(
                  t("sys.previewSnapshot", { tokens, text: snap.text }),
                );
                return;
              }
              await window.grokDesktop.openPreview(a);
              appendSystem(
                a
                  ? t("sys.previewOpened", { target: a })
                  : t("sys.previewOpenedPlain"),
              );
            } catch (e: unknown) {
              const msg = e instanceof Error ? e.message : String(e);
              setError(msg || t("err.previewFailed"));
            }
          },
        },
        args,
      );
    },
    [
      openSession,
      applyPermissionMode,
      permissionMode,
      appendSystem,
      setError,
      runCompress,
      sessionMode,
      setSessionMode,
      submitFromComposer,
      setItems,
      t,
    ],
  );

  useEffect(() => {
    autoCompactFiredRef.current = { sessionId: sessionId || "", tokens: 0 };
    autoCompactFailedAtRef.current = { sessionId: sessionId || "", tokens: 0 };
    autoCompactInFlightRef.current = false;
    autoCompactUnsupportedRef.current = false;
  }, [sessionId]);

  useEffect(() => {
    autoCompactUnsupportedRef.current = false;
    autoCompactFailedAtRef.current = { sessionId: "", tokens: 0 };
  }, [autoCompactAt]);

  useEffect(() => {
    if (!project || !sessionId) return;
    if (conn !== "online") return;
    if (openingRef.current) return;
    if (autoCompactInFlightRef.current) return;
    if (autoCompactUnsupportedRef.current) return;
    const ctx = sessionUsage.lastContextTokens;
    const fired = autoCompactFiredRef.current;
    const already =
      fired.sessionId === sessionId ? fired.tokens : 0;
    if (
      !shouldAutoCompact({
        at: autoCompactAt,
        lastContextTokens: ctx,
        alreadyFiredAt: already,
      })
    ) {
      return;
    }
    const failed = autoCompactFailedAtRef.current;
    if (failed.sessionId === sessionId && failed.tokens === ctx) {
      return;
    }
    appendSystem(
      t("sys.autoCompact", { ctx: ctx.toLocaleString(), at: autoCompactAt }),
    );
    autoCompactInFlightRef.current = true;
    void runCompress().then((ok) => {
      autoCompactInFlightRef.current = false;
      if (ok) {
        autoCompactFailedAtRef.current = { sessionId: "", tokens: 0 };
      } else if (!autoCompactUnsupportedRef.current) {
        autoCompactFailedAtRef.current = { sessionId, tokens: ctx };
      }
    });
  }, [
    project,
    sessionId,
    conn,
    sessionUsage.lastContextTokens,
    autoCompactAt,
    runCompress,
    appendSystem,
    t,
  ]);

  const applyAutoCompactAt = async (next: AutoCompactAt) => {
    setAutoCompactAt(next);
    try {
      const value = await window.grokDesktop.setAutoCompactAt(next);
      setAutoCompactAt(normalizeAutoCompactAt(value));
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg || t("err.saveCompact"));
    }
  };

  const setAppTheme = async (next: "dark" | "light") => {
    if (next === theme) return;
    applyTheme(next);
    setTheme(next);
    storeTheme(next);
    await window.grokDesktop.setTheme(next);
  };

  const applyPrivacyMode = async (next: boolean) => {
    if (next === privacyMode) return;
    setPrivacyMode(next);
    try {
      const value = await window.grokDesktop.setPrivacyMode(next);
      setPrivacyMode(Boolean(value));
    } catch (e: unknown) {
      setPrivacyMode(!next);
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg || t("err.privacy"));
    }
  };

  const applyCodingDataOptIn = async (next: boolean) => {
    if (next === codingDataOptIn) return;
    setCodingDataOptIn(next);
    try {
      const status = await window.grokDesktop.setCodingDataOptIn(next);
      setCodingDataOptIn(status.optedIn !== false);
      setCodingDataNote(status.note);
      if (status.note) {
        appendSystem(status.note);
      } else {
        appendSystem(next ? t("sys.codingOptIn") : t("sys.codingOptOut"));
      }
      setOfferAgentRestart(true);
    } catch (e: unknown) {
      setCodingDataOptIn(!next);
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg || t("err.codingData"));
    }
  };

  const applyAllowPrerelease = async (next: boolean) => {
    if (next === allowPrerelease) return;
    if (next && !window.confirm(t("updates.confirm"))) {
      return;
    }
    setAllowPrerelease(next);
    try {
      const stored = await window.grokDesktop.setAllowPrerelease(next);
      setAllowPrerelease(Boolean(stored));
    } catch (e: unknown) {
      setAllowPrerelease(!next);
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg || t("err.previewUpdates"));
    }
  };

  const applyDebugLogging = async (next: boolean) => {
    if (next === debugLogging) return;
    setDebugLogging(next);
    try {
      const res = await window.grokDesktop.setDebugLogging(next);
      setDebugLogging(Boolean(res.debugLogging));
      setDebugLogPath(res.debugLogPath || "");
    } catch (e: unknown) {
      setDebugLogging(!next);
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg || t("err.debugLogging"));
    }
  };

  useEffect(() => {
    if (!project) {
      setGitBranch(null);
      setGitDetached(false);
      return;
    }
    let cancelled = false;
    const refresh = async () => {
      try {
        const res = await window.grokDesktop.getGitBranch(project);
        if (cancelled) return;
        setGitBranch(res?.branch ?? null);
        setGitDetached(Boolean(res?.detached));
      } catch {
        if (!cancelled) {
          setGitBranch(null);
          setGitDetached(false);
        }
      }
    };
    void refresh();
    const id = window.setInterval(() => void refresh(), 5000);
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    return () => {
      cancelled = true;
      window.clearInterval(id);
      window.removeEventListener("focus", onFocus);
    };
  }, [project]);

  const homeDir = info?.home || null;
  const redact = useCallback(
    (text: string | null | undefined) =>
      redactSensitiveText(
        text == null ? "" : String(text),
        homeDir,
        privacyMode,
      ),
    [homeDir, privacyMode],
  );

  const restarting = openingLabel === t("status.restarting");
  const statusLabel = useMemo(() => {
    if (conn === "connecting") {
      return restarting ? t("status.restarting") : t("status.starting");
    }
    if (conn === "error") return t("status.error");
    if (permissions.length > 0) {
      return permissions.length === 1
        ? t("status.waitingApproval")
        : t("status.waitingApprovalN", { n: permissions.length });
    }
    if (conn === "busy") return t("status.working");
    if (conn === "online") return t("status.connected");
    return t("status.idle");
  }, [conn, permissions.length, restarting, t]);

  const platform =
    info?.platform ||
    (/Mac/i.test(navigator.userAgent || "")
      ? "darwin"
      : /Win/i.test(navigator.userAgent || "")
        ? "win32"
        : "linux");
  const platformClass =
    platform === "darwin"
      ? "platform-darwin"
      : platform === "win32"
        ? "platform-win"
        : "platform-linux";

  const onOpenSettings = useCallback(
    (section?: "mcp" | "plugins" | "skills") => {
      setSettingsSection(section || null);
      setSettingsOpen(true);
    },
    [],
  );
  const onComposerError = useCallback((message: string) => {
    setError(message);
  }, []);

  const columns = useColumnLayout();

  const overlayOpen = Boolean(
    planApproval || userQuestion || mcpElicit || folderTrust,
  );

  const settingsDialog = (
    <SettingsDialog
      open={settingsOpen}
      onClose={() => {
        setSettingsOpen(false);
        setSettingsSection(null);
      }}
      inert={overlayOpen}
      theme={theme}
      privacyMode={privacyMode}
      codingDataOptIn={codingDataOptIn}
      codingDataNote={codingDataNote}
      permissionMode={permissionMode}
      allowOutsideProject={allowOutsideProject}
      sandboxTerminal={sandboxTerminal}
      sandboxStatus={sandboxStatus}
      debugLogging={debugLogging}
      debugLogPath={debugLogPath}
      crashLogPath={crashLogPath}
      allowPrerelease={allowPrerelease}
      autoCompactAt={autoCompactAt}
      onSetTheme={(t) => void setAppTheme(t)}
      onSetPrivacyMode={(next) => void applyPrivacyMode(next)}
      onSetCodingDataOptIn={(next) => void applyCodingDataOptIn(next)}
      onSetPermissionMode={(m) => void applyPermissionMode(m)}
      onToggleAllowOutside={() => void toggleAllowOutside()}
      onSetSandboxTerminal={(next) => void applySandboxTerminal(next)}
      onSetDebugLogging={(next) => void applyDebugLogging(next)}
      onSetAllowPrerelease={(next) => void applyAllowPrerelease(next)}
      onSetAutoCompactAt={(next) => void applyAutoCompactAt(next)}
      onOpenDebugLog={() => void window.grokDesktop.openDebugLog()}
      onOpenCrashLog={() => void window.grokDesktop.openCrashLog()}
      onRestartAgent={() => {
        setSettingsOpen(false);
        setSettingsSection(null);
        void restartAgent();
      }}
      onRestartAfterWrite={async () => {
        if (project) await restartAgent();
        await refreshBackbone(project || undefined);
      }}
      restarting={isOpening}
      offerRestart={offerAgentRestart}
      grokBinary={info?.grokBinary || auth?.binary || ""}
      hasProject={Boolean(project)}
      skills={backbone?.skills || []}
      skillsError={backbone && !backbone.ok ? backbone.error : null}
      skillsLoading={signedIn && backbone == null}
      focusSection={settingsSection}
    />
  );

  const worktreeOverlay = (
    <WorktreeDialog
      state={worktreeDialog}
      busy={worktreeBusy}
      error={worktreeError}
      onCancel={closeWorktreeDialog}
      onFocusWindow={(windowId) => {
        void window.grokDesktop.focusProjectWindow(windowId).then((ok) => {
          if (ok) closeWorktreeDialog();
          else setWorktreeError(t("err.windowNotFound"));
        });
      }}
      onOpenAnyway={(cwd) => {
        void openPathAfterWorktree(cwd, false);
      }}
      onOpenPath={(cwd, newWindow) => {
        void openPathAfterWorktree(cwd, newWindow);
      }}
      onCreate={(opts) => {
        void handleCreateWorktree(opts);
      }}
    />
  );

  if (!project) {
    return (
      <PrivacyProvider privacyMode={privacyMode} home={homeDir}>
        <WelcomeView
          platformClass={platformClass}
          isOpening={isOpening}
          openingLabel={openingLabel}
          signedIn={signedIn}
          auth={auth}
          backbone={backbone}
          authBusy={authBusy}
          authMessage={authMessage}
          loginProgress={loginProgress}
          loginDeviceAuth={loginDeviceAuth}
          error={error ? redact(error) : null}
          recentProjects={info?.recentProjects || []}
          appVersion={info?.version}
          grokBinary={redact(info?.grokBinary || auth?.binary || t("welcome.detecting"))}
          onRefreshAuth={() => {
            void refreshAuth().then((s) => {
              if (s.authenticated && !s.expired) void refreshBackbone();
            });
          }}
          onLogin={(device) => void handleLogin(device)}
          onCancelLogin={() => void handleCancelLogin()}
          onSubmitLoginCode={(code) => void handleSubmitLoginCode(code)}
          onLogout={() => void handleLogout()}
          onSetApiKey={(key) => void handleSetApiKey(key)}
          onPickProject={() => void pickProject()}
          onOpenProject={(cwd) => {
            if (!confirmDiscardFiles()) return;
            void openProject(cwd);
          }}
          openCheckouts={openCheckouts}
          onOpenSettingsSection={onOpenSettings}
          platform={platform}
          inert={settingsOpen}
        />
        {worktreeOverlay}
        {settingsDialog}
      </PrivacyProvider>
    );
  }

  return (
    <PrivacyProvider privacyMode={privacyMode} home={homeDir}>
      <div
        className={
          `app ${platformClass}` +
          (columns.sidebarCollapsed ? " app--sidebar-collapsed" : "") +
          (columns.panelCollapsed ? " app--panel-collapsed" : "") +
          (columns.resizing ? " app--resizing" : "")
        }
        style={columns.cssVars}
      >
        <div className="app-col app-col--sidebar">
          <AppSidebar
            infoVersion={info?.version}
            grokBinary={info?.grokBinary}
            auth={auth}
            backbone={backbone}
            project={project}
            sessionId={sessionId}
            sessions={sessions}
            recentProjects={info?.recentProjects || []}
            conn={conn}
            isOpening={isOpening}
            authBusy={authBusy}
            collapsed={columns.sidebarCollapsed}
            onToggleCollapsed={columns.toggleSidebar}
            onPickProject={() => void pickProject()}
            onNewWorktree={() => {
              if (project) void createWorktreeInNewWindow(project);
            }}
            onOpenProject={(cwd) => {
              if (!confirmDiscardFiles()) return;
              void openProject(cwd, { mode: "continue" });
            }}
            openCheckouts={openCheckouts}
            onOpenSession={(opts) => void openSession(opts)}
            onRenameSession={(opts) => renameSession(opts)}
            onDeleteSession={(opts) => deleteSession(opts)}
            onLogout={() => void handleLogout()}
            onOpenSettingsSection={onOpenSettings}
            inert={settingsOpen}
          />
          <ColumnResizeHandle
            side="sidebar"
            collapsed={columns.sidebarCollapsed}
            width={columns.sidebarPx}
            min={columns.sidebarMin}
            max={columns.sidebarMax}
            onPointerDown={columns.onSidebarResizeDown}
            onPointerMove={columns.onResizePointerMove}
            onPointerUp={columns.endResizeDrag}
            onDoubleClick={columns.resetSidebar}
          />
        </div>

        <main className="main" inert={settingsOpen || undefined}>
          <ChatTopbar
            project={project}
            conn={conn}
            statusLabel={statusLabel}
            isOpening={isOpening}
            modelId={modelId}
            modelName={modelName}
            pendingModelId={pendingModelId}
            modelSelectEpoch={modelSelectEpoch}
            availableModels={availableModels}
            permissionMode={permissionMode}
            reasoningEffort={reasoningEffort}
            sessionMode={sessionMode}
            allowOutsideProject={allowOutsideProject}
            sandboxTerminal={sandboxTerminal}
            privacyMode={privacyMode}
            backgroundTasks={backgroundTasks}
            onModel={(id) => void applyModel(id)}
            onPermissionMode={(m) => void applyPermissionMode(m)}
            onReasoningEffort={(e) => void applyReasoningEffort(e)}
            onOpenSettings={onOpenSettings}
            onOpenPreview={() => void handleLocalCommand("preview")}
            onCompress={runCompress}
            compacting={compacting}
            hideThinking={hideThinking}
            onHideThinking={(next) => {
              setHideThinking(next);
              storeHideThinking(next);
            }}
            allowWritesThisSession={allowWritesThisSession}
            onRevokeWritesThisSession={() =>
              void onRevokeWritesThisSession()
            }
            onStop={() => {
              setItems((prev) => finalizeOpenTools(prev, "cancelled"));
              void window.grokDesktop.cancel();
            }}
          />

          {isOpening && (
            <div className="loading-banner loading-banner-inline" role="status">
              <Spinner size={16} />
              <div>
                <strong>
                  {restarting ? t("status.restarting") : t("status.starting")}
                </strong>
                <span>
                  {restarting
                    ? t("status.reconnecting")
                    : openingLabel
                      ? t("status.opening", { label: openingLabel })
                      : t("status.connecting")}
                </span>
              </div>
            </div>
          )}

          {error && (
            <div className="error-banner">
              {redact(error)}
              {isAuthError(error) ? (
                <button
                  className="btn"
                  type="button"
                  style={{ marginLeft: 12 }}
                  onClick={() => {
                    if (!confirmDiscardFiles()) return;
                    void leaveProject();
                  }}
                >
                  {t("auth.signInAgain")}
                </button>
              ) : null}
            </div>
          )}

          <MessageList
            key={`messages:${sessionId || "no-session"}`}
            items={items}
            bottomRef={bottomRef}
            scrollerRef={timelineRef}
            knownCommands={allCommands}
            planMode={sessionMode === "plan"}
            streaming={conn === "busy"}
            hideThinking={hideThinking}
            pendingPermissions={permissions}
            onPermission={onPermission}
            onAllowAllPermissions={() => void onAllowAllPermissions()}
          />

          <ApprovalsDock
            permissions={permissions}
            onPermission={(reqId, optionId) =>
              void onPermission(reqId, optionId)
            }
            onAllowAll={() => void onAllowAllPermissions()}
            onAllowWritesThisSession={() => void onAllowWritesThisSession()}
          />

          <Composer
            key={`composer:${sessionId || "no-session"}`}
            conn={conn}
            projectOpen={Boolean(project)}
            commands={allCommands}
            promptQueue={promptQueue}
            onSubmit={submitFromComposer}
            onLocalCommand={handleLocalCommand}
            onSendQueuedNow={sendQueuedNow}
            onRemoveQueued={removeQueued}
            onError={onComposerError}
          />

          <StatusBar
            privacyMode={privacyMode}
            onOpenSettings={onOpenSettings}
            gitBranch={gitBranch}
            gitDetached={gitDetached}
            sessionUsage={sessionUsage}
          />
        </main>

        <div className="app-col app-col--panel">
          <ColumnResizeHandle
            side="panel"
            collapsed={columns.panelCollapsed}
            width={columns.panelPx}
            min={columns.panelMin}
            max={columns.panelMax}
            onPointerDown={columns.onPanelResizeDown}
            onPointerMove={columns.onResizePointerMove}
            onPointerUp={columns.endResizeDrag}
            onDoubleClick={columns.resetPanel}
          />
          <SidePanel
            project={project}
            backgroundTasks={backgroundTasks}
            sessionMode={sessionMode}
            onDirtyChange={setFilesDirty}
            inert={settingsOpen}
            collapsed={columns.panelCollapsed}
            onToggleCollapsed={columns.togglePanel}
          />
        </div>
      </div>

        {worktreeOverlay}
        {settingsDialog}

        <PlanApprovalDialog
          request={planApproval}
          onRespond={(reqId, decision) => void onPlanApproval(reqId, decision)}
        />
        <AskUserDialog
          request={userQuestion}
          onRespond={(reqId, decision) => void onUserQuestion(reqId, decision)}
        />
        <FolderTrustDialog
          request={folderTrust}
          onRespond={(reqId, decision) => void onFolderTrust(reqId, decision)}
        />
        <McpElicitDialog
          request={mcpElicit}
          onRespond={(reqId, decision) => void onMcpElicit(reqId, decision)}
        />
    </PrivacyProvider>
  );
}
