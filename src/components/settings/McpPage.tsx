import { useEffect, useRef, useState } from "react";
import {
  applyMcpServerStatus,
  mcpLiveLabel,
  mcpNeedsSignIn,
  resolveMcpCardStatus,
  summarizeMcpDoctorDetail,
} from "../../../shared/mcp-status.mjs";
import type {
  McpDoctorResult,
  McpDoctorServer,
  McpServerInfo,
} from "../../vite-env";

type KvRow = { key: string; value: string };

type TestView = {
  status: "running" | "ok" | "fail";
  healthy?: boolean;
  checks?: McpDoctorServer["checks"];
  tools?: string[];
  toolCount?: number | null;
  error?: string | null;
  needsAuth?: boolean;
};

function looksLikeOauthFail(text: string | null | undefined): boolean {
  return /oauth authorization required|no stored tokens|authenticate in tui|authorization required, when send initialize|re-authenticate in tui/i.test(
    String(text || ""),
  );
}

function viewNeedsAuth(view?: TestView | null): boolean {
  if (!view) return false;
  if (view.needsAuth) return true;
  if (looksLikeOauthFail(view.error)) return true;
  return (view.checks || []).some(
    (c) => !c.passed && looksLikeOauthFail(`${c.label} ${c.detail || ""}`),
  );
}

function isManagedMcp(s: McpServerInfo): boolean {
  return (
    s.source === "managed" ||
    s.scope === "managed" ||
    String(s.name).startsWith("managed_gateway:")
  );
}

function liveStatusClass(status: string | null | undefined): string {
  if (status === "ready") return "mcp-status mcp-status-ready";
  if (status === "needs-auth" || status === "setup-required") {
    return "mcp-status mcp-status-auth";
  }
  if (status === "unavailable") return "mcp-status mcp-status-down";
  if (status === "initializing") return "mcp-status mcp-status-init";
  return "mcp-status mcp-status-unknown";
}

function cardStatusClass(status: string | null | undefined): string {
  if (status === "ready") return "mcp-card-ready";
  if (status === "needs-auth" || status === "setup-required") {
    return "mcp-card-auth";
  }
  if (status === "unavailable") return "mcp-card-down";
  if (status === "initializing") return "mcp-card-init";
  return "mcp-card-unknown";
}

function splitArgTokens(command: string, extra: string): string[] {
  return [...command.trim().split(/\s+/), ...extra.trim().split(/\s+/)].filter(
    Boolean,
  );
}

function mcpTarget(s: McpServerInfo): string | null {
  if (s.url) return s.url;
  if (s.command) return [s.command, ...(s.args || [])].join(" ");
  return null;
}

function reportKey(s: { name: string }): string {
  return s.name;
}

function viewFromDoctorServer(row: McpDoctorServer): TestView {
  const needsAuth =
    Boolean(row.needsAuth) ||
    (row.checks || []).some(
      (c) => !c.passed && looksLikeOauthFail(`${c.label} ${c.detail || ""}`),
    );
  return {
    status: row.healthy ? "ok" : "fail",
    healthy: row.healthy,
    checks: row.checks,
    tools: row.tools,
    toolCount: row.toolCount,
    error: row.healthy
      ? null
      : needsAuth
        ? "This server needs a browser sign-in before Test can handshake."
        : "Doctor reported this server as failing.",
    needsAuth,
  };
}

function applyDoctorResult(
  res: McpDoctorResult,
  names: string[],
): Record<string, TestView> {
  const byName = new Map((res.servers || []).map((row) => [row.name, row]));
  const next: Record<string, TestView> = {};
  for (const name of names) {
    const row = byName.get(name);
    if (row) {
      next[name] = viewFromDoctorServer(row);
      continue;
    }
    const fallback = [res.stdout, res.stderr, res.error]
      .filter(Boolean)
      .join("\n")
      .trim();
    next[name] = {
      status: res.ok ? "ok" : "fail",
      healthy: res.ok,
      error:
        fallback ||
        (res.ok
          ? "Doctor finished with no report for this server."
          : "Doctor failed."),
      needsAuth: looksLikeOauthFail(fallback),
    };
  }
  return next;
}

function testHeadline(view: TestView): string {
  if (view.status === "running") return "Testing…";
  const n = view.toolCount;
  if (view.healthy) {
    if (n === 1) return "Healthy · 1 tool";
    if (n != null) return `Healthy · ${n} tools`;
    return "Healthy";
  }
  if (n != null) return `Failed · ${n} tools`;
  return "Failed";
}

