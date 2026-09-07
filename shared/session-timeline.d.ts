export function uid(prefix?: string): string;

export function isAskUserQuestionTool(value: unknown): boolean;

export function isOpenToolStatus(status: unknown): boolean;

export function isTerminalToolStatus(status: unknown): boolean;

export function isBashBackgroundedRawOutput(rawOut: any): boolean;

export function looksLikeFinalToolResult(update: any): boolean;

export function resolveToolUpdateStatus(
  update: any,
  previousStatus?: string | null,
): string;

export function displayUserMessageText(raw: unknown): string;

export function finalizeOpenTools(items: any[], status?: string): any[];

export function appendUserMessage(
  items: any[],
  payload?: {
    text?: string;
    images?: any[];
    optimistic?: boolean;
    at?: number;
    id?: string;
    interjectionId?: string;
    queued?: boolean;
    queueId?: string;
  },
): any[];

export function claimQueuedUserMessage(
  items: any[],
  queueId: string,
  extra?: { interjectionId?: string },
): any[];

export function restoreQueuedUserMessage(items: any[], queueId: string): any[];

export function removeQueuedUserMessage(items: any[], queueId: string): any[];

export function removeUserInterjection(
  items: any[],
  interjectionId: string,
): any[];

export function shouldApplySessionInterjection(
  payload?: { sessionId?: string } | null,
  opts?: { opening?: boolean; sessionId?: string | null },
): boolean;

export function applySessionInterjection(
  items: any[],
  payload?: { text?: string; interjectionId?: string },
): any[];

export function applySessionUpdate(items: any[], params: any): any[];

export function formatOptionLabel(
  optionId: string,
  name?: string,
): string;
