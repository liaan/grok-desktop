/// <reference types="vite/client" />

declare module "../../shared/session-timeline.mjs" {
  export function uid(prefix?: string): string;
  export function isOpenToolStatus(status: unknown): boolean;
  export function isTerminalToolStatus(status: unknown): boolean;
  export function isBashBackgroundedRawOutput(rawOut: any): boolean;
  export function looksLikeFinalToolResult(update: any): boolean;
  export function resolveToolUpdateStatus(
    update: any,
    previousStatus?: string | null,
  ): string;
  export function finalizeOpenTools(items: any[], status?: string): any[];
  export function applySessionUpdate(items: any[], params: any): any[];
  export function formatOptionLabel(
    optionId: string,
    name?: string,
  ): string;
}

declare module "../../shared/usage.mjs" {
  export type SessionUsage = {
    turns: number;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    lastContextTokens: number;
    cachedReadTokens: number;
    reasoningTokens: number;
    modelCalls: number;
    costUsdTicks: number;
    lastModel?: string;
  };
  export function emptyUsage(): SessionUsage;
  export function applyUsageUpdate(
    prev: SessionUsage,
    params: any,
  ): SessionUsage;
  export function formatTokens(n: number): string;
  export function formatCostUsd(ticks: number): string | null;
  export function formatUsageBar(u: SessionUsage): string;
  export function formatUsageTooltip(u: SessionUsage): string;
}

export type PermissionOutcome = {
  outcome: {
    outcome: "selected" | "cancelled";
    optionId?: string;
  };
};

export type PromptImage = {
  data: string;
  mimeType: string;
};

export type TimelineImage = {
  mimeType: string;
  previewUrl: string;
};

export type TimelineItem =
  | {
      id: string;
      kind: "user";
      text: string;
      images?: TimelineImage[];
      /** Set when UI inserts the bubble before ACP echoes it */
      optimistic?: boolean;
      at: number;
    }
  | { id: string; kind: "assistant"; text: string; at: number }
  | { id: string; kind: "thought"; text: string; at: number }
  | {
      id: string;
      kind: "tool";
      toolCallId: string;
      title: string;
      status: string;
      raw?: unknown;
      content?: unknown;
      at: number;
    }
  | { id: string; kind: "plan"; entries: unknown[]; at: number }
  | { id: string; kind: "system"; text: string; at: number };

export type PermissionRequest = {
  reqId: string;
  params: {
    sessionId?: string;
    toolCall?: {
      toolCallId?: string;
      title?: string;
      kind?: string;
      status?: string;
      rawInput?: unknown;
    };
    options?: Array<{ optionId: string; name: string; kind?: string }>;
  };
};

export type LoginProgress = {
  output?: string;
  url?: string | null;
  urls?: string[];
  userCode?: string | null;
  needsPaste?: boolean;
  deviceAuth?: boolean;
};

export type AuthStatus = {
  binary: string;
  binaryFound: boolean;
  grokHome: string;
  authPath: string;
  authenticated: boolean;
  method: string | null;
  email: string | null;
  displayName: string | null;
  expiresAt: string | null;
  expired: boolean;
  hasApiKey: boolean;
  loginInProgress: boolean;
};

export type GrokEngineInfo = {
  binary: string;
  binaryFound: boolean;
  version: string | null;
  error?: string;
};

export type GrokUpdateCheck = {
  ok: boolean;
  updateAvailable: boolean;
  currentVersion: string | null;
  latestVersion: string | null;
  channel?: string | null;
  error?: string | null;
};

export type GrokUpdateInstall = {
  ok: boolean;
  stdout?: string;
  stderr?: string;
  error?: string | null;
};

/** Sanitized MCP row — env/header *values* never cross IPC. */
export type McpServerInfo = {
  name: string;
  displayName?: string | null;
  transport?: string | null;
  enabled?: boolean | null;
  scope?: string | null;
  command?: string | null;
  args?: string[];
  url?: string | null;
  envKeys?: string[];
  headerKeys?: string[];
  source?: string | null;
  /** True when ~/.grok/mcp_credentials.json has a token for this name. */
  signedIn?: boolean;
  /** Live TUI /mcps status: ready | initializing | unavailable | needs-auth | setup-required */
  liveStatus?:
    | "ready"
    | "initializing"
    | "unavailable"
    | "needs-auth"
    | "setup-required"
    | null;
  authRequired?: boolean;
  liveToolCount?: number | null;
};

