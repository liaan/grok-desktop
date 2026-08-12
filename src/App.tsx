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
import { ApprovalsDock } from "./components/ApprovalsDock";
import { AppSidebar } from "./components/AppSidebar";
import { ChatTopbar } from "./components/ChatTopbar";
import { WelcomeView } from "./components/WelcomeView";
import { Composer } from "./components/Composer";
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
import { isMissingBinaryError, type ConnState } from "./lib/conn";
import { PrivacyProvider } from "./lib/privacy-context";
import { redactSensitiveText } from "./lib/privacy";
import { applyTheme, readStoredTheme, storeTheme } from "./lib/theme";
import { finalizeOpenTools, uid } from "./lib/timeline";
import { useAgentEvents } from "./hooks/useAgentEvents";
import { useAgentSafety } from "./hooks/useAgentSafety";
import { useProjectSession } from "./hooks/useProjectSession";
import { usePromptDelivery } from "./hooks/usePromptDelivery";
import { useStickToBottom } from "./hooks/useStickToBottom";
import type {
  AppInfo,
  AuthStatus,
  AvailableModel,
  BackboneSummary,
  SessionSummary,
  TimelineItem,
} from "./vite-env";

export default function App() {
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [auth, setAuth] = useState<AuthStatus | null>(null);
  const [backbone, setBackbone] = useState<BackboneSummary | null>(null);
  const [authBusy, setAuthBusy] = useState(false);
  const [authMessage, setAuthMessage] = useState<string | null>(null);
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
  const [privacyMode, setPrivacyMode] = useState(false);
  /** SpaceXAI coding-data share; default opt-in (matches CLI /privacy). */
  const [codingDataOptIn, setCodingDataOptIn] = useState(true);
  const [codingDataNote, setCodingDataNote] = useState<string | undefined>();
  const [debugLogging, setDebugLogging] = useState(false);
  const [debugLogPath, setDebugLogPath] = useState("");
  const [gitBranch, setGitBranch] = useState<string | null>(null);
  const [gitDetached, setGitDetached] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsSection, setSettingsSection] = useState<
    "mcp" | "plugins" | "skills" | null
  >(null);
  const [offerAgentRestart, setOfferAgentRestart] = useState(false);
  const [agentCommands, setAgentCommands] = useState<SlashCommand[]>([]);

  const bottomRef = useRef<HTMLDivElement | null>(null);
  const timelineRef = useRef<HTMLDivElement | null>(null);
  const busyRef = useRef(false);
  const openingRef = useRef(false);
  const sessionIdRef = useRef(sessionId);
  sessionIdRef.current = sessionId;
  const modelApplyLock = useRef(false);
  const modelApplyGen = useRef(0);

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

  const {
    permissions,
    backgroundTasks,
    sessionUsage,
    sessionMode,
    planApproval,
    userQuestion,
    clearSessionScoped,
    hydrateBackgroundTasks,
    hydrateSessionUsage,
    syncPermissionsFromMain,
    onPermission,
    onAllowAllPermissions,
    onPlanApproval,
    onUserQuestion,
  } = useAgentEvents({
    openingRef,
    setConn,
    setError,
    setSessionId,
    setItems,
    setAgentCommands,
    setSettingsOpen,
  });

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
    const i = await window.grokDesktop.getInfo();
    setInfo(i);
    hydrateFromInfo(i);
    setPrivacyMode(Boolean(i.privacyMode));
    setCodingDataOptIn(i.codingDataOptIn !== false);
    setCodingDataNote(i.codingDataStatus?.note);
    setDebugLogging(Boolean(i.debugLogging));
    setDebugLogPath(i.debugLogPath || "");
    const nextTheme = i.theme === "light" ? "light" : "dark";
    setTheme(nextTheme);
    applyTheme(nextTheme);
    setAuth(i.auth);
    if (i.auth.authenticated && !i.auth.expired) {
      void refreshBackbone(i.lastProject || undefined);
    }
  }, [refreshBackbone, hydrateFromInfo]);

  useEffect(() => {
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
      hydrateBackgroundTasks,
      hydrateSessionUsage,
      syncPermissionsFromMain,
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
    });

  const pickProject = async () => {
    if (!signedIn || conn === "connecting") {
      if (!signedIn) setError("Sign in to Grok first.");
      return;
    }
    const cwd = await window.grokDesktop.pickProject();
    if (cwd) await openProject(cwd);
  };

  const isOpening = conn === "connecting";

  const handleLogin = async (deviceAuth = false) => {
    setAuthBusy(true);
    setAuthMessage(
      deviceAuth
        ? "Starting device-code login…"
        : "Opening browser for Grok sign-in…",
    );
    setError(null);
    try {
      const result = await window.grokDesktop.login({ deviceAuth });
      if (result.status) setAuth(result.status);
      if (result.output) setAuthMessage(result.output);
      if (result.ok || result.status?.authenticated) {
        setAuthMessage(result.output || "Signed in successfully.");
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
      const msg = e instanceof Error ? e.message : String(e);
      setAuthMessage(msg);
      setError(msg);
      if (isMissingBinaryError(msg)) {
        await refreshAuth();
      }
    } finally {
      setAuthBusy(false);
      void refreshAuth();
    }
  };

  const handleCancelLogin = async () => {
    await window.grokDesktop.cancelLogin();
    setAuthBusy(false);
    setAuthMessage("Login cancelled.");
    void refreshAuth();
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
              ? `Could not switch model (${result.error}).`
              : "Could not switch model.",
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
        appendSystem(`Model: ${label}`);
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
        setError(`Failed to set model: ${msg}`);
      } finally {
        if (gen === modelApplyGen.current) {
          modelApplyLock.current = false;
        }
      }
    },
    [modelId, appendSystem],
  );

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

  const handleLogout = async () => {
    setAuthBusy(true);
    try {
      await leaveProject();
      const res = await window.grokDesktop.logout();
      if (res.status) setAuth(res.status);
      setAuthMessage(res.message || "Signed out");
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
        setAuthMessage("API key set for this session.");
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

  const handleLocalCommand = useCallback(
    (name: string) => {
      runDesktopCommand(name, {
        newChat: () => void openSession({ mode: "new" }),
        toggleAlwaysApprove: () =>
          applyPermissionMode(nextAlwaysApproveMode(permissionMode)),
      });
    },
    [openSession, applyPermissionMode, permissionMode],
  );

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
      setError(msg || "Failed to set privacy mode");
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
        appendSystem(
          next
            ? "Coding data: Opt in (stored in ~/.grok/auth.json). Restart the agent so the running process picks it up."
            : "Coding data: Opt out. Restart the agent so the running process picks it up.",
        );
      }
      setOfferAgentRestart(true);
    } catch (e: unknown) {
      setCodingDataOptIn(!next);
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg || "Failed to set coding data preference");
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
      setError(msg || "Failed to set debug logging");
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

  const restarting = openingLabel === "Restarting agent…";
  const statusLabel = useMemo(() => {
    if (conn === "connecting") {
      return restarting ? "Restarting agent…" : "Starting agent…";
    }
    if (conn === "error") return "Error";
    if (permissions.length > 0) {
      return permissions.length === 1
        ? "Waiting for approval…"
        : `Waiting for approval… (${permissions.length})`;
    }
    if (conn === "busy") return "Working…";
    if (conn === "online") return "Connected";
    return "Idle";
  }, [conn, permissions.length, restarting]);

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

  const settingsDialog = (
    <SettingsDialog
      open={settingsOpen}
      onClose={() => {
        setSettingsOpen(false);
        setSettingsSection(null);
      }}
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
      onSetTheme={(t) => void setAppTheme(t)}
      onSetPrivacyMode={(next) => void applyPrivacyMode(next)}
      onSetCodingDataOptIn={(next) => void applyCodingDataOptIn(next)}
      onSetPermissionMode={(m) => void applyPermissionMode(m)}
      onToggleAllowOutside={() => void toggleAllowOutside()}
      onSetSandboxTerminal={(next) => void applySandboxTerminal(next)}
      onSetDebugLogging={(next) => void applyDebugLogging(next)}
      onOpenDebugLog={() => void window.grokDesktop.openDebugLog()}
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
          error={error ? redact(error) : null}
          recentProjects={info?.recentProjects || []}
          appVersion={info?.version}
          grokBinary={redact(info?.grokBinary || auth?.binary || "detecting…")}
          onRefreshAuth={() => {
            void refreshAuth().then((s) => {
              if (s.authenticated && !s.expired) void refreshBackbone();
            });
          }}
          onLogin={(device) => void handleLogin(device)}
          onCancelLogin={() => void handleCancelLogin()}
          onLogout={() => void handleLogout()}
          onSetApiKey={(key) => void handleSetApiKey(key)}
          onPickProject={() => void pickProject()}
          onOpenProject={(cwd) => void openProject(cwd)}
          onOpenSettingsSection={onOpenSettings}
          platform={platform}
        />
        {settingsDialog}
      </PrivacyProvider>
    );
  }

  return (
    <PrivacyProvider privacyMode={privacyMode} home={homeDir}>
      <div className={`app ${platformClass}`.trim()}>
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
          onPickProject={() => void pickProject()}
          onOpenProject={(cwd) => void openProject(cwd, { mode: "continue" })}
          onOpenSession={(opts) => void openSession(opts)}
          onLogout={() => void handleLogout()}
          onOpenSettingsSection={onOpenSettings}
        />

        {settingsDialog}

        <main className="main">
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
            allowOutsideProject={allowOutsideProject}
            sandboxTerminal={sandboxTerminal}
            privacyMode={privacyMode}
            backgroundTasks={backgroundTasks}
            onModel={(id) => void applyModel(id)}
            onPermissionMode={(m) => void applyPermissionMode(m)}
            onReasoningEffort={(e) => void applyReasoningEffort(e)}
            onOpenSettings={onOpenSettings}
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
                  {restarting ? "Restarting agent…" : "Starting agent…"}
                </strong>
                <span>
                  {restarting
                    ? "Reconnecting to Grok backbone"
                    : openingLabel
                      ? `Opening ${openingLabel}`
                      : "Connecting to Grok backbone"}
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
                    void leaveProject();
                  }}
                >
                  Sign in again
                </button>
              ) : null}
            </div>
          )}

          <div className="timeline" ref={timelineRef}>
            <MessageList
              items={items}
              bottomRef={bottomRef}
              knownCommands={allCommands}
              pendingPermissions={permissions}
              onPermission={onPermission}
              onAllowAllPermissions={() => void onAllowAllPermissions()}
            />
          </div>

          <ApprovalsDock
            permissions={permissions}
            onPermission={(reqId, optionId) =>
              void onPermission(reqId, optionId)
            }
            onAllowAll={() => void onAllowAllPermissions()}
          />

          <Composer
            key={sessionId || "no-session"}
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

        <SidePanel
          project={project}
          backgroundTasks={backgroundTasks}
          sessionMode={sessionMode}
        />

        <PlanApprovalDialog
          request={planApproval}
          onRespond={(reqId, decision) => void onPlanApproval(reqId, decision)}
        />
        <AskUserDialog
          request={userQuestion}
          onRespond={(reqId, decision) => void onUserQuestion(reqId, decision)}
        />
      </div>
    </PrivacyProvider>
  );
}
