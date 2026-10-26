import { classifyPermissionOption } from "../../shared/permission-options.mjs";

type TFn = (key: string, vars?: Record<string, string | number>) => string;

/** Localize an ACP permission option. Class is the contract; unknown names stay raw. */
export function localizeOptionLabel(
  optionId: string | undefined,
  name: string | undefined,
  t: TFn,
  kind?: string,
): string {
  const raw = String(name || "").trim();
  // Command text after the prefix is not a catalog string.
  const never = raw.match(/^never allow:?\s*(.+)$/i);
  if (never) return t("perm.neverAllow", { name: never[1].trim() });

  // Ids only. A name that merely contains "cancel" stays on the class below.
  if (optionId === "cancel" || optionId === "cancelled") {
    return t("perm.cancel");
  }

  switch (classifyPermissionOption({ optionId, name, kind })) {
    case "enable_always_approve":
      return t("perm.alwaysApprove");
    case "allow_always":
      return t("perm.allowAlways");
    case "allow_once":
      return t("perm.allowOnce");
    case "reject":
      return t("perm.reject");
    default:
      return raw || String(optionId || "");
  }
}