export type McpAddSpec = {
  name: string;
  transport: "stdio" | "http" | "sse";
  command?: string;
  args?: string[];
  url?: string;
  env?: Array<{ key: string; value: string }>;
  headers?: Array<{ name: string; value: string }>;
  scope?: "user" | "project";
};

export type McpListResult = {
  ok: boolean;
  servers: McpServerInfo[];
  source?: "list" | "inspect";
  error?: string | null;
  liveOk?: boolean;
};

export type McpWriteResult = {
  ok: boolean;
  stdout?: string;
  stderr?: string;
  error?: string | null;
};

export type McpDoctorCheck = {
  label: string;
  passed: boolean;
  detail: string | null;
};

export type McpDoctorServer = {
  name: string;
  transport: string | null;
  target: string | null;
  source: string | null;
  healthy: boolean;
  checks: McpDoctorCheck[];
  tools: string[];
  toolCount: number | null;
  needsAuth: boolean;
};

export type McpAuthResult = {
  ok: boolean;
  status?: string;
  serverName?: string;
  error?: string | null;
};

export type McpDoctorResult = {
  ok: boolean;
  healthyCount: number;
  failingCount: number;
  servers: McpDoctorServer[];
  stdout?: string;
  stderr?: string;
  error?: string | null;
};

/** Sanitized plugin row from `grok plugin list --json` (no component inventory). */
export type PluginInfo = {
  name: string;
  enabled?: boolean | null;
  status?: string | null;
  version?: string | null;
  description?: string | null;
  marketplace?: string | null;
  source?: string | null;
  skillCount?: number | null;
  hasHooks?: boolean | null;
  hasAgents?: boolean | null;
  hasMcp?: boolean | null;
};

export type PluginListResult = {
  ok: boolean;
  plugins: PluginInfo[];
  source?: "list" | "inspect";
  error?: string | null;
};

export type PluginWriteResult = {
  ok: boolean;
  stdout?: string;
  stderr?: string;
  error?: string | null;
};

export type BackboneSummary = {
  ok: boolean;
  skills: Array<{ name: string; description?: string; source?: string }>;
  mcpServers: Array<{
    name: string;
    transport?: string;
    source?: string;
  }>;
  plugins: Array<{ name: string }>;
  grokVersion?: string;
  error?: string;
};

export type SlashCommand = {
  name: string;
  description: string;
  source: "agent" | "skill" | "desktop";
  inputHint?: string;
  local?: boolean;
};

export type GitStatusEntry = {
  path: string;
  origPath: string | null;
  index: string;
  worktree: string;
  status: string;
  untracked: boolean;
  staged: boolean;
  unstaged: boolean;
};

export type SessionSummary = {
  id: string;
  cwd: string;
  title: string;
  summary: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  lastActiveAt: string | null;
  numMessages: number;
  numChatMessages: number;
  modelId: string | null;
};

export type AvailableModel = {
  modelId: string;
  name: string;
};

export type OpenProjectResult = {
  cwd: string;
  sessionId: string;
  grokBinary: string;
  resumed?: boolean;
  /** ACP model id for the live session (e.g. grok-4.6) */
  modelId?: string | null;
  /** Optional display name from the agent model list */
  modelName?: string | null;
  /** Models advertised on session/new|load — empty when the agent omits them */
  availableModels?: AvailableModel[];
  history?: TimelineItem[];
  /** Background commands/subagents restored from updates.jsonl */
  backgroundTasks?: Array<{
    id: string;
    kind: "command" | "subagent" | "monitor";
    title: string;
    detail?: string;
    status: "running" | "completed" | "failed" | "unknown";
    command?: string;
    outputFile?: string;
    exitCode?: number | null;
    startedAt: number;
    endedAt?: number;
    outputSnippet?: string;
    toolCallId?: string;
  }>;
  /** Summed turn_completed usage from updates.jsonl (status bar) */
  usage?: import("./lib/usage").SessionUsage | null;
  sessions?: SessionSummary[];
  /** Present when main already ran `grok inspect` (agent:restart). */
  backbone?: BackboneSummary;
};

