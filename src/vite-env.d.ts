/// <reference types="vite/client" />

export type PermissionOutcome = {
  outcome: {
    outcome: "selected" | "cancelled";
    optionId?: string;
  };
};

export type TimelineItem =
  | { id: string; kind: "user"; text: string; at: number }
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

declare global {
  interface Window {
    grokDesktop: {
      getInfo: () => Promise<{
        version: string;
        platform: string;
        grokBinary: string;
        userData: string;
        alwaysApprove: boolean;
        recentProjects: string[];
        lastProject: string | null;
        home: string;
      }>;
      pickProject: () => Promise<string | null>;
      openProject: (cwd: string) => Promise<{
        cwd: string;
        sessionId: string;
        grokBinary: string;
      }>;
      prompt: (text: string) => Promise<unknown>;
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
      on: (channel: string, handler: (payload: any) => void) => () => void;
    };
  }
}

export {};
