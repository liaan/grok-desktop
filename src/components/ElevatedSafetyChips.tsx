import { type PermissionMode } from "../lib/permission-mode";
import { useI18n } from "../lib/i18n";

/**
 * Persistent topbar indicators when elevated / reduced-safety modes are on.
 * Click opens Settings so the operator can turn them off.
 */
export function ElevatedSafetyChips({
  sandboxTerminal,
  allowOutsideProject,
  permissionMode,
  privacyMode = false,
  allowWritesThisSession = false,
  onRevokeWritesThisSession,
  onOpenSettings,
}: {
  sandboxTerminal: boolean;
  allowOutsideProject: boolean;
  permissionMode: PermissionMode;
  privacyMode?: boolean;
  allowWritesThisSession?: boolean;
  onRevokeWritesThisSession?: () => void;
  onOpenSettings: () => void;
}) {
  const elevatedPerms = permissionMode !== "ask";
  const { t } = useI18n();
  const permChipKey: Record<PermissionMode, string> = {
    ask: "topbar.ask",
    auto: "topbar.auto",
    "always-approve": "topbar.always",
  };
  const show =
    !sandboxTerminal ||
    allowOutsideProject ||
    elevatedPerms ||
    privacyMode ||
    allowWritesThisSession;
  if (!show) return null;

  return (
    <div className="elevated-chips" aria-label={t("chips.aria")}>
      {privacyMode && (
        <button
          type="button"
          className="elevated-chip privacy"
          title={t("chips.privacyTitle")}
          onClick={onOpenSettings}
        >
          {t("chips.privacy")}
        </button>
      )}
      {!sandboxTerminal && (
        <button
          type="button"
          className="elevated-chip warn"
          title={t("chips.hostShellTitle")}
          onClick={onOpenSettings}
        >
          {t("chips.hostShell")}
        </button>
      )}
      {allowOutsideProject && (
        <button
          type="button"
          className="elevated-chip warn"
          title={t("chips.outsideTitle")}
          onClick={onOpenSettings}
        >
          {t("chips.outside")}
        </button>
      )}
      {elevatedPerms && (
        <button
          type="button"
          className={`elevated-chip ${permissionMode === "always-approve" ? "warn" : ""}`}
          title={t("chips.permTitle")}
          onClick={onOpenSettings}
        >
          {t(permChipKey[permissionMode])}
        </button>
      )}
      {allowWritesThisSession && (
        <button
          type="button"
          className="elevated-chip warn"
          title={t("chips.writesTitle")}
          onClick={() => onRevokeWritesThisSession?.()}
        >
          {t("chips.writes")}
        </button>
      )}
    </div>
  );
}
