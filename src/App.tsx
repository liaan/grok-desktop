import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
  type DragEvent,
  type KeyboardEvent,
} from "react";
import { AuthGate } from "./components/AuthGate";
import { BrandMark, Spinner } from "./components/BrandMark";
import { CommandMenu } from "./components/CommandMenu";
import { MessageList } from "./components/MessageList";
import { SidePanel } from "./components/SidePanel";
import { ElevatedSafetyChips } from "./components/ElevatedSafetyChips";
import { SettingsDialog } from "./components/SettingsDialog";
import {
  PlanApprovalDialog,
  type PlanApprovalRequest,
} from "./components/PlanApprovalDialog";
import {
  AskUserDialog,
  type AskUserRequest,
} from "./components/AskUserDialog";
import {
  agentCommandsFromUpdate,
  DESKTOP_COMMANDS,
  filterCommands,
  formatCommandInsert,
  isSlashMenuOpen,
  mergeCommands,
  skillsToCommands,
  slashQuery,
  type SlashCommand,
} from "./lib/commands";
import {
  applyBackgroundUpdate,
  type BackgroundTask,
} from "./lib/background-tasks";
import {
  normalizePermissionMode,
  type PermissionMode,
} from "./lib/permission-mode";
import { applySessionUpdate, uid } from "./lib/timeline";
import type {
  AppInfo,
  AuthStatus,
  BackboneSummary,
  PermissionRequest,
  PromptImage,
  SessionSummary,
  TimelineImage,
  TimelineItem,
} from "./vite-env";

type ConnState = "idle" | "connecting" | "online" | "busy" | "error";

type PendingImage = PromptImage & {
  id: string;
  previewUrl: string;
  name?: string;
};

/** Follow-up held until the current agent turn finishes (CLI-style queue). */
type QueuedPrompt = {
  id: string;
  text: string;
  images: PendingImage[];
  at: number;
};

const MAX_IMAGE_BYTES = 12 * 1024 * 1024;

function basename(p: string) {
  return p.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || p;
}

function formatSessionWhen(iso: string | null | undefined) {
  if (!iso) return "";
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  try {
    return new Date(t).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

function isAuthError(msg: string) {
  return /auth|login|unauthor|401|credential|sign in|sign-in/i.test(msg);
}

function applyTheme(theme: "dark" | "light") {
  document.documentElement.setAttribute("data-theme", theme);
}

function blobToBase64(blob: Blob): Promise<{ data: string; mimeType: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || "");
      const comma = result.indexOf(",");
      const data = comma >= 0 ? result.slice(comma + 1) : result;
      resolve({ data, mimeType: blob.type || "image/png" });
    };
    reader.onerror = () => reject(reader.error || new Error("Failed to read image"));
    reader.readAsDataURL(blob);
  });
}

async function fileToPendingImage(file: Blob, name?: string): Promise<PendingImage> {
  if (!file.type.startsWith("image/")) {
    throw new Error("Only image files can be attached");
  }
  if (file.size > MAX_IMAGE_BYTES) {
    throw new Error("Image is too large (max 12 MB)");
  }
  const { data, mimeType } = await blobToBase64(file);
  return {
    id: uid("img"),
    data,
    mimeType,
    previewUrl: `data:${mimeType};base64,${data}`,
    name: name || (file instanceof File ? file.name : undefined),
  };
}