export type AppInfo = {
  version: string;
  platform: string;
  grokBinary: string;
  grokHome: string;
  userData: string;
  alwaysApprove: boolean;
  /** ask | auto | always-approve */
  permissionMode: "ask" | "auto" | "always-approve";
  /** Reasoning effort (`/effort`): low | medium | high | xhigh */
  reasoningEffort: "low" | "medium" | "high" | "xhigh";
  /** When false (default), ACP fs + terminal cwd cannot leave project root */
  allowOutsideProject: boolean;
  /**
   * When true (default), ACP tool shells run in an OS FS jail
   * (Seatbelt / bwrap / WSL+bwrap / Docker).
   */
  sandboxTerminal: boolean;
  /** Human-readable backend probe for Settings */
  sandboxStatus: string;
  sandboxBackend: string;
  /** UI appearance */
  theme: "dark" | "light";
  /**
   * Display-only: redact $HOME → ~ in the UI (screenshots / demos).
   * Does not change agent paths or on-disk data.
   */
  privacyMode: boolean;
  /**
   * SpaceXAI coding-data share (CLI `/privacy`). Default true (opt in).
   * Stored as coding_data_retention_opt_out on ~/.grok/auth.json.
   */
  codingDataOptIn: boolean;
  codingDataStatus?: {
    optedIn: boolean;
    source: "auth" | "default" | "none";
    managed: boolean;
    note?: string;
  };
  /** Diagnostic JSONL log for tools/hooks/terminals */
  debugLogging: boolean;
  debugLogPath: string;
  /**
   * When true, Check for updates includes GitHub prereleases
   * (vX.Y.Z-beta.N). Default off.
   */
  allowPrerelease: boolean;
  /**
   * External editor for Files / Changes.
   * auto | cursor | code | code-insiders | zed | windsurf | subl | codium
   * | textedit | notepad
   */
  externalEditor: string;
  /** Call the agent compact API when last context size passes this mark. */
  autoCompactAt: "off" | "64k" | "128k" | "192k";
  recentProjects: string[];
  lastProject: string | null;
  home: string;
  auth: AuthStatus;
};

export type ExternalEditorInfo = {
  id: string;
  label: string;
  available: boolean;
  lastResort: boolean;
};

export type EditorListResult = {
  preferred: string;
  resolved: string | null;
  resolvedLabel: string | null;
  editors: ExternalEditorInfo[];
};

export type FileReadResult = {
  text: string;
  binary: boolean;
  truncated: boolean;
  size: number;
};

