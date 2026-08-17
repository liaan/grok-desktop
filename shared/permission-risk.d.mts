export type PermissionRisk = "safe" | "write";

export type PermissionAutoDecision =
  | { allow: true; allowAlwaysOk: boolean }
  | { allow: false };

export function permissionToolBits(params: unknown): {
  title: string;
  kind: string;
  name: string;
  command: string;
  blob: string;
  raw: unknown;
};

export function classifyPermissionRisk(params: unknown): PermissionRisk;

export function permissionAutoDecision(
  params: unknown,
  ctx?: {
    permissionMode?: string;
    allowWritesThisSession?: boolean;
  },
): PermissionAutoDecision;

export function shouldAutoAllowPermission(
  params: unknown,
  ctx?: {
    permissionMode?: string;
    allowWritesThisSession?: boolean;
  },
): boolean;

export function outcomeForAutoDecision(
  params: unknown,
  decision: PermissionAutoDecision,
): { outcome: { outcome: "selected"; optionId: string } } | null;
