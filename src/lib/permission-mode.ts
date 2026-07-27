/** Desktop tool-permission modes (mirrors electron/permission-mode.mjs). */

export type PermissionMode = "ask" | "auto" | "always-approve";

export const PERMISSION_MODE_OPTIONS: Array<{
  value: PermissionMode;
  label: string;
  description: string;
}> = [
  {
    value: "ask",
    label: "Ask (manual)",
    description:
      "Every tool that needs permission shows in the Approvals panel.",
  },
  {
    value: "auto",
    label: "Auto",
    description:
      "Agent auto-allows routine safe work; escalations still appear in Approvals.",
  },
  {
    value: "always-approve",
    label: "Always approve",
    description:
      "Skip tool approval prompts. Deny rules and plan-mode edit gates still apply.",
  },
];

export function normalizePermissionMode(
  value: unknown,
  legacyAlwaysApprove = false,
): PermissionMode {
  const v = String(value ?? "")
    .toLowerCase()
    .trim()
    .replace(/_/g, "-");
  if (v === "ask" || v === "default" || v === "manual") return "ask";
  if (v === "auto") return "auto";
  if (
    v === "always-approve" ||
    v === "alwaysapprove" ||
    v === "bypasspermissions" ||
    v === "bypass-permissions" ||
    v === "yolo"
  ) {
    return "always-approve";
  }
  if (legacyAlwaysApprove) return "always-approve";
  return "ask";
}

export function permissionModeChipLabel(mode: PermissionMode): string {
  if (mode === "always-approve") return "Always approve";
  if (mode === "auto") return "Auto";
  return "Ask";
}