export default function App() {
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [auth, setAuth] = useState<AuthStatus | null>(null);
  const [backbone, setBackbone] = useState<BackboneSummary | null>(null);
  const [authBusy, setAuthBusy] = useState(false);
  const [authMessage, setAuthMessage] = useState<string | null>(null);
  const [project, setProject] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [conn, setConn] = useState<ConnState>("idle");
  const [openingLabel, setOpeningLabel] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<TimelineItem[]>([]);
  const [input, setInput] = useState("");
  const [pendingImages, setPendingImages] = useState<PendingImage[]>([]);
  const [permissions, setPermissions] = useState<PermissionRequest[]>([]);
  const [backgroundTasks, setBackgroundTasks] = useState<BackgroundTask[]>([]);
  const [sessionMode, setSessionMode] = useState<string | null>(null);
  const [planApproval, setPlanApproval] =
    useState<PlanApprovalRequest | null>(null);
  const [userQuestion, setUserQuestion] = useState<AskUserRequest | null>(
    null,
  );
  const [permissionMode, setPermissionMode] =
    useState<PermissionMode>("ask");
  /** Default safe: block ACP fs + terminal cwd outside project */
  const [allowOutsideProject, setAllowOutsideProject] = useState(false);
  /** Default safe: OS FS jail for ACP tool shells */
  const [sandboxTerminal, setSandboxTerminal] = useState(true);
  const [sandboxStatus, setSandboxStatus] = useState("");
  const [theme, setTheme] = useState<"dark" | "light">(() => {
    try {
      const t = localStorage.getItem("grok-desktop-theme");
      return t === "light" ? "light" : "dark";
    } catch {
      return "dark";
    }
  });
  const [settingsOpen, setSettingsOpen] = useState(false);
  /** Commands advertised by the agent via available_commands_update */
  const [agentCommands, setAgentCommands] = useState<SlashCommand[]>([]);
  const [cmdIndex, setCmdIndex] = useState(0);
  /** Escape dismisses menu without wiping a non-command draft */
  const [slashDismissed, setSlashDismissed] = useState(false);
  /** Mid-turn follow-ups (FIFO). Drained when the active turn ends. */
  const [promptQueue, setPromptQueue] = useState<QueuedPrompt[]>([]);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const timelineRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const busyRef = useRef(false);
  const promptQueueRef = useRef<QueuedPrompt[]>([]);
  /** Cancel current turn, then send this before any other queued items */
  const sendNowRef = useRef<QueuedPrompt | null>(null);
  /** True while open/switch IPC is in flight — ignore agent:ready for conn */
  const openingRef = useRef(false);

  useEffect(() => {
    promptQueueRef.current = promptQueue;
  }, [promptQueue]);

  const addImages = useCallback(async (files: ArrayLike<Blob | File>) => {
    const next: PendingImage[] = [];
    const errors: string[] = [];
    for (const file of Array.from(files)) {
      try {
        next.push(
          await fileToPendingImage(
            file,
            file instanceof File ? file.name : undefined,
          ),
        );
      } catch (e: any) {
        errors.push(e?.message || String(e));
      }
    }
    if (next.length) {
      setPendingImages((prev) => [...prev, ...next]);
    }
    if (errors.length) {
      setError(errors[0]);
    }
  }, []);

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
    setPermissionMode(
      normalizePermissionMode(i.permissionMode, i.alwaysApprove),
    );
    setAllowOutsideProject(Boolean(i.allowOutsideProject));
    setSandboxTerminal(i.sandboxTerminal !== false);
    setSandboxStatus(i.sandboxStatus || "");
    const nextTheme = i.theme === "light" ? "light" : "dark";
    setTheme(nextTheme);
    applyTheme(nextTheme);
    setAuth(i.auth);
    if (i.auth.authenticated && !i.auth.expired) {
      void refreshBackbone(i.lastProject || undefined);
    }
  }, [refreshBackbone]);

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

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
          kind === "subagent_finished"
        ) {
          setBackgroundTasks((prev) => applyBackgroundUpdate(prev, params));
        }
        setItems((prev) => applySessionUpdate(prev, params));
      }),
      window.grokDesktop.on("agent:permission-request", (payload) => {
        setPermissions((prev) => [...prev, payload as PermissionRequest]);
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
      }),
      window.grokDesktop.on("agent:ready", () => {
        // Session id / online come only from open IPC (applyOpenResult).
        // Ignoring ready here prevents flash of wrong chat + early composer.
      }),
      window.grokDesktop.on("agent:stderr", () => {
        /* available for debug panel later */
      }),
      window.grokDesktop.on("app:open-settings", () => {
        setSettingsOpen(true);
      }),
    ];
    return () => offs.forEach((off) => off());
  }, []);

  useEffect(() => {
    const el = timelineRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [items, permissions]);

  const signedIn = Boolean(auth?.authenticated && !auth?.expired);

  const applyOpenResult = useCallback(
    async (
      res: Awaited<ReturnType<typeof window.grokDesktop.openProject>> & {
        warning?: string | null;
      },
      opts?: { note?: string },
    ) => {
      setProject(res.cwd);
      setSessionId(res.sessionId);
      setSessions(res.sessions || []);
      setPermissions([]);
      setBackgroundTasks([]);
      setSessionMode(null);
      setPlanApproval(null);
      setUserQuestion(null);
      // Agent re-advertises available_commands_update after session setup
      setAgentCommands([]);
      setCmdIndex(0);
      setSlashDismissed(false);
      setPromptQueue([]);
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
          opts?.note ||
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
      // Atomic UI commit: history + online together
      setItems([banner, ...history]);
      setConn("online");
      setOpeningLabel(null);
      setError(res.warning || null);

      const i = await window.grokDesktop.getInfo();
      setInfo(i);
      setAuth(i.auth);
    },
    [refreshBackbone],
  );

  const openProject = useCallback(
    async (
      cwd: string,
      opts?: { mode?: "continue" | "new" | "resume"; sessionId?: string },
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
      setPermissions([]);
      try {
        const res = await window.grokDesktop.openProject(cwd, {
          mode: opts?.mode || "continue",
          sessionId: opts?.sessionId,
        });
        await applyOpenResult(res);
      } catch (e: any) {
        const msg = e?.message || String(e);
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
    [auth, refreshAuth, applyOpenResult],
  );

  const openSession = useCallback(
    async (opts: { sessionId?: string; mode?: "new" | "resume" }) => {
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
      setOpeningLabel(opts.mode === "new" ? "New chat" : "Resuming…");
      setError(null);
      setItems([]);
      setPermissions([]);
      try {
        const res = await window.grokDesktop.openSession({
          cwd: project,
          sessionId: opts.sessionId,
          mode: opts.mode || "resume",
        });
        await applyOpenResult(res, {
          note:
            opts.mode === "new"
              ? "Started a new chat (CLI /new)"
              : "Resumed previous chat (CLI /resume)",
        });
      } catch (e: any) {
        const msg = e?.message || String(e);
        setConn("error");
        setOpeningLabel(null);
        setError(msg);
      } finally {
        openingRef.current = false;
      }
    },
    [project, auth, refreshAuth, applyOpenResult],
  );

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
      }
    } catch (e: any) {
      const msg = e?.message || String(e);
      setAuthMessage(msg);
      setError(msg);
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

  const handleLogout = async () => {
    setAuthBusy(true);
    try {
      const res = await window.grokDesktop.logout();
      if (res.status) setAuth(res.status);
      setAuthMessage(res.message || "Signed out");
      setBackbone(null);
      setProject(null);
      setSessionId(null);
      setSessions([]);
      setItems([]);
      setConn("idle");
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

  const menuOpen = isSlashMenuOpen(input) && !slashDismissed;
  const filteredCommands = useMemo(
    () => (menuOpen ? filterCommands(allCommands, slashQuery(input)) : []),
    [menuOpen, allCommands, input],
  );

  useEffect(() => {
    setCmdIndex(0);
    setSlashDismissed(false);
  }, [input]);

  useEffect(() => {
    if (cmdIndex >= filteredCommands.length) {
      setCmdIndex(Math.max(0, filteredCommands.length - 1));
    }
  }, [filteredCommands.length, cmdIndex]);

  const enqueuePrompt = useCallback(
    (text: string, images: PendingImage[]) => {
      const item: QueuedPrompt = {
        id: uid("q"),
        text,
        images: images.map((img) => ({ ...img })),
        at: Date.now(),
      };
      setPromptQueue((prev) => {
        const next = [...prev, item];
        promptQueueRef.current = next;
        return next;
      });
      return item;
    },
    [],
  );

  const removeQueued = useCallback((id: string) => {
    setPromptQueue((prev) => {
      const next = prev.filter((q) => q.id !== id);
      promptQueueRef.current = next;
      return next;
    });
    if (sendNowRef.current?.id === id) sendNowRef.current = null;
  }, []);

  /** Deliver one prompt to the agent (must not be called while already busy). */
  const deliverPrompt = async (payload: {
    text: string;
    images: PendingImage[];
  }) => {
    if (!project || busyRef.current) return;
    const text = payload.text.trim();
    const images = payload.images;
    if (!text && images.length === 0) return;

    busyRef.current = true;
    setConn("busy");
    const timelineImages: TimelineImage[] = images.map((img) => ({
      mimeType: img.mimeType,
      previewUrl: img.previewUrl,
    }));
    setItems((prev) => [
      ...prev,
      {
        id: uid("user"),
        kind: "user",
        text:
          text ||
          (images.length
            ? `(${images.length} image${images.length > 1 ? "s" : ""})`
            : ""),
        images: timelineImages.length ? timelineImages : undefined,
        optimistic: true,
        at: Date.now(),
      },
    ]);
    try {
      await window.grokDesktop.prompt(text, {
        images: images.map(({ data, mimeType }) => ({ data, mimeType })),
      });
      setConn("online");
    } catch (e: any) {
      const msg = e?.message || String(e);
      // Cancel often surfaces as an error — treat gently if we have more work
      const cancelled = /cancel/i.test(msg);
      if (cancelled) {
        setConn("online");
      } else {
        setConn("error");
        setError(msg);
        setItems((prev) => [
          ...prev,
          {
            id: uid("sys"),
            kind: "system",
            text: `Error: ${msg}`,
            at: Date.now(),
          },
        ]);
        if (isAuthError(msg)) void refreshAuth();
      }
    } finally {
      busyRef.current = false;
      // Priority: cancel-and-send target, then FIFO queue
      const nextNow = sendNowRef.current;
      if (nextNow) {
        sendNowRef.current = null;
        setPromptQueue((prev) => {
          const next = prev.filter((q) => q.id !== nextNow.id);
          promptQueueRef.current = next;
          return next;
        });
        void deliverPrompt({ text: nextNow.text, images: nextNow.images });
        return;
      }
      const queued = promptQueueRef.current[0];
      if (queued) {
        setPromptQueue((prev) => {
          const next = prev.slice(1);
          promptQueueRef.current = next;
          return next;
        });
        void deliverPrompt({ text: queued.text, images: queued.images });
      }
    }
  };

  /**
   * @param overrideText force text (slash menu)
   * @param opts.mode
   *   - auto: idle → send; busy → queue (CLI Enter)
   *   - queue: always queue if busy, else send
   *   - now: cancel current turn and send this next (CLI Ctrl+Enter interject)
   */
  const sendPrompt = async (
    overrideText?: string,
    opts?: { mode?: "auto" | "queue" | "now" },
  ) => {
    const mode = opts?.mode || "auto";
    const text = (overrideText !== undefined ? overrideText : input).trim();
    const images = overrideText !== undefined ? [] : pendingImages;
    if ((!text && images.length === 0) || !project) return;
    if (conn === "connecting" || openingRef.current) return;

    // Desktop-local slash commands (do not send to agent)
    const localMatch = text.match(/^\/([^\s]+)(?:\s+(.*))?$/s);
    if (localMatch) {
      const name = localMatch[1].toLowerCase();
      const local = DESKTOP_COMMANDS.find(
        (c) => c.local && c.name.toLowerCase() === name,
      );
      if (local) {
        setInput("");
        if (name === "new" || name === "clear") {
          void openSession({ mode: "new" });
          return;
        }
        if (name === "always-approve") {
          const next: PermissionMode =
            permissionMode === "always-approve" ? "ask" : "always-approve";
          const mode = await window.grokDesktop.setPermissionMode(next);
          setPermissionMode(normalizePermissionMode(mode));
          setItems((prev) => [
            ...prev,
            {
              id: uid("sys"),
              kind: "system",
              text: `Tool permission mode: ${normalizePermissionMode(mode)}`,
              at: Date.now(),
            },
          ]);
          return;
        }
      }
    }

    const snapshotImages = images.map((img) => ({ ...img }));

    // Mid-turn: queue or cancel-and-send (interject)
    if (busyRef.current) {
      if (mode === "now") {
        const item = enqueuePrompt(text, snapshotImages);
        sendNowRef.current = item;
        setInput("");
        if (overrideText === undefined) setPendingImages([]);
        void window.grokDesktop.cancel();
        return;
      }
      // auto / queue → hold for end of turn
      enqueuePrompt(text, snapshotImages);
      setInput("");
      if (overrideText === undefined) setPendingImages([]);
      return;
    }

    setInput("");
    if (overrideText === undefined) setPendingImages([]);
    await deliverPrompt({ text, images: snapshotImages });
  };

  const sendPromptRef = useRef(sendPrompt);
  sendPromptRef.current = sendPrompt;

  /** Force-send top of queue now (cancel current turn). */
  const sendQueuedNow = (id?: string) => {
    const list = promptQueueRef.current;
    const item = id ? list.find((q) => q.id === id) : list[0];
    if (!item) return;
    sendNowRef.current = item;
    if (busyRef.current) {
      void window.grokDesktop.cancel();
    } else {
      // Idle with leftover queue (shouldn't happen often)
      setPromptQueue((prev) => {
        const next = prev.filter((q) => q.id !== item.id);
        promptQueueRef.current = next;
        return next;
      });
      void deliverPrompt({ text: item.text, images: item.images });
    }
  };

  const applySlashCommand = useCallback(
    (cmd: SlashCommand, mode: "insert" | "run" = "run") => {
      if (cmd.local) {
        setInput("");
        if (cmd.name === "new" || cmd.name === "clear") {
          void openSession({ mode: "new" });
          return;
        }
        if (cmd.name === "always-approve") {
          void (async () => {
            const next: PermissionMode =
              permissionMode === "always-approve" ? "ask" : "always-approve";
            const mode = await window.grokDesktop.setPermissionMode(next);
            setPermissionMode(normalizePermissionMode(mode));
            setItems((prev) => [
              ...prev,
              {
                id: uid("sys"),
                kind: "system",
                text: `Tool permission mode: ${normalizePermissionMode(mode)}`,
                at: Date.now(),
              },
            ]);
          })();
          return;
        }
        return;
      }

      // Tab / click / arg-hint: leave `/name ` so the user can add args
      if (mode === "insert" || cmd.inputHint) {
        setInput(formatCommandInsert(cmd));
        requestAnimationFrame(() => {
          const el = textareaRef.current;
          if (!el) return;
          el.focus();
          const len = el.value.length;
          el.setSelectionRange(len, len);
        });
        return;
      }

      // Enter only: run bare skill/agent command (CLI-style)
      void sendPromptRef.current(`/${cmd.name}`);
    },
    [permissionMode, openSession],
  );

  const onComposerKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (menuOpen && filteredCommands.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setCmdIndex((i) => (i + 1) % filteredCommands.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setCmdIndex(
          (i) =>
            (i - 1 + filteredCommands.length) % filteredCommands.length,
        );
        return;
      }
      if (e.key === "Tab") {
        e.preventDefault();
        const cmd = filteredCommands[cmdIndex] || filteredCommands[0];
        if (cmd) applySlashCommand(cmd, "insert");
        return;
      }
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        const cmd = filteredCommands[cmdIndex] || filteredCommands[0];
        if (cmd) applySlashCommand(cmd, "run");
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        // Dismiss menu only — keep whatever is in the composer
        setSlashDismissed(true);
        return;
      }
    }
    // Ctrl/Cmd+Enter: cancel-and-send (interject) when busy, else send
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void sendPrompt(undefined, { mode: "now" });
      return;
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      // Empty composer + queue + busy → force-send top (CLI double-Enter)
      if (
        !input.trim() &&
        pendingImages.length === 0 &&
        promptQueueRef.current.length > 0
      ) {
        sendQueuedNow();
        return;
      }
      void sendPrompt(undefined, { mode: "auto" });
    }
  };

  const onPaste = async (e: ClipboardEvent<HTMLTextAreaElement>) => {
    // Always allow normal text paste (Cmd/Ctrl+V). Only intercept pure image pastes.
    const imageFiles: File[] = [];
    const items = e.clipboardData?.items;
    if (items?.length) {
      for (const item of Array.from(items)) {
        if (item.type.startsWith("image/")) {
          const file = item.getAsFile();
          if (file) imageFiles.push(file);
        }
      }
    }
    if (imageFiles.length === 0 && e.clipboardData?.files?.length) {
      for (const file of Array.from(e.clipboardData.files)) {
        if (file.type.startsWith("image/")) imageFiles.push(file);
      }
    }

    // No images → let Electron/browser handle text paste (needs Edit menu roles)
    if (imageFiles.length === 0) return;

    const hasText = Boolean(e.clipboardData?.getData("text/plain")?.trim());
    // Image-only: take over so we attach instead of inserting binary garbage
    if (!hasText) e.preventDefault();
    try {
      await addImages(imageFiles);
    } catch (err: any) {
      setError(err?.message || String(err));
    }
  };

  const onDrop = async (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const files = Array.from(e.dataTransfer?.files || []).filter((f) =>
      f.type.startsWith("image/"),
    );
    if (files.length) await addImages(files);
  };

  const removePendingImage = (id: string) => {
    setPendingImages((prev) => prev.filter((img) => img.id !== id));
  };

  const onPermission = async (
    reqId: string,
    optionId: string | "cancelled",
  ) => {
    const outcome =
      optionId === "cancelled"
        ? { outcome: { outcome: "cancelled" as const } }
        : {
            outcome: {
              outcome: "selected" as const,
              optionId,
            },
          };
    await window.grokDesktop.respondPermission(reqId, outcome);
    setPermissions((prev) => prev.filter((p) => p.reqId !== reqId));
  };

  const onPlanApproval = async (
    reqId: string,
    decision:
      | { type: "approved" }
      | { type: "request_changes"; feedback: string }
      | { type: "abandoned" },
  ) => {
    await window.grokDesktop.respondPlanApproval(reqId, decision);
    setPlanApproval(null);
    if (decision.type === "approved") {
      setSessionMode(null);
    } else if (decision.type === "abandoned") {
      setSessionMode(null);
    }
  };

  const onUserQuestion = async (
    reqId: string,
    decision:
      | { type: "answered"; answers: Record<string, string> }
      | { type: "declined" },
  ) => {
    await window.grokDesktop.respondUserQuestion(reqId, decision);
    setUserQuestion(null);
  };

  const applyPermissionMode = async (next: PermissionMode) => {
    if (
      next === "always-approve" &&
      permissionMode !== "always-approve" &&
      !window.confirm(
        "Enable Always approve?\n\nTools will run without the Approvals panel. Deny rules and plan-mode edit gates still apply.",
      )
    ) {
      return;
    }
    const mode = await window.grokDesktop.setPermissionMode(next);
    setPermissionMode(normalizePermissionMode(mode));
  };

  const toggleAllowOutside = async () => {
    const next = !allowOutsideProject;
    if (
      next &&
      !window.confirm(
        "Allow the agent to read/write files and use working directories outside this project?\n\nThis reduces safety. Prefer leaving it off unless you need it.",
      )
    ) {
      return;
    }
    const value = await window.grokDesktop.setAllowOutsideProject(next);
    setAllowOutsideProject(value);
  };

  /** Prevent label+checkbox double-change from re-enabling during confirm/IPC. */
  const sandboxApplyLock = useRef(false);

  /**
   * Apply an explicit sandbox value (from the checkbox `checked` target).
   * Do not toggle from current state — label+checkbox can fire change twice;
   * a toggle would disable then immediately re-enable.
   */
  const applySandboxTerminal = async (next: boolean) => {
    if (sandboxApplyLock.current) return;
    if (next === sandboxTerminal) return;
    // Turning OFF is the elevated / dangerous direction
    if (
      next === false &&
      !window.confirm(
        "Disable terminal sandbox?\n\nTool shells will run with your full user account on the host. The agent can read ~/.ssh, talk to Docker, and wipe containers.\n\nLeave sandbox on unless you need unrestricted host access.",
      )
    ) {
      return;
    }
    sandboxApplyLock.current = true;
    try {
      const value = await window.grokDesktop.setSandboxTerminal(next);
      setSandboxTerminal(value);
    } finally {
      sandboxApplyLock.current = false;
    }
  };

  const setAppTheme = async (next: "dark" | "light") => {
    if (next === theme) return;
    applyTheme(next);
    setTheme(next);
    try {
      localStorage.setItem("grok-desktop-theme", next);
    } catch {
      /* ignore */
    }
    await window.grokDesktop.setTheme(next);
  };

  const statusLabel = useMemo(() => {
    if (conn === "connecting") return "Starting agent…";
    if (conn === "error") return "Error";
    if (permissions.length > 0) {
      return permissions.length === 1
        ? "Waiting for approval…"
        : `Waiting for approval… (${permissions.length})`;
    }
    if (conn === "busy") return "Working…";
    if (conn === "online") return "Connected";
    return "Idle";
  }, [conn, permissions.length]);

  // Prefer main-process platform; fall back so macOS padding applies before IPC returns
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

  if (!project) {
    return (
      <div className={`app no-project ${platformClass}`.trim()}>
        <div className="titlebar-drag welcome-drag" aria-hidden />
        <div className="welcome">
          <div className={`welcome-card ${isOpening ? "is-loading" : ""}`}>
            <div className="brand brand-welcome">
              <BrandMark size={40} />
              <div className="brand-text">
                <h1>Grok Desktop</h1>
                <p>xAI · Desktop GUI · Grok Build backbone</p>
              </div>
            </div>
            <p className="welcome-lead">
              Graphical shell over the same agent as the CLI. Sign in once in
              the app, then open a project — skills and MCP from{" "}
              <code>~/.grok</code> load automatically (configure them in the
              CLI for now).
            </p>

            <AuthGate
              auth={auth}
              backbone={backbone}
              busy={authBusy || isOpening}
              message={authMessage}
              onRefresh={() => {
                void refreshAuth().then((s) => {
                  if (s.authenticated && !s.expired) void refreshBackbone();
                });
              }}
              onLogin={(device) => void handleLogin(device)}
              onCancelLogin={() => void handleCancelLogin()}
              onLogout={() => void handleLogout()}
              onSetApiKey={(key) => void handleSetApiKey(key)}
              onOpenInstallDocs={() => void window.grokDesktop.openInstallDocs()}
            />

            <ul className="checklist">
              <li>Browser sign-in (no CLI required after Grok is installed)</li>
              <li>Skills &amp; MCP from your existing ~/.grok setup</li>
              <li>Streaming chat, thoughts, plans, tool approvals</li>
            </ul>

            <div className="welcome-actions">
              <button
                className="btn primary"
                onClick={() => void pickProject()}
                disabled={!signedIn || isOpening}
                title={
                  signedIn ? "Open a project folder" : "Sign in to Grok first"
                }
              >
                {isOpening ? (
                  <>
                    <Spinner size={16} />
                    Opening…
                  </>
                ) : (
                  "Open project…"
                )}
              </button>
              {signedIn &&
                (info?.recentProjects || []).slice(0, 3).map((p) => (
                  <button
                    key={p}
                    className="btn"
                    disabled={isOpening}
                    onClick={() => void openProject(p)}
                  >
                    {basename(p)}
                  </button>
                ))}
            </div>

            {isOpening && (
              <div className="loading-banner" role="status" aria-live="polite">
                <Spinner size={18} />
                <div>
                  <strong>Starting Grok agent…</strong>
                  <span>
                    Connecting to backbone
                    {openingLabel ? ` for ${openingLabel}` : ""}
                  </span>
                </div>
              </div>
            )}

            {error && (
              <p className="welcome-error">{error}</p>
            )}
            <p className="welcome-meta">
              App v{info?.version || "…"} · Backbone:{" "}
              {info?.grokBinary || auth?.binary || "detecting…"}
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`app ${platformClass}`.trim()}>
      <aside className="sidebar">
        <div className="brand">
          <BrandMark size={32} />
          <div className="brand-text">
            <h1>Grok Desktop</h1>
            <p>xAI · Grok Build GUI</p>
          </div>
        </div>

        <div className="sidebar-section">
          <button
            className="btn primary block"
            onClick={() => void pickProject()}
            disabled={isOpening || conn === "busy"}
          >
            {isOpening ? (
              <span className="btn-inline">
                <Spinner size={14} />
                Opening…
              </span>
            ) : (
              "Open project…"
            )}
          </button>
        </div>

        <div className="sidebar-section">
          <h2>Account</h2>
          <div className="sidebar-account">
            <div className="name">
              {auth?.displayName || auth?.email || "Signed in"}
            </div>
            <div className="path">
              {backbone?.ok
                ? `${backbone.skills.length} skills · ${backbone.mcpServers.length} MCP`
                : auth?.method || "session"}
            </div>
            <button
              className="btn block"
              style={{ marginTop: 8 }}
              onClick={() => void handleLogout()}
              disabled={authBusy || isOpening}
            >
              Sign out
            </button>
          </div>
        </div>

        <div className="sidebar-scroll">
          <div className="sidebar-section">
            <div className="sidebar-section-head">
              <h2>Chats</h2>
              <button
                type="button"
                className="btn ghost btn-sm"
                disabled={isOpening || conn === "busy"}
                title={
                  conn === "busy"
                    ? "Stop the current turn before starting a new chat"
                    : "Start a new chat (same as CLI /new)"
                }
                onClick={() => void openSession({ mode: "new" })}
              >
                New
              </button>
            </div>
            <div className="recent-list session-list">
              {sessions.length === 0 ? (
                <p className="sidebar-hint">
                  No saved chats yet for this project.
                </p>
              ) : (
                sessions.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    className={`recent-item ${s.id === sessionId ? "active" : ""}`}
                    disabled={isOpening || conn === "busy"}
                    title={s.id}
                    onClick={() =>
                      void openSession({ mode: "resume", sessionId: s.id })
                    }
                  >
                    <span className="name">{s.title || "(no summary)"}</span>
                    <span className="path">
                      {formatSessionWhen(s.lastActiveAt || s.updatedAt)}
                      {s.numChatMessages
                        ? ` · ${s.numChatMessages} msgs`
                        : ""}
                    </span>
                  </button>
                ))
              )}
            </div>
          </div>

          <div className="sidebar-section">
            <h2>Recent projects</h2>
            <div className="recent-list">
              {(info?.recentProjects || []).map((p) => (
                <button
                  key={p}
                  className={`recent-item ${p === project ? "active" : ""}`}
                  disabled={isOpening || conn === "busy"}
                  onClick={() => void openProject(p, { mode: "continue" })}
                >
                  <span className="name">{basename(p)}</span>
                  <span className="path">{p}</span>
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="sidebar-footer">
          <div className="sidebar-meta" title={sessionId || undefined}>
            Session: {sessionId ? sessionId.slice(0, 8) : "—"}…
          </div>
          <div className="sidebar-meta">App v{info?.version || "…"}</div>
          <div className="sidebar-meta" title={info?.grokBinary}>
            Binary: {info?.grokBinary}
          </div>
        </div>
      </aside>

      <SettingsDialog
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        theme={theme}
        permissionMode={permissionMode}
        allowOutsideProject={allowOutsideProject}
        sandboxTerminal={sandboxTerminal}
        sandboxStatus={sandboxStatus}
        onSetTheme={(t) => void setAppTheme(t)}
        onSetPermissionMode={(m) => void applyPermissionMode(m)}
        onToggleAllowOutside={() => void toggleAllowOutside()}
        onSetSandboxTerminal={(next) => void applySandboxTerminal(next)}
      />

      <main className="main">
        <div className="topbar">
          <div className="topbar-project">
            <div className="topbar-title">{basename(project)}</div>
            <div className="cwd" title={project}>
              {project}
            </div>
            <ElevatedSafetyChips
              sandboxTerminal={sandboxTerminal}
              allowOutsideProject={allowOutsideProject}
              permissionMode={permissionMode}
              onOpenSettings={() => setSettingsOpen(true)}
            />
          </div>
          <div className="topbar-actions row">
            <label className="perm-mode-topbar" title="Tool permission mode">
              <span className="perm-mode-topbar-label">Perms</span>
              <select
                className="perm-mode-select"
                value={permissionMode}
                aria-label="Tool permission mode"
                onChange={(e) =>
                  void applyPermissionMode(e.target.value as PermissionMode)
                }
              >
                <option value="ask">Ask</option>
                <option value="auto">Auto</option>
                <option value="always-approve">Always</option>
              </select>
            </label>
            <span
              className={`status-pill ${isOpening ? "status-pill-loading" : ""}`}
            >
              {isOpening ? (
                <Spinner size={12} className="spinner status-spinner" />
              ) : (
                <span
                  className={`status-dot ${
                    conn === "online" || conn === "busy"
                      ? conn === "busy"
                        ? "busy"
                        : "online"
                      : conn === "error"
                        ? "error"
                        : ""
                  }`}
                />
              )}
              {statusLabel}
            </span>
            {conn === "busy" && (
              <button
                className="btn danger"
                onClick={() => window.grokDesktop.cancel()}
              >
                Stop
              </button>
            )}
          </div>
        </div>

        {isOpening && (
          <div className="loading-banner loading-banner-inline" role="status">
            <Spinner size={16} />
            <div>
              <strong>Starting agent…</strong>
              <span>
                {openingLabel
                  ? `Opening ${openingLabel}`
                  : "Connecting to Grok backbone"}
              </span>
            </div>
          </div>
        )}

        {error && (
          <div className="error-banner">
            {error}
            {isAuthError(error) ? (
              <button
                className="btn"
                style={{ marginLeft: 12 }}
                onClick={() => {
                  setProject(null);
                  setError(null);
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
          />
        </div>

        <div className="composer">
          <div
            className="composer-box"
            onDragOver={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}
            onDrop={(e) => void onDrop(e)}
          >
            {menuOpen && (
              <CommandMenu
                items={filteredCommands}
                activeIndex={cmdIndex}
                onHover={setCmdIndex}
                onSelect={applySlashCommand}
              />
            )}
            {pendingImages.length > 0 && (
              <div className="composer-images">
                {pendingImages.map((img) => (
                  <div key={img.id} className="composer-image">
                    <img src={img.previewUrl} alt={img.name || "Attached"} />
                    <button
                      type="button"
                      className="composer-image-remove"
                      title="Remove image"
                      onClick={() => removePendingImage(img.id)}
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}
            {promptQueue.length > 0 && (
              <div className="prompt-queue" aria-label="Queued follow-ups">
                <div className="prompt-queue-head">
                  <span>
                    Queue · {promptQueue.length} follow-up
                    {promptQueue.length === 1 ? "" : "s"}
                  </span>
                  <span className="prompt-queue-hint">
                    runs after this turn · Enter on empty = send top now
                  </span>
                </div>
                <ul className="prompt-queue-list">
                  {promptQueue.map((q, i) => (
                    <li key={q.id} className="prompt-queue-item">
                      <span className="prompt-queue-idx">{i + 1}</span>
                      <span className="prompt-queue-text" title={q.text}>
                        {q.text ||
                          `(${q.images.length} image${q.images.length === 1 ? "" : "s"})`}
                      </span>
                      <button
                        type="button"
                        className="btn ghost btn-sm"
                        title="Send now (stops current turn)"
                        disabled={conn === "connecting"}
                        onClick={() => sendQueuedNow(q.id)}
                      >
                        Now
                      </button>
                      <button
                        type="button"
                        className="btn ghost btn-sm"
                        title="Remove from queue"
                        onClick={() => removeQueued(q.id)}
                      >
                        ×
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <textarea
              ref={textareaRef}
              value={input}
              placeholder={
                conn === "busy"
                  ? "Interject: Enter queues · Ctrl/⌘+Enter sends now (stops turn)…"
                  : "Ask Grok… or type / for skills & commands (review, design, implement…)"
              }
              onChange={(e) => setInput(e.target.value)}
              onPaste={(e) => void onPaste(e)}
              onKeyDown={onComposerKeyDown}
              disabled={conn === "connecting"}
            />
            <div className="composer-actions">
              <div className="row" style={{ gap: 8, minWidth: 0 }}>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  multiple
                  hidden
                  onChange={(e) => {
                    const files = e.target.files;
                    if (files?.length) void addImages(files);
                    e.target.value = "";
                  }}
                />
                <button
                  type="button"
                  className="btn"
                  disabled={conn === "connecting"}
                  onClick={() => fileInputRef.current?.click()}
                  title="Attach images"
                >
                  Attach
                </button>
                <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
                  {conn === "busy"
                    ? "Enter queue · Ctrl/⌘+Enter send now · Shift+Enter newline"
                    : "/ commands · Enter send · Shift+Enter newline"}
                </span>
              </div>
              <div className="row" style={{ gap: 8 }}>
                {conn === "busy" &&
                  (input.trim() || pendingImages.length > 0) && (
                    <button
                      type="button"
                      className="btn"
                      title="Stop current turn and send this message now"
                      onClick={() => void sendPrompt(undefined, { mode: "now" })}
                    >
                      Send now
                    </button>
                  )}
                <button
                  className="btn primary"
                  onClick={() =>
                    void sendPrompt(undefined, {
                      mode: conn === "busy" ? "queue" : "auto",
                    })
                  }
                  disabled={
                    (!input.trim() && pendingImages.length === 0) ||
                    conn === "connecting" ||
                    !project
                  }
                >
                  {conn === "busy" ? "Queue" : "Send"}
                </button>
              </div>
            </div>
          </div>
        </div>
      </main>

      <SidePanel
        project={project}
        permissions={permissions}
        backgroundTasks={backgroundTasks}
        sessionMode={sessionMode}
        onPermission={onPermission}
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
  );
}
