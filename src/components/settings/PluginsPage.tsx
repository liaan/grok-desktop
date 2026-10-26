import { useEffect, useRef, useState } from "react";
import type { PluginInfo } from "../../vite-env";
import { useI18n } from "../../lib/i18n";

function pluginRowDetail(p: PluginInfo, t: (key: string) => string): string {
  const bits = [
    p.enabled === false ? t("plugins.disabled") : p.enabled === true ? t("plugins.enabled") : null,
    p.version || null,
    p.marketplace || p.source || null,
    p.skillCount != null ? `${p.skillCount} skills` : null,
    p.hasHooks ? "hooks" : null,
    p.hasAgents ? "agents" : null,
    p.hasMcp ? "MCP" : null,
    p.description || null,
  ].filter(Boolean);
  return bits.join(" · ");
}

export function PluginsPage({
  open,
  restarting,
  focus,
  onRestartAfterWrite,
}: {
  open: boolean;
  restarting: boolean;
  focus: boolean;
  onRestartAfterWrite?: () => Promise<void> | void;
}) {
  const sectionRef = useRef<HTMLElement>(null);
  const [plugins, setPlugins] = useState<PluginInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [source, setSource] = useState("");
  const { t } = useI18n();

  const locked = busy || restarting;

  const reload = async () => {
    const res = await window.grokDesktop.listPlugins();
    setPlugins(res.plugins || []);
    if (!res.ok && res.error) setNote(res.error);
    return res;
  };

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setNote(null);
    setLoading(true);
    void reload()
      .catch((e: unknown) => {
        if (!cancelled) {
          setNote(e instanceof Error ? e.message : String(e));
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  useEffect(() => {
    if (open && focus) {
      sectionRef.current?.scrollIntoView({ block: "start" });
    }
  }, [open, focus]);

  const afterWrite = async (ok: boolean, error?: string | null) => {
    if (!ok) {
      setNote(error || t("plugins.cmdFailed"));
      return;
    }
    setNote(null);
    if (onRestartAfterWrite) {
      await onRestartAfterWrite();
    }
    await reload();
  };

  const onToggle = async (p: PluginInfo) => {
    setBusy(true);
    setNote(null);
    try {
      const res =
        p.enabled === false
          ? await window.grokDesktop.enablePlugin(p.name)
          : await window.grokDesktop.disablePlugin(p.name);
      await afterWrite(res.ok, res.error);
    } catch (e: unknown) {
      setNote(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const onInstall = async () => {
    const trimmed = source.trim();
    if (!trimmed) {
      setNote(t("plugins.sourceRequired"));
      return;
    }
    if (!window.confirm(t("plugins.installConfirm", { source: trimmed }))) {
      return;
    }
    setBusy(true);
    setNote(null);
    try {
      const res = await window.grokDesktop.installPlugin(trimmed);
      await afterWrite(res.ok, res.error);
      if (res.ok) setSource("");
    } catch (e: unknown) {
      setNote(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="settings-section" ref={sectionRef} id="settings-plugins">
      <h3>{t("nav.plugins")}</h3>
      <p className="settings-desc settings-lead">{t("plugins.lead")}</p>
      {loading ? <p className="settings-desc">{t("plugins.loading")}</p> : null}
      {!loading && plugins.length === 0 ? (
        <p className="settings-desc">{t("plugins.none")}</p>
      ) : null}
      {plugins.map((p) => (
        <div className="settings-row mcp-row" key={p.name}>
          <div className="settings-row-text">
            <span className="settings-label">{p.name}</span>
            <span className="settings-desc">{pluginRowDetail(p, t)}</span>
          </div>
          <div className="mcp-actions">
            <button
              type="button"
              className="btn btn-sm"
              disabled={locked}
              onClick={() => void onToggle(p)}
            >
              {p.enabled === false ? t("plugins.enable") : t("plugins.disable")}
            </button>
          </div>
        </div>
      ))}

      <div className="mcp-add">
        <span className="settings-label">{t("plugins.installFromGit")}</span>
        <label className="mcp-field">
          <span>{t("plugins.source")}</span>
          <input
            className="settings-input"
            value={source}
            onChange={(e) => setSource(e.target.value)}
            placeholder="owner/repo or https://github.com/org/plugin.git"
            autoComplete="off"
            disabled={locked}
          />
        </label>
        <div className="mcp-actions">
          <button
            type="button"
            className="btn"
            disabled={locked || !source.trim()}
            onClick={() => void onInstall()}
          >
            {restarting ? t("plugins.restarting") : busy ? t("plugins.working") : t("plugins.install")}
          </button>
        </div>
      </div>
      {note ? <span className="settings-desc settings-note">{note}</span> : null}
    </section>
  );
}
