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
