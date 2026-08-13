export function UpdatesPage({
  allowPrerelease,
  onSetAllowPrerelease,
}: {
  allowPrerelease: boolean;
  onSetAllowPrerelease: (next: boolean) => void;
}) {
  return (
    <section className="settings-section">
      <label className="settings-row">
        <div className="settings-row-text">
          <span className="settings-label">Preview updates</span>
          <span className="settings-desc">
            Off (default) stays on the last stable installer. On,{" "}
            <strong>Help → Check for updates</strong> can install prerelease
            builds (tags like v0.1.41-beta.1). Testers only — preview may be
            rougher. Turning this off does not uninstall a preview you already
            have; wait for the next stable or reinstall from Releases → latest.
          </span>
        </div>
        <input
          type="checkbox"
          checked={allowPrerelease}
          onChange={(e) => onSetAllowPrerelease(e.target.checked)}
        />
      </label>
    </section>
  );
}
