import {
  PERMISSION_MODE_OPTIONS,
  type PermissionMode,
} from "../../lib/permission-mode";
import { useI18n } from "../../lib/i18n";

export function SafetyPage({
  permissionMode,
  sandboxTerminal,
  sandboxStatus,
  allowOutsideProject,
  onSetPermissionMode,
  onSetSandboxTerminal,
  onToggleAllowOutside,
}: {
  permissionMode: PermissionMode;
  sandboxTerminal: boolean;
  sandboxStatus: string;
  allowOutsideProject: boolean;
  onSetPermissionMode: (mode: PermissionMode) => void;
  onSetSandboxTerminal: (next: boolean) => void;
  onToggleAllowOutside: () => void;
}) {
  const { t } = useI18n();
  const permKey: Record<PermissionMode, string> = {
    ask: "perm.ask",
    auto: "perm.auto",
    "always-approve": "perm.always",
  };
  const descKey: Record<PermissionMode, string> = {
    ask: "safety.descAsk",
    auto: "safety.descAuto",
    "always-approve": "safety.descAlways",
  };

  return (
    <section className="settings-section">
      <label className="settings-row settings-row-stack">
        <div className="settings-row-text">
          <span className="settings-label">{t("safety.mode")}</span>
          <span className="settings-desc">{t(descKey[permissionMode])}</span>
        </div>
        <select
          className="settings-select"
          value={permissionMode}
          aria-label={t("safety.mode")}
          onChange={(e) =>
            onSetPermissionMode(e.target.value as PermissionMode)
          }
        >
          {PERMISSION_MODE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {t(permKey[o.value])}
            </option>
          ))}
        </select>
      </label>

      <label className="settings-row">
        <div className="settings-row-text">
          <span className="settings-label">{t("safety.sandbox")}</span>
          <span className="settings-desc">
            {t("safety.sandboxDesc", { status: sandboxStatus || "…" })}
          </span>
        </div>
        <input
          type="checkbox"
          checked={sandboxTerminal}
          onChange={(e) => onSetSandboxTerminal(e.target.checked)}
        />
      </label>
      <label className="settings-row">
        <div className="settings-row-text">
          <span className="settings-label">{t("safety.outside")}</span>
          <span className="settings-desc">{t("safety.outsideDesc")}</span>
        </div>
        <input
          type="checkbox"
          checked={allowOutsideProject}
          onChange={onToggleAllowOutside}
        />
      </label>
    </section>
  );
}