declare global {
  interface Window {
    grokDesktop: {
      getInfo: () => Promise<AppInfo>;
      pickProject: () => Promise<string | null>;
      openProject: (
        cwd: string,
        opts?: { mode?: "continue" | "new" | "resume"; sessionId?: string },
      ) => Promise<OpenProjectResult>;
      /** Drop agent on this window; native title returns to empty shell. */
      closeProject: () => Promise<boolean>;
      /** Respawn grok agent and resume the same chat. */
      restartAgent: () => Promise<OpenProjectResult>;
      listSessions: (cwd: string) => Promise<SessionSummary[]>;
      openSession: (opts: {
        cwd: string;
        sessionId?: string;
        mode?: "new" | "resume";
      }) => Promise<OpenProjectResult>;
      prompt: (
        text: string,
        opts?: {
          images?: PromptImage[];
          imageQuality?: "compact" | "high";
        },
      ) => Promise<unknown>;
      cancel: () => Promise<boolean>;
      compact: (hint?: string) => Promise<unknown>;
      respondPermission: (
        reqId: string,
        outcome: PermissionOutcome,
      ) => Promise<boolean>;
      setAllowWritesThisSession: (
        value: boolean,
      ) => Promise<{ allowWritesThisSession: boolean }>;
      /** Open Approvals still held in main (after HMR / reload) */
      listPendingPermissions: () => Promise<PermissionRequest[]>;
      respondPlanApproval: (
        reqId: string,
        decision: {
          type: "approved" | "request_changes" | "abandoned";
          feedback?: string;
        },
      ) => Promise<boolean>;
      respondUserQuestion: (
        reqId: string,
        decision:
          | { type: "answered"; answers: Record<string, string> }
          | { type: "declined" },
      ) => Promise<boolean>;
      setAlwaysApprove: (value: boolean) => Promise<boolean>;
      setPermissionMode: (
        value: "ask" | "auto" | "always-approve",
      ) => Promise<{
        mode: "ask" | "auto" | "always-approve";
        agentSynced: boolean;
        error?: string;
      }>;
      setReasoningEffort: (
        value: "low" | "medium" | "high" | "xhigh",
      ) => Promise<{
        effort: "low" | "medium" | "high" | "xhigh";
        agentSynced: boolean;
        error?: string;
      }>;
      setModel: (modelId: string) => Promise<{
        modelId: string | null;
        modelName: string | null;
        availableModels: AvailableModel[];
        agentSynced: boolean;
        error?: string;
      }>;
      setAllowOutsideProject: (value: boolean) => Promise<boolean>;
      setSandboxTerminal: (value: boolean) => Promise<boolean>;
      setTheme: (value: "dark" | "light") => Promise<"dark" | "light">;
      setPrivacyMode: (value: boolean) => Promise<boolean>;
      setAutoCompactAt: (
        value: "off" | "64k" | "128k" | "192k",
      ) => Promise<"off" | "64k" | "128k" | "192k">;
      getCodingDataStatus: () => Promise<{
        optedIn: boolean;
        source: "auth" | "default" | "none";
        managed: boolean;
        note?: string;
      }>;
      setCodingDataOptIn: (value: boolean) => Promise<{
        optedIn: boolean;
        source: "auth" | "default" | "none";
        managed: boolean;
        note?: string;
      }>;
      setAllowPrerelease: (value: boolean) => Promise<boolean>;
      setDebugLogging: (
        value: boolean,
      ) => Promise<{ debugLogging: boolean; debugLogPath: string }>;
      openDebugLog: () => Promise<string>;
      getGitBranch: (
        cwd?: string,
      ) => Promise<{ branch: string | null; detached: boolean }>;
      getGitStatus: (cwd?: string) => Promise<{ files: GitStatusEntry[] }>;
      getGitDiff: (
        path: string,
        opts?: { staged?: boolean },
      ) => Promise<{ path: string; staged: boolean; diff: string | null }>;
      readFile: (path: string) => Promise<FileReadResult>;
      writeFile: (
        path: string,
        content: string,
      ) => Promise<{ ok: true }>;
      listDir: (
        path: string,
      ) => Promise<Array<{ name: string; isDirectory: boolean; path: string }>>;
      openPath: (
        path: string,
      ) => Promise<{ ok: boolean; editor?: string; label?: string }>;
      openInEditor: (
        path: string,
      ) => Promise<{ ok: boolean; editor?: string; label?: string }>;
      listEditors: () => Promise<EditorListResult>;
      setExternalEditor: (id: string) => Promise<EditorListResult>;
      showItem: (path: string) => Promise<void>;
      openExternal: (url: string) => Promise<boolean>;
      openPreview: (url?: string) => Promise<{
        open: boolean;
        url: string;
        title: string;
        viewport: string;
        loading: boolean;
      }>;
      closePreview: () => Promise<boolean>;
      previewState: () => Promise<{
        open: boolean;
        url: string;
        title: string;
        viewport: string;
        loading: boolean;
      }>;
      previewSnapshot: () => Promise<{
        text: string;
        url: string;
        title: string;
        chars: number;
      }>;
      getAuthStatus: () => Promise<AuthStatus>;
      login: (opts?: {
        deviceAuth?: boolean;
      }) => Promise<{
        ok: boolean;
        status?: AuthStatus;
        error?: string;
        output?: string;
      }>;
      cancelLogin: () => Promise<AuthStatus>;
      submitLoginInput: (
        text: string,
      ) => Promise<{ ok: boolean; error?: string }>;
      logout: () => Promise<{
        ok: boolean;
        status?: AuthStatus;
        message?: string;
      }>;
      setApiKey: (
        key: string,
      ) => Promise<{ ok: boolean; status: AuthStatus }>;
      openInstallDocs: () => Promise<boolean>;
      inspectBackbone: (cwd?: string) => Promise<BackboneSummary>;
      getGrokEngine: () => Promise<GrokEngineInfo>;
      checkGrokUpdate: () => Promise<GrokUpdateCheck>;
      installGrokUpdate: () => Promise<GrokUpdateInstall>;
      listMcpServers: (opts?: { cache?: boolean }) => Promise<McpListResult>;
      addMcpServer: (spec: McpAddSpec) => Promise<McpWriteResult>;
      enableMcpServer: (name: string) => Promise<McpWriteResult>;
      disableMcpServer: (name: string) => Promise<McpWriteResult>;
      removeMcpServer: (
        name: string,
        opts?: { scope?: "user" | "project" },
      ) => Promise<McpWriteResult>;
      doctorMcp: (name?: string) => Promise<McpDoctorResult>;
      authenticateMcpServer: (name: string) => Promise<McpAuthResult>;
      listPlugins: () => Promise<PluginListResult>;
      enablePlugin: (name: string) => Promise<PluginWriteResult>;
      disablePlugin: (name: string) => Promise<PluginWriteResult>;
      installPlugin: (source: string) => Promise<PluginWriteResult>;
      on: (channel: string, handler: (payload: any) => void) => () => void;
    };
  }
}

export {};
