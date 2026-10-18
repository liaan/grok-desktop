import { classifyOptionId } from "../../shared/permission-options.mjs";

type TFn = (key: string, vars?: Record<string, string | number>) => string;

/**
 * Localize an ACP permission option label.
 *
 * The Grok agent sends English option names (e.g. "Yes, proceed",
 * "Never allow: git config ..."). We map the common shapes onto the UI
 * catalog and fall back to the raw name when we do not recognise it, so an
 * unfamiliar backend label still renders instead of disappearing.
 */
export function localizeOptionLabel(
  optionId: string | undefined,
  name: string | undefined,
  t: TFn,
): string {
  const raw = String(name || "").trim();

  if (raw) {
    // "Never allow: <command>" — keep the command, translate the prefix.
    const never = raw.match(/^never allow:?\s*(.+)$/i);
    if (never) return t("perm.neverAllow", { name: never[1] });

    if (/don'?t ask again|always[- ]approve|ask me again/i.test(raw)) {
      return t("perm.alwaysApprove");
    }
    if (/^allow (this )?once\b|^allow this\b|^once\b/i.test(raw)) {
      return t("perm.allowOnce");
    }
    if (/^always allow\b/i.test(raw)) {
      return t("perm.allowAlways");
    }
    if (/for (this )?session|this session|remember/i.test(raw)) {
      return t("perm.allowSession");
    }
    if (/^(yes|proceed|continue|allow|approve|accept|ok)\b/i.test(raw)) {
      return t("perm.yesProceed");
    }
    if (/^(cancel)\b/i.test(raw)) {
      return t("perm.cancel");
    }
    if (/^(no|nope|reject|deny)\b/i.test(raw) || /tell grok|do differently/i.test(raw)) {
      return t("perm.noTell");
    }
  }

  switch (classifyOptionId(optionId, undefined)) {
    case "enable_always_approve":
      return t("perm.alwaysApprove");
    case "allow_always":
      return t("perm.allowAlways");
    case "allow_once":
      return t("perm.yesProceed");
    case "reject":
      return optionId === "cancelled" || optionId === "cancel"
        ? t("perm.cancel")
        : t("perm.reject");
    default:
      return raw || String(optionId || "");
  }
}