export function McpPage({
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
  const serversRef = useRef<McpServerInfo[]>([]);
  const [servers, setServers] = useState<McpServerInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [writeBusy, setWriteBusy] = useState(false);
  const [testing, setTesting] = useState<string | "all" | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [reports, setReports] = useState<Record<string, TestView>>({});
  const [adding, setAdding] = useState(false);
  const [editingName, setEditingName] = useState<string | null>(null);
  const [authing, setAuthing] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [transport, setTransport] = useState<"stdio" | "http" | "sse">("stdio");
  const [command, setCommand] = useState("");
  const [argsText, setArgsText] = useState("");
  const [url, setUrl] = useState("");
  const [projectScope, setProjectScope] = useState(false);
  const [envRows, setEnvRows] = useState<KvRow[]>([{ key: "", value: "" }]);
  const [headerRows, setHeaderRows] = useState<KvRow[]>([{ key: "", value: "" }]);

  const setServerList = (
    next: McpServerInfo[] | ((prev: McpServerInfo[]) => McpServerInfo[]),
  ) => {
    setServers((prev) => {
      const resolved = typeof next === "function" ? next(prev) : next;
      serversRef.current = resolved;
      return resolved;
    });
  };

  const writeLocked = writeBusy || restarting;
  const testLocked = testing !== null || restarting;
  const authLocked = authing !== null || restarting;
  const formOpen = adding || Boolean(editingName);

  const reload = async (cache = true) => {
    const res = await window.grokDesktop.listMcpServers({ cache });
    const next = res.servers || [];
    setServerList(next);
    if (!res.ok && res.error) setNote(res.error);
    if (next.length === 0 && !editingName) setAdding(true);
    return res;
  };

  useEffect(() => {
    if (!open) return;
    let reloadTimer: ReturnType<typeof setTimeout> | null = null;
    const scheduleReload = () => {
      if (reloadTimer) clearTimeout(reloadTimer);
      reloadTimer = setTimeout(() => {
        void reload();
      }, 200);
    };
    const off = window.grokDesktop.on(
      "agent:mcp-status",
      (event: { method?: string; params?: Record<string, unknown> }) => {
        const method = String(event?.method || "");
        if (method === "x.ai/mcp/server_status") {
          const name = String(event.params?.name || "");
          if (!name) return;
          setServerList((prev) =>
            prev.map((s) =>
              s.name === name ? applyMcpServerStatus(s, event.params || {}) : s,
            ),
          );
          return;
        }
        if (
          method === "x.ai/mcp/init_progress" ||
          method === "x.ai/mcp/tools_changed" ||
          method === "x.ai/mcp/servers_updated" ||
          method === "x.ai/mcp_initialized"
        ) {
          scheduleReload();
        }
      },
    );
    return () => {
      if (reloadTimer) clearTimeout(reloadTimer);
      off();
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    let ticks = 0;
    const id = window.setInterval(() => {
      ticks += 1;
      const stuck = serversRef.current.some(
        (s) =>
          s.enabled !== false &&
          (s.liveStatus === "initializing" || !s.liveStatus),
      );
      if (!stuck || ticks > 24) {
        window.clearInterval(id);
        return;
      }
      void reload(ticks > 2 ? false : true);
    }, 1250);
    return () => window.clearInterval(id);
  }, [open]);

  const resetForm = () => {
    setName("");
    setTransport("stdio");
    setCommand("");
    setArgsText("");
    setUrl("");
    setProjectScope(false);
    setEnvRows([{ key: "", value: "" }]);
    setHeaderRows([{ key: "", value: "" }]);
    setAdding(false);
    setEditingName(null);
  };

  const beginEdit = (s: McpServerInfo) => {
    setAdding(false);
    setEditingName(s.name);
    setName(s.name);
    const t = String(s.transport || "").toLowerCase();
    setTransport(t === "http" || t === "sse" ? t : "stdio");
    setCommand(s.command || "");
    setArgsText((s.args || []).join(" "));
    setUrl(s.url || "");
    setProjectScope(s.scope === "project");
    setEnvRows(
      s.envKeys?.length
        ? s.envKeys.map((key) => ({ key, value: "" }))
        : [{ key: "", value: "" }],
    );
    setHeaderRows(
      s.headerKeys?.length
        ? s.headerKeys.map((key) => ({ key, value: "" }))
        : [{ key: "", value: "" }],
    );
    setNote(null);
  };

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setNote(null);
    setReports({});
    setTesting(null);
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

  useEffect(() => {
    if (!formOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      resetForm();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [formOpen]);

  const afterWrite = async (ok: boolean, error?: string | null) => {
    if (!ok) {
      setNote(error || "MCP command failed.");
      return;
    }
    setNote(null);
    if (onRestartAfterWrite) {
      await onRestartAfterWrite();
    }
    await reload();
  };

  const onToggle = async (s: McpServerInfo) => {
    setWriteBusy(true);
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
      setWriteBusy(false);
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
    setWriteBusy(true);
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
      setWriteBusy(false);
    }
  };

  const onDoctor = async (s?: McpServerInfo) => {
    const names = s ? [s.name] : servers.map((row) => row.name);
    if (names.length === 0) {
      setNote("No MCP servers to test.");
      return;
    }
    setTesting(s ? s.name : "all");
    setNote(null);
    setReports((prev) => {
      const next = { ...prev };
      for (const name of names) next[name] = { status: "running" };
      return next;
    });
    try {
      const res = await window.grokDesktop.doctorMcp(s?.name);
      const mapped = applyDoctorResult(res, names);
      setReports((prev) => ({ ...prev, ...mapped }));
      setServerList((prev) =>
        prev.map((row) => {
          const report = mapped[row.name];
          if (!report) return row;
          if (report.needsAuth) {
            return { ...row, liveStatus: "needs-auth", authRequired: true };
          }
          if (report.healthy) {
            return { ...row, liveStatus: "ready", authRequired: false };
          }
          if (report.status === "fail") {
            return { ...row, liveStatus: "unavailable" };
          }
          return row;
        }),
      );
      if (!res.ok && res.error && !(res.servers || []).length) {
        setNote(res.error);
      }
      const focusName = s?.name || names[0];
      if (focusName) {
        document
          .getElementById(`mcp-card-${focusName}`)
          ?.scrollIntoView({ block: "nearest", behavior: "smooth" });
      }
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      setNote(message);
      setReports((prev) => {
        const next = { ...prev };
        for (const name of names) {
          next[name] = { status: "fail", healthy: false, error: message };
        }
        return next;
      });
    } finally {
      setTesting(null);
    }
  };

  const onLogout = async (s: McpServerInfo) => {
    if (
      !window.confirm(
        `Sign out of “${s.displayName || s.name}”? This removes the stored OAuth token. You will need to sign in again.`,
      )
    ) {
      return;
    }
    setWriteBusy(true);
    setNote(null);
    try {
      const res = await window.grokDesktop.logoutMcpServer(s.name);
      if (!res.ok) {
        setNote(res.error || `Sign-out failed for “${s.name}”.`);
        return;
      }
      setReports((prev) => {
        const next = { ...prev };
        delete next[s.name];
        return next;
      });
      setServerList((prev) =>
        prev.map((row) =>
          row.name === s.name
            ? {
                ...row,
                signedIn: false,
                liveStatus: "needs-auth",
                authRequired: true,
              }
            : row,
        ),
      );
      await afterWrite(true);
      setNote(
        res.removed
          ? `Signed out of “${s.name}”. Sign in again to reconnect.`
          : `No stored token for “${s.name}”.`,
      );
    } catch (e: unknown) {
      setNote(e instanceof Error ? e.message : String(e));
    } finally {
      setWriteBusy(false);
    }
  };

  const onAuth = async (s: McpServerInfo) => {
    setAuthing(s.name);
    setNote(null);
    try {
      const res = await window.grokDesktop.authenticateMcpServer(s.name);
      if (res.ok) {
        setNote(`Signed in to “${s.name}”.`);
        setReports((prev) => {
          const next = { ...prev };
          delete next[s.name];
          return next;
        });
        setServerList((prev) =>
          prev.map((row) =>
            row.name === s.name
              ? { ...row, liveStatus: "ready", authRequired: false, signedIn: true }
              : row,
          ),
        );
        await reload();
        return;
      }
      setNote(res.error || `Sign-in failed for “${s.name}”.`);
      setReports((prev) => ({
        ...prev,
        [s.name]: {
          status: "fail",
          healthy: false,
          error: res.error || "Sign-in failed.",
          needsAuth: res.status !== "setup_required",
        },
      }));
    } catch (e: unknown) {
      setNote(e instanceof Error ? e.message : String(e));
    } finally {
      setAuthing(null);
    }
  };

  const onAdd = async () => {
    const trimmed = (editingName || name).trim();
    if (!trimmed) {
      setNote("Name is required.");
      return;
    }
    const existing = editingName
      ? servers.find((row) => row.name === editingName)
      : undefined;
    const filledEnv = envRows.filter((r) => r.key.trim() && r.value);
    const filledHeaders = headerRows.filter((r) => r.key.trim() && r.value);
    const hadSecrets = Boolean(
      existing?.envKeys?.length || existing?.headerKeys?.length,
    );
    if (
      existing &&
      hadSecrets &&
      filledEnv.length === 0 &&
      filledHeaders.length === 0
    ) {
      if (
        !window.confirm(
          `Save “${trimmed}”? grok mcp add replaces the server definition. Env/header values left blank will be removed. OAuth tokens are kept unless you change the URL.`,
        )
      ) {
        return;
      }
    }
    setWriteBusy(true);
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
              env: filledEnv,
              scope: (projectScope &&
              (hasProject || existing?.scope === "project")
                ? "project"
                : "user") as "project" | "user",
            }
          : {
              name: trimmed,
              transport,
              url: url.trim(),
              headers: filledHeaders.map((r) => ({
                name: r.key.trim(),
                value: r.value,
              })),
              scope: (projectScope && hasProject
                ? "project"
                : existing?.scope === "project"
                  ? "project"
                  : "user") as "project" | "user",
            };
      const res = await window.grokDesktop.addMcpServer(spec);
      await afterWrite(res.ok, res.error);
      if (res.ok) resetForm();
    } catch (e: unknown) {
      setNote(e instanceof Error ? e.message : String(e));
    } finally {
      setWriteBusy(false);
    }
  };

  return (
    <section className="settings-section" ref={sectionRef} id="settings-mcp">
      <h3>MCP servers</h3>
      <p className="settings-desc settings-lead">
        Same as <code>grok mcp</code> and the TUI <code>/mcps</code> modal —
        add, edit, toggle, test, sign in, or log out here. Status matches the TUI
        (initializing → ready / needs auth / unavailable). Desktop never edits{" "}
        <code>config.toml</code>. Sign in only appears when a server needs
        OAuth. Log out removes the stored token for that server.
      </p>
      <div className="mcp-toolbar">
        <span className="settings-desc">
          {loading
            ? "Loading…"
            : servers.length === 1
              ? "1 server"
              : `${servers.length} servers`}
        </span>
        <div className="mcp-actions">
          <button
            type="button"
            className="btn btn-sm"
            disabled={testLocked || loading || servers.length === 0}
            onClick={() => void onDoctor()}
          >
            {testing === "all" ? "Testing…" : "Test all"}
          </button>
          <button
            type="button"
            className="btn btn-sm"
            disabled={writeLocked}
            onClick={() => {
              if (formOpen) {
                resetForm();
                return;
              }
              setEditingName(null);
              setAdding(true);
            }}
          >
            {formOpen ? "Cancel" : "Add server"}
          </button>
        </div>
      </div>

      {loading ? <p className="settings-desc">Loading MCP servers…</p> : null}
      {!loading && servers.length === 0 ? (
        <p className="settings-desc">No MCP servers. Add one here — no terminal.</p>
      ) : null}

      <div className="mcp-list">
        {servers.map((s) => {
          const view = reports[reportKey(s)];
          const target = mcpTarget(s);
          const testingThis = testing === s.name || testing === "all";
          const status = resolveMcpCardStatus(s, view);
          const statusLabel = mcpLiveLabel(status) || "unknown";
          return (
            <article
              className={`mcp-card ${cardStatusClass(status)}${s.enabled === false ? " mcp-card-off" : ""}`}
              key={`${s.name}:${s.scope || ""}`}
              id={`mcp-card-${s.name}`}
            >
              <div className="mcp-card-head">
                <div className="settings-row-text">
                  <span className="settings-label">
                    {s.displayName || s.name}
                  </span>
                  <span className="mcp-badges">
                    <span className={liveStatusClass(status)}>
                      <span className="mcp-status-dot" aria-hidden />
                      {statusLabel}
                    </span>
                    <span className="mcp-badge">{s.transport || "unknown"}</span>
                    {s.scope ? <span className="mcp-badge">{s.scope}</span> : null}
                    {s.enabled === false ? (
                      <span className="mcp-badge mcp-badge-off">disabled</span>
                    ) : null}
                    {s.envKeys?.length ? (
                      <span className="mcp-badge">env {s.envKeys.length}</span>
                    ) : null}
                    {s.headerKeys?.length ? (
                      <span className="mcp-badge">
                        headers {s.headerKeys.length}
                      </span>
                    ) : null}
                  </span>
                  {target ? (
                    <span className="mcp-target" title={target}>
                      {target}
                    </span>
                  ) : null}
                </div>
                <div className="mcp-actions">
                  <button
                    type="button"
                    className="btn btn-sm"
                    disabled={writeLocked}
                    onClick={() => void onToggle(s)}
                  >
                    {s.enabled === false ? "Enable" : "Disable"}
                  </button>
                  <button
                    type="button"
                    className="btn btn-sm"
                    disabled={testLocked}
                    onClick={() => void onDoctor(s)}
                  >
                    {testingThis && testing !== "all" ? "Testing…" : "Test"}
                  </button>
                  {mcpNeedsSignIn(s, view) || viewNeedsAuth(view) ? (
                    <button
                      type="button"
                      className="btn btn-sm"
                      disabled={authLocked || writeLocked || !hasProject}
                      title={
                        hasProject
                          ? "Open a browser sign-in (same as TUI /mcps + i)"
                          : "Open a project first so the live agent can open the browser"
                      }
                      onClick={() => void onAuth(s)}
                    >
                      {authing === s.name
                        ? "Signing in…"
                        : s.signedIn
                          ? "Re-auth"
                          : "Sign in"}
                    </button>
                  ) : null}
                  {s.signedIn ? (
                    <button
                      type="button"
                      className="btn btn-sm"
                      disabled={writeLocked || authLocked}
                      title="Remove the stored OAuth token for this server"
                      onClick={() => void onLogout(s)}
                    >
                      Log out
                    </button>
                  ) : null}
                  {isManagedMcp(s) ? null : (
                    <button
                      type="button"
                      className="btn btn-sm"
                      disabled={writeLocked}
                      onClick={() => beginEdit(s)}
                    >
                      Edit
                    </button>
                  )}
                  {isManagedMcp(s) ? null : (
                    <button
                      type="button"
                      className="btn btn-sm"
                      disabled={writeLocked}
                      onClick={() => void onRemove(s)}
                    >
                      Remove
                    </button>
                  )}
                </div>
              </div>
              {view ? (
                <McpTestPanel
                  view={view}
                  onAuth={
                    viewNeedsAuth(view)
                      ? () => void onAuth(s)
                      : undefined
                  }
                  authBusy={authing === s.name}
                  authDisabled={!hasProject}
                />
              ) : null}
            </article>
          );
        })}
      </div>

      {formOpen ? (
        <div
          className="modal-backdrop"
          role="presentation"
          data-modal-layer="overlay"
          onClick={(e) => {
            if (e.target === e.currentTarget && !writeLocked) resetForm();
          }}
        >
          <div
            className="modal-dialog mcp-form-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="mcp-form-title"
          >
            <div className="modal-header">
              <h2 id="mcp-form-title">
                {editingName ? `Edit ${editingName}` : "Add server"}
              </h2>
              <button
                type="button"
                className="btn ghost btn-sm"
                disabled={writeLocked}
                onClick={() => resetForm()}
                aria-label="Close"
              >
                Close
              </button>
            </div>
            <div className="modal-body mcp-add">
          <div className="mcp-grid-2">
            <label className="mcp-field">
              <span>Name</span>
              <input
                className="settings-input"
                value={editingName || name}
                onChange={(e) => setName(e.target.value)}
                placeholder="filesystem"
                autoComplete="off"
                disabled={writeLocked || Boolean(editingName)}
              />
            </label>
            <label className="mcp-field">
              <span>Transport</span>
              <select
                className="settings-select"
                value={transport}
                aria-label="MCP transport"
                disabled={writeLocked}
                onChange={(e) =>
                  setTransport(e.target.value as "stdio" | "http" | "sse")
                }
              >
                <option value="stdio">stdio</option>
                <option value="http">HTTP</option>
                <option value="sse">SSE</option>
              </select>
            </label>
          </div>
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
                  disabled={writeLocked}
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
                  disabled={writeLocked}
                />
              </label>
              <span className="mcp-field-label">Environment</span>
              {envRows.map((row, i) => (
                <div className="mcp-kv" key={`env-${i}`}>
                  <input
                    className="settings-input"
                    value={row.key}
                    placeholder="ENV_KEY"
                    autoComplete="off"
                    disabled={writeLocked}
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
                    placeholder={editingName ? "leave blank to drop" : "value"}
                    autoComplete="off"
                    disabled={writeLocked}
                    onChange={(e) => {
                      const next = [...envRows];
                      next[i] = { ...row, value: e.target.value };
                      setEnvRows(next);
                    }}
                  />
                  <button
                    type="button"
                    className="btn btn-sm"
                    disabled={writeLocked || envRows.length === 1}
                    aria-label="Remove env row"
                    onClick={() =>
                      setEnvRows(envRows.filter((_, idx) => idx !== i))
                    }
                  >
                    ×
                  </button>
                </div>
              ))}
              <button
                type="button"
                className="btn btn-sm mcp-add-row"
                disabled={writeLocked}
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
                  disabled={writeLocked}
                />
              </label>
              <span className="mcp-field-label">Headers</span>
              {headerRows.map((row, i) => (
                <div className="mcp-kv" key={`hdr-${i}`}>
                  <input
                    className="settings-input"
                    value={row.key}
                    placeholder="Header"
                    autoComplete="off"
                    disabled={writeLocked}
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
                    placeholder={editingName ? "leave blank to drop" : "value"}
                    autoComplete="off"
                    disabled={writeLocked}
                    onChange={(e) => {
                      const next = [...headerRows];
                      next[i] = { ...row, value: e.target.value };
                      setHeaderRows(next);
                    }}
                  />
                  <button
                    type="button"
                    className="btn btn-sm"
                    disabled={writeLocked || headerRows.length === 1}
                    aria-label="Remove header row"
                    onClick={() =>
                      setHeaderRows(headerRows.filter((_, idx) => idx !== i))
                    }
                  >
                    ×
                  </button>
                </div>
              ))}
              <button
                type="button"
                className="btn btn-sm mcp-add-row"
                disabled={writeLocked}
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
              disabled={writeLocked || !hasProject}
              onChange={(e) => setProjectScope(e.target.checked)}
            />
            <span>
              Project scope (<code>.grok/config.toml</code>
              {hasProject ? "" : " — open a project first"})
            </span>
          </label>
              {note ? (
                <span className="settings-desc settings-note">{note}</span>
              ) : null}
            </div>
            <div className="modal-footer">
              <button
                type="button"
                className="btn ghost"
                disabled={writeLocked}
                onClick={() => resetForm()}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn"
                disabled={writeLocked}
                onClick={() => void onAdd()}
              >
                {restarting
                  ? "Restarting…"
                  : writeBusy
                    ? "Working…"
                    : editingName
                      ? "Save"
                      : "Add"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {!formOpen && note ? (
        <span className="settings-desc settings-note">{note}</span>
      ) : null}
    </section>
  );
}

function McpTestPanel({
  view,
  onAuth,
  authBusy,
  authDisabled,
}: {
  view: TestView;
  onAuth?: () => void;
  authBusy?: boolean;
  authDisabled?: boolean;
}) {
  const tools = view.tools || [];
  return (
    <div
      className={`mcp-test${
        view.status === "ok"
          ? " mcp-test-ok"
          : view.status === "fail"
            ? " mcp-test-fail"
            : ""
      }`}
    >
      <div
        className={`mcp-test-title${
          view.status === "ok"
            ? " ok"
            : view.status === "fail"
              ? " fail"
              : ""
        }`}
      >
        {testHeadline(view)}
      </div>
      {view.checks && view.checks.length > 0 ? (
        <ul className="mcp-checks">
          {view.checks.map((check) => {
            const detail = check.passed
              ? check.detail
              : summarizeMcpDoctorDetail(check.detail);
            return (
              <li key={check.label}>
                <span
                  className={check.passed ? "mcp-check-pass" : "mcp-check-fail"}
                >
                  {check.passed ? "✓" : "✗"}
                </span>{" "}
                {check.label}
                {detail ? ` (${detail})` : ""}
              </li>
            );
          })}
        </ul>
      ) : view.error ? (
        <p className="mcp-test-error">
          {summarizeMcpDoctorDetail(view.error) || view.error}
        </p>
      ) : null}
      {onAuth ? (
        <div className="mcp-actions mcp-test-actions">
          <button
            type="button"
            className="btn btn-sm"
            disabled={authBusy || authDisabled}
            title={
              authDisabled
                ? "Open a project first so the live agent can open the browser"
                : undefined
            }
            onClick={onAuth}
          >
            {authBusy ? "Signing in…" : "Sign in with browser"}
          </button>
        </div>
      ) : null}
      {tools.length > 0 ? (
        <div className="mcp-tools" aria-label="Discovered tools">
          {tools.map((tool) => (
            <span className="mcp-tool" key={tool}>
              {tool}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}
