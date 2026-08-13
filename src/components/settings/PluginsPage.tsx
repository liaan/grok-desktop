import { useEffect, useRef, useState } from "react";
import type { PluginInfo } from "../../vite-env";

function pluginRowDetail(p: PluginInfo): string {
  const bits = [
    p.enabled === false ? "disabled" : p.enabled === true ? "enabled" : null,
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
      setNote(error || "Plugin command failed.");
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
      setNote("Git URL or owner/repo is required.");
      return;
    }
    if (
      !window.confirm(
        `Install plugin from “${trimmed}”?\n\nThis runs grok plugin install --trust (does not edit config.toml in the app). Only install plugins from sources you trust.`,
      )
    ) {
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
      <h3>Plugins</h3>
      <p className="settings-desc settings-lead">
        Same as <code>grok plugin</code> — enable, disable, or install from a
        git URL. Desktop never edits <code>config.toml</code>. Writes restart
        the agent so skills from the plugin show up in <code>/</code>.
      </p>
      {loading ? <p className="settings-desc">Loading plugins…</p> : null}
      {!loading && plugins.length === 0 ? (
        <p className="settings-desc">
          No plugins installed. Paste a git URL below — no terminal.
        </p>
      ) : null}
      {plugins.map((p) => (
        <div className="settings-row mcp-row" key={p.name}>
          <div className="settings-row-text">
            <span className="settings-label">{p.name}</span>
            <span className="settings-desc">{pluginRowDetail(p)}</span>
          </div>
          <div className="mcp-actions">
            <button
              type="button"
              className="btn btn-sm"
              disabled={locked}
              onClick={() => void onToggle(p)}
            >
              {p.enabled === false ? "Enable" : "Disable"}
            </button>
          </div>
        </div>
      ))}

      <div className="mcp-add">
        <span className="settings-label">Install from git URL</span>
        <label className="mcp-field">
          <span>Source</span>
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
            {restarting ? "Restarting…" : busy ? "Working…" : "Install"}
          </button>
        </div>
      </div>
      {note ? <span className="settings-desc settings-note">{note}</span> : null}
    </section>
  );
}
