import { useEffect, useRef, useState } from "react";
import type {
  GrokEngineInfo,
  GrokUpdateCheck,
  McpServerInfo,
} from "../vite-env";
import {
  PERMISSION_MODE_OPTIONS,
  type PermissionMode,
} from "../lib/permission-mode";

/**
 * App settings modal — appearance + agent safety.
 * Keeps the sidebar footer free of checkbox clutter.
 */
export function SettingsDialog({
  open,
  onClose,
  theme,
  privacyMode,
  codingDataOptIn,
  codingDataNote,
  permissionMode,
  allowOutsideProject,
  sandboxTerminal,
  sandboxStatus,
  debugLogging,
  debugLogPath,
  onSetTheme,
  onSetPrivacyMode,
  onSetCodingDataOptIn,
  onSetPermissionMode,
  onToggleAllowOutside,
  onSetSandboxTerminal,
  onSetDebugLogging,
  onOpenDebugLog,
  onRestartAgent,
  onRestartAfterMcpWrite,
  restarting,
  offerRestart,
  grokBinary,
  hasProject,
  focusSection,
}: {
  open: boolean;
  onClose: () => void;
  theme: "dark" | "light";
  privacyMode: boolean;
  /** SpaceXAI coding-data share (default opt-in). */
  codingDataOptIn: boolean;
  codingDataNote?: string;
  permissionMode: PermissionMode;
  allowOutsideProject: boolean;
  sandboxTerminal: boolean;
  sandboxStatus: string;
  debugLogging: boolean;
  debugLogPath: string;
  onSetTheme: (theme: "dark" | "light") => void;
  onSetPrivacyMode: (next: boolean) => void;
  onSetCodingDataOptIn: (next: boolean) => void;
  onSetPermissionMode: (mode: PermissionMode) => void;
  onToggleAllowOutside: () => void;
  /** Desired checked state from the checkbox (not a toggle). */
  onSetSandboxTerminal: (next: boolean) => void;
  onSetDebugLogging: (next: boolean) => void;
  onOpenDebugLog: () => void;
  onRestartAgent: () => void;
  /** Restart without closing Settings (MCP writes). */
  onRestartAfterMcpWrite?: () => Promise<void> | void;
  restarting?: boolean;
  /** Highlight restart after coding-data (or other spawn-bound) changes. */
  offerRestart?: boolean;
  grokBinary?: string;
  hasProject?: boolean;
  focusSection?: "mcp" | null;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const [engine, setEngine] = useState<GrokEngineInfo | null>(null);
  const [engineBusy, setEngineBusy] = useState(false);
  const [updateNote, setUpdateNote] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setUpdateNote(null);
    void window.grokDesktop.getGrokEngine().then((info) => {
      if (!cancelled) setEngine(info);
    });
    return () => {
      cancelled = true;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const modeMeta =
    PERMISSION_MODE_OPTIONS.find((o) => o.value === permissionMode) ||
    PERMISSION_MODE_OPTIONS[0];

  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="modal-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
      >
        <div className="modal-header">
          <h2 id="settings-title">Settings</h2>
          <button
            ref={closeRef}
            type="button"
            className="btn ghost btn-sm"
            onClick={onClose}
            aria-label="Close settings"
          >
            ✕
          </button>
        </div>

        <div className="modal-body">
          <section className="settings-section">
            <h3>Engine</h3>
            <div className="settings-row settings-row-stack">
              <div className="settings-row-text">
                <span className="settings-label">Grok CLI</span>
                <span className="settings-desc">
                  Path:{" "}
                  <code
                    className="settings-path"
                    title={engine?.binary || grokBinary || ""}
                  >
                    {engine?.binary || grokBinary || "…"}
                  </code>
                </span>
                <span className="settings-desc">
                  Version:{" "}
                  {engine == null
                    ? "…"
                    : engine.binaryFound
                      ? engine.version || engine.error || "unknown"
                      : "not found"}
                </span>
                {updateNote ? (
                  <span className="settings-desc settings-note">{updateNote}</span>
                ) : null}
              </div>
              <button
                type="button"
                className="btn"
                disabled={engineBusy || !engine?.binaryFound}
                onClick={() => {
                  void (async () => {
                    setEngineBusy(true);
                    setUpdateNote(null);
                    try {
                      const check: GrokUpdateCheck =
                        await window.grokDesktop.checkGrokUpdate();
                      if (!check.ok) {
                        setUpdateNote(
                          check.error || "Could not check for CLI updates.",
                        );
                        return;
                      }
                      if (!check.updateAvailable) {
                        setUpdateNote(
                          check.currentVersion
                            ? `Grok ${check.currentVersion} is up to date.`
                            : "Grok CLI is up to date.",
                        );
                        return;
                      }
                      const from = check.currentVersion || "current";
                      const to = check.latestVersion || "latest";
                      if (
                        !window.confirm(
                          `Install Grok CLI ${to}?\n\nCurrent: ${from}\nDesktop will not auto-upgrade the engine.`,
                        )
                      ) {
                        setUpdateNote(
                          `Update available: ${from} → ${to}. Install cancelled.`,
                        );
                        return;
                      }
                      const installed = await window.grokDesktop.installGrokUpdate();
                      if (!installed.ok) {
                        setUpdateNote(
                          installed.error || "CLI update failed.",
                        );
                        return;
                      }
                      const next = await window.grokDesktop.getGrokEngine();
                      setEngine(next);
                      setUpdateNote(
                        `Installed Grok ${next.version || to}. Restart the agent to use it.`,
                      );
                    } catch (e: unknown) {
                      const msg = e instanceof Error ? e.message : String(e);
                      setUpdateNote(msg || "CLI update check failed.");
                    } finally {
                      setEngineBusy(false);
                    }
                  })();
                }}
              >
                {engineBusy ? "Working…" : "Check for CLI updates"}
              </button>
            </div>
          </section>

          <McpSettingsPanel
            open={open}
            restarting={Boolean(restarting)}
            hasProject={Boolean(hasProject)}
            focus={focusSection === "mcp"}
            onRestartAfterWrite={onRestartAfterMcpWrite}
          />

          <section className="settings-section">
            <h3>Appearance</h3>
            <label className="settings-row">
              <div className="settings-row-text">
                <span className="settings-label">Theme</span>
                <span className="settings-desc">
                  Night is the default dark UI. Day is a light theme.
                </span>
              </div>
              <div className="theme-toggle" role="group" aria-label="Theme">
                <button
                  type="button"
                  className={`theme-opt ${theme === "dark" ? "active" : ""}`}
                  onClick={() => onSetTheme("dark")}
                >
                  Night
                </button>
                <button
                  type="button"
                  className={`theme-opt ${theme === "light" ? "active" : ""}`}
                  onClick={() => onSetTheme("light")}
                >
                  Day
                </button>
              </div>
            </label>

            <label className="settings-row">
              <div className="settings-row-text">
                <span className="settings-label">Privacy mode</span>
                <span className="settings-desc">
                  Hide your home directory in the UI (paths show as ~/…). For
                  screenshots and demos only — does not change how the agent
                  works or what is stored on disk.
                </span>
              </div>
              <input
                type="checkbox"
                checked={privacyMode}
                onChange={(e) => onSetPrivacyMode(e.target.checked)}
              />
            </label>
          </section>

          <section className="settings-section">
            <h3>Coding data, retention, and training</h3>
            <div className="settings-row settings-row-stack">
              <div className="settings-row-text">
                <span className="settings-label">Share coding data</span>
                <span className="settings-desc">
                  Opt in to provide SpaceXAI the ability to retain and train on
                  coding data (prompts, traces, metrics) for training and
                  debugging. Simple product metrics may still be collected.
                  Same setting as CLI{" "}
                  <code>/privacy</code>. Default is <strong>Opt in</strong>.
                  Restart the agent after changing so the running process picks
                  it up.
                </span>
                {codingDataNote ? (
                  <span className="settings-desc settings-note">
                    {codingDataNote}
                  </span>
                ) : null}
                {offerRestart ? (
                  <span className="settings-desc settings-note">
                    Restart the agent to apply this change.
                  </span>
                ) : null}
              </div>
              <div
                className="theme-toggle coding-data-toggle"
                role="radiogroup"
                aria-label="Coding data retention"
              >
                <button
                  type="button"
                  className={`theme-opt ${codingDataOptIn ? "active" : ""}`}
                  aria-checked={codingDataOptIn}
                  role="radio"
                  onClick={() => onSetCodingDataOptIn(true)}
                >
                  Opt in
                </button>
                <button
                  type="button"
                  className={`theme-opt ${!codingDataOptIn ? "active" : ""}`}
                  aria-checked={!codingDataOptIn}
                  role="radio"
                  onClick={() => onSetCodingDataOptIn(false)}
                >
                  Opt out
                </button>
              </div>
            </div>
            <div className="settings-row">
              <div className="settings-row-text">
                <span className="settings-label">Restart agent</span>
                <span className="settings-desc">
                  Respawn the Grok process for this window and resume the same
                  chat. Use after coding-data or ~/.grok changes.
                </span>
              </div>
              <button
                type="button"
                className="btn"
                disabled={restarting}
                onClick={() => onRestartAgent()}
              >
                {restarting ? "Restarting…" : "Restart agent"}
              </button>
            </div>
          </section>

          <section className="settings-section">
            <h3>Agent safety</h3>

            <label className="settings-row settings-row-stack">
              <div className="settings-row-text">
                <span className="settings-label">Tool permission mode</span>
                <span className="settings-desc">{modeMeta.description}</span>
              </div>
              <select
                className="settings-select"
                value={permissionMode}
                aria-label="Tool permission mode"
                onChange={(e) =>
                  onSetPermissionMode(e.target.value as PermissionMode)
                }
              >
                {PERMISSION_MODE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="settings-row">
              <div className="settings-row-text">
                <span className="settings-label">Sandbox terminal</span>
                <span className="settings-desc">
                  When on (recommended), tool shells run in a project filesystem
                  jail. Host secrets and the Docker daemon stay out of reach;
                  network still works. Backend: {sandboxStatus || "…"}.
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
                <span className="settings-label">Allow outside project</span>
                <span className="settings-desc">
                  When off (recommended), ACP file ops and terminal cwd must
                  stay inside the open project or a{" "}
                  <strong>linked git worktree</strong> of this repo (sibling
                  checkouts from <code>git worktree add</code>). Independent of
                  terminal sandbox. File browser stays project-scoped either
                  way. Turn on only for paths that are not worktrees of this
                  repo.
                </span>
              </div>
              <input
                type="checkbox"
                checked={allowOutsideProject}
                onChange={onToggleAllowOutside}
              />
            </label>
          </section>

          <section className="settings-section">
            <h3>Diagnostics</h3>
            <label className="settings-row">
              <div className="settings-row-text">
                <span className="settings-label">Debug logging</span>
                <span className="settings-desc">
                  Write tool, hook, terminal, and ACP events to a local JSONL
                  log. Use when tools stick on pending / in_progress. Env{" "}
                  <code>GROK_DESKTOP_DEBUG=1</code> also enables this. Path:{" "}
                  <code className="settings-path" title={debugLogPath}>
                    {debugLogPath || "…"}
                  </code>
                </span>
              </div>
              <input
                type="checkbox"
                checked={debugLogging}
                onChange={(e) => onSetDebugLogging(e.target.checked)}
              />
            </label>
            <div className="settings-row">
              <div className="settings-row-text">
                <span className="settings-label">Open debug log</span>
                <span className="settings-desc">
                  Open the log file in your default editor (create if missing).
                </span>
              </div>
              <button
                type="button"
                className="btn"
                onClick={() => onOpenDebugLog()}
              >
                Open log
              </button>
            </div>
          </section>
        </div>

        <div className="modal-footer">
          <button type="button" className="btn primary" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

type KvRow = { key: string; value: string };

function splitArgTokens(command: string, extra: string): string[] {
  return [...command.trim().split(/\s+/), ...extra.trim().split(/\s+/)].filter(
    Boolean,
  );
}

function mcpRowDetail(s: McpServerInfo): string {
  const bits = [
    s.transport || "unknown",
    s.enabled === false ? "disabled" : null,
    s.scope || null,
    s.url || (s.command ? [s.command, ...(s.args || [])].join(" ") : null),
    s.envKeys?.length ? `env ${s.envKeys.join(", ")}` : null,
    s.headerKeys?.length ? `headers ${s.headerKeys.join(", ")}` : null,
  ].filter(Boolean);
  return bits.join(" · ");
}

function McpSettingsPanel({
  open,
  restarting,
  hasProject,
  focus,
  onRestartAfterWrite,
}: {
  open: boolean;
  restarting: boolean;
  hasProject: boolean;
  focus: boolean;
  onRestartAfterWrite?: () => Promise<void> | void;
}) {
  const sectionRef = useRef<HTMLElement>(null);
  const [servers, setServers] = useState<McpServerInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [doctorOut, setDoctorOut] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [transport, setTransport] = useState<"stdio" | "http" | "sse">("stdio");
  const [command, setCommand] = useState("");
  const [argsText, setArgsText] = useState("");
  const [url, setUrl] = useState("");
  const [projectScope, setProjectScope] = useState(false);
  const [envRows, setEnvRows] = useState<KvRow[]>([{ key: "", value: "" }]);
  const [headerRows, setHeaderRows] = useState<KvRow[]>([{ key: "", value: "" }]);

  const locked = busy || restarting;

  const reload = async () => {
    const res = await window.grokDesktop.listMcpServers();
    setServers(res.servers || []);
    if (!res.ok && res.error) setNote(res.error);
    return res;
  };

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setNote(null);
    setDoctorOut(null);
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
      setNote(error || "MCP command failed.");
      return;
    }
    setNote(null);
    if (hasProject && onRestartAfterWrite) {
      await onRestartAfterWrite();
    }
    await reload();
  };

  const onToggle = async (s: McpServerInfo) => {
    setBusy(true);
    setNote(null);
    try {
      const res =
        s.enabled === false
          ? await window.grokDesktop.enableMcpServer(s.name)
          : await window.grokDesktop.disableMcpServer(s.name);
      await afterWrite(res.ok, res.error);
    } catch (e: unknown) {
      setNote(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const onRemove = async (s: McpServerInfo) => {
    if (
      !window.confirm(
        `Remove MCP server “${s.name}”? This runs grok mcp remove (does not edit config.toml in the app).`,
      )
    ) {
      return;
    }
    setBusy(true);
    setNote(null);
    try {
      const res = await window.grokDesktop.removeMcpServer(
        s.name,
        s.scope === "user" || s.scope === "project"
          ? { scope: s.scope }
          : undefined,
      );
      await afterWrite(res.ok, res.error);
    } catch (e: unknown) {
      setNote(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const onDoctor = async (s?: McpServerInfo) => {
    setBusy(true);
    setDoctorOut(null);
    setNote(null);
    try {
      const res = await window.grokDesktop.doctorMcp(s?.name);
      const text = [res.stdout, res.stderr].filter(Boolean).join("\n").trim();
      setDoctorOut(text || (res.ok ? "Doctor finished with no output." : res.error || "Doctor failed."));
      if (!res.ok && res.error) setNote(res.error);
    } catch (e: unknown) {
      setNote(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const onAdd = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setNote("Name is required.");
      return;
    }
    setBusy(true);
    setNote(null);
    try {
      const tokens = splitArgTokens(command, argsText);
      const spec =
        transport === "stdio"
          ? {
              name: trimmed,
              transport,
              command: tokens[0] || "",
              args: tokens.slice(1),
              env: envRows.filter((r) => r.key.trim()),
              scope: (projectScope && hasProject ? "project" : "user") as
                | "project"
                | "user",
            }
          : {
              name: trimmed,
              transport,
              url: url.trim(),
              headers: headerRows
                .filter((r) => r.key.trim())
                .map((r) => ({ name: r.key.trim(), value: r.value })),
              scope: (projectScope && hasProject ? "project" : "user") as
                | "project"
                | "user",
            };
      const res = await window.grokDesktop.addMcpServer(spec);
      await afterWrite(res.ok, res.error);
      if (res.ok) {
        setName("");
        setCommand("");
        setArgsText("");
        setUrl("");
        setEnvRows([{ key: "", value: "" }]);
        setHeaderRows([{ key: "", value: "" }]);
      }
    } catch (e: unknown) {
      setNote(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="settings-section" ref={sectionRef} id="settings-mcp">
      <h3>MCP servers</h3>
      <p className="settings-desc settings-lead">
        Same as <code>grok mcp</code> — add, toggle, or remove here. Desktop
        never edits <code>config.toml</code>. Writes restart the agent so the
        live session picks them up.
      </p>
      {loading ? <p className="settings-desc">Loading MCP servers…</p> : null}
      {!loading && servers.length === 0 ? (
        <p className="settings-desc">No MCP servers. Add one here — no terminal.</p>
      ) : null}
      {servers.map((s) => (
        <div className="settings-row mcp-row" key={`${s.name}:${s.scope || ""}`}>
          <div className="settings-row-text">
            <span className="settings-label">{s.name}</span>
            <span className="settings-desc">{mcpRowDetail(s)}</span>
          </div>
          <div className="mcp-actions">
            <button
              type="button"
              className="btn btn-sm"
              disabled={locked}
              onClick={() => void onToggle(s)}
            >
              {s.enabled === false ? "Enable" : "Disable"}
            </button>
            <button
              type="button"
              className="btn btn-sm"
              disabled={locked}
              onClick={() => void onDoctor(s)}
            >
              Test
            </button>
            <button
              type="button"
              className="btn btn-sm"
              disabled={locked}
              onClick={() => void onRemove(s)}
            >
              Remove
            </button>
          </div>
        </div>
      ))}

      <div className="mcp-add">
        <span className="settings-label">Add server</span>
        <label className="mcp-field">
          <span>Name</span>
          <input
            className="settings-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="filesystem"
            autoComplete="off"
            disabled={locked}
          />
        </label>
        <label className="mcp-field">
          <span>Transport</span>
          <select
            className="settings-select"
            value={transport}
            aria-label="MCP transport"
            disabled={locked}
            onChange={(e) =>
              setTransport(e.target.value as "stdio" | "http" | "sse")
            }
          >
            <option value="stdio">stdio</option>
            <option value="http">HTTP</option>
            <option value="sse">SSE</option>
          </select>
        </label>
        {transport === "stdio" ? (
          <>
            <label className="mcp-field">
              <span>Command</span>
              <input
                className="settings-input"
                value={command}
                onChange={(e) => setCommand(e.target.value)}
                placeholder="npx -y @modelcontextprotocol/server-filesystem"
                autoComplete="off"
                disabled={locked}
              />
            </label>
            <label className="mcp-field">
              <span>Args</span>
              <input
                className="settings-input"
                value={argsText}
                onChange={(e) => setArgsText(e.target.value)}
                placeholder="/path/to/dir"
                autoComplete="off"
                disabled={locked}
              />
            </label>
            {envRows.map((row, i) => (
              <div className="mcp-kv" key={`env-${i}`}>
                <input
                  className="settings-input"
                  value={row.key}
                  placeholder="ENV_KEY"
                  autoComplete="off"
                  disabled={locked}
                  onChange={(e) => {
                    const next = [...envRows];
                    next[i] = { ...row, key: e.target.value };
                    setEnvRows(next);
                  }}
                />
                <input
                  className="settings-input"
                  type="password"
                  value={row.value}
                  placeholder="value"
                  autoComplete="off"
                  disabled={locked}
                  onChange={(e) => {
                    const next = [...envRows];
                    next[i] = { ...row, value: e.target.value };
                    setEnvRows(next);
                  }}
                />
              </div>
            ))}
            <button
              type="button"
              className="btn btn-sm"
              disabled={locked}
              onClick={() => setEnvRows([...envRows, { key: "", value: "" }])}
            >
              Add env
            </button>
          </>
        ) : (
          <>
            <label className="mcp-field">
              <span>URL</span>
              <input
                className="settings-input"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://mcp.example.com/mcp"
                autoComplete="off"
                disabled={locked}
              />
            </label>
            {headerRows.map((row, i) => (
              <div className="mcp-kv" key={`hdr-${i}`}>
                <input
                  className="settings-input"
                  value={row.key}
                  placeholder="Header"
                  autoComplete="off"
                  disabled={locked}
                  onChange={(e) => {
                    const next = [...headerRows];
                    next[i] = { ...row, key: e.target.value };
                    setHeaderRows(next);
                  }}
                />
                <input
                  className="settings-input"
                  type="password"
                  value={row.value}
                  placeholder="value"
                  autoComplete="off"
                  disabled={locked}
                  onChange={(e) => {
                    const next = [...headerRows];
                    next[i] = { ...row, value: e.target.value };
                    setHeaderRows(next);
                  }}
                />
              </div>
            ))}
            <button
              type="button"
              className="btn btn-sm"
              disabled={locked}
              onClick={() =>
                setHeaderRows([...headerRows, { key: "", value: "" }])
              }
            >
              Add header
            </button>
          </>
        )}
        <label className="mcp-check">
          <input
            type="checkbox"
            checked={projectScope && hasProject}
            disabled={locked || !hasProject}
            onChange={(e) => setProjectScope(e.target.checked)}
          />
          <span>
            Project scope (<code>.grok/config.toml</code>
            {hasProject ? "" : " — open a project first"})
          </span>
        </label>
        <div className="mcp-actions">
          <button
            type="button"
            className="btn"
            disabled={locked}
            onClick={() => void onAdd()}
          >
            {restarting ? "Restarting…" : busy ? "Working…" : "Add"}
          </button>
          <button
            type="button"
            className="btn btn-sm"
            disabled={locked}
            onClick={() => void onDoctor()}
          >
            Test all
          </button>
        </div>
      </div>
      {note ? <span className="settings-desc settings-note">{note}</span> : null}
      {doctorOut ? <pre className="settings-doctor">{doctorOut}</pre> : null}
    </section>
  );
}
