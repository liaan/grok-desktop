export type PermOption = {
  optionId?: string;
  name?: string;
  kind?: string;
};

export type OptionClass =
  | "reject"
  | "allow_once"
  | "allow_always"
  | "enable_always_approve"
  | "unknown";

export const ENABLE_ALWAYS_APPROVE_OPTION_ID: "enable-always-approve";

export function isEnableAlwaysApproveOption(id: string): boolean;

export function classifyPermissionOption(
  opt?: PermOption | null,
): OptionClass;

export function classifyOptionId(
  optionId: string | null | undefined,
  options?: PermOption[] | null,
): OptionClass;

export function pickAllowOptionId(
  options?: PermOption[] | null,
  opts?: { allowAlwaysOk?: boolean },
): string;

export function pickAllowOnceOptionId(
  options?: PermOption[] | null,
): string | null;

export function selectedPermissionResult(optionId?: string): {
  outcome: { outcome: "selected"; optionId: string };
};

export function cancelledPermissionResult(): {
  outcome: { outcome: "cancelled" };
};

export function permissionOutcomeFromUi(
  optionId: string | "cancelled",
  options?: PermOption[] | null,
  opts?: { batchOnce?: boolean },
):
  | { outcome: { outcome: "selected"; optionId: string } }
  | { outcome: { outcome: "cancelled" } }
  | null;

export function permissionButtonClass(
  cls: OptionClass,
  opts?: { size?: "sm" },
): string;

export function extractToolCallId(toolOrParams: unknown): string | null;
