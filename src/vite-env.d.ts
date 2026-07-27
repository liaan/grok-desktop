/// <reference types="vite/client" />

declare module "../../shared/session-timeline.mjs" {
  export function uid(prefix?: string): string;
  export function applySessionUpdate(items: any[], params: any): any[];
  export function formatOptionLabel(
    optionId: string,
    name?: string,
  ): string;
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
  sessions?: SessionSummary[];
};

export type AppInfo = {
  version: string;
  platform: string;
  grokBinary: string;
  grokHome: string;
  userData: string;
  alwaysApprove: boolean;
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
      setAlwaysApprove: (value: boolean) => Promise<boolean>;
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
