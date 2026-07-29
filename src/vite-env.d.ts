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

export type OpenProjectResult = {
  cwd: string;
  sessionId: string;
  grokBinary: string;
  resumed?: boolean;
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
  /** Diagnostic JSONL log for tools/hooks/terminals */
  debugLogging: boolean;
  debugLogPath: string;
  recentProjects: string[];
  lastProject: string | null;
  home: string;
  auth: AuthStatus;
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
      listSessions: (cwd: string) => Promise<SessionSummary[]>;
      openSession: (opts: {
        cwd: string;
        sessionId?: string;
        mode?: "new" | "resume";
      }) => Promise<OpenProjectResult>;
      prompt: (
        text: string,
        opts?: { images?: PromptImage[] },
      ) => Promise<unknown>;
      cancel: () => Promise<boolean>;
      respondPermission: (
        reqId: string,
        outcome: PermissionOutcome,
      ) => Promise<boolean>;
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
      setAllowOutsideProject: (value: boolean) => Promise<boolean>;
      setSandboxTerminal: (value: boolean) => Promise<boolean>;
      setTheme: (value: "dark" | "light") => Promise<"dark" | "light">;
      setPrivacyMode: (value: boolean) => Promise<boolean>;
      setDebugLogging: (
        value: boolean,
      ) => Promise<{ debugLogging: boolean; debugLogPath: string }>;
      openDebugLog: () => Promise<string>;
      getGitBranch: (
        cwd?: string,
      ) => Promise<{ branch: string | null; detached: boolean }>;
      readFile: (path: string) => Promise<string>;
      listDir: (
        path: string,
      ) => Promise<Array<{ name: string; isDirectory: boolean; path: string }>>;
      openPath: (path: string) => Promise<string>;
      showItem: (path: string) => Promise<void>;
      openExternal: (url: string) => Promise<boolean>;
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
      on: (channel: string, handler: (payload: any) => void) => () => void;
    };
  }
}

export {};
