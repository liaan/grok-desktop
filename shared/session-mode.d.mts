export const PLAN_MODE_ID: "plan";
export const DEFAULT_SESSION_MODE_ID: "default";
export const ALREADY_IN_PLAN_NOTICE: string;
export const PLAN_MODE_ON_NOTICE: string;

export function isPlanMode(modeId: unknown): boolean;

export function setSessionModeParams(
  sessionId: string,
  modeId: string,
): { sessionId: string; modeId: string };

export function rememberSessionMode(session: unknown): string | null;

export function currentModeIdFromUpdate(
  params: unknown,
): string | null | undefined;

export function planSlashAction(
  args?: string,
  opts?: { alreadyInPlan?: boolean },
):
  | { type: "already-in-plan"; modeId?: undefined; text?: undefined }
  | { type: "set-mode"; modeId: string; text?: undefined }
  | { type: "set-mode-then-prompt"; modeId: string; text: string };
