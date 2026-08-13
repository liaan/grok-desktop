import { useEffect, useRef, useState } from "react";
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
};

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
  return {
    status: row.healthy ? "ok" : "fail",
    healthy: row.healthy,
    checks: row.checks,
    tools: row.tools,
    toolCount: row.toolCount,
    error: row.healthy ? null : "Doctor reported this server as failing.",
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
  const [servers, setServers] = useState<McpServerInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [writeBusy, setWriteBusy] = useState(false);
  const [testing, setTesting] = useState<string | "all" | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [reports, setReports] = useState<Record<string, TestView>>({});
  const [adding, setAdding] = useState(false);

  const [name, setName] = useState("");
  const [transport, setTransport] = useState<"stdio" | "http" | "sse">("stdio");
  const [command, setCommand] = useState("");
  const [argsText, setArgsText] = useState("");
  const [url, setUrl] = useState("");
  const [projectScope, setProjectScope] = useState(false);
  const [envRows, setEnvRows] = useState<KvRow[]>([{ key: "", value: "" }]);
  const [headerRows, setHeaderRows] = useState<KvRow[]>([{ key: "", value: "" }]);

  const writeLocked = writeBusy || restarting;
  const testLocked = testing !== null || restarting;

  const reload = async () => {
    const res = await window.grokDesktop.listMcpServers();
    const next = res.servers || [];
    setServers(next);
    if (!res.ok && res.error) setNote(res.error);
    if (next.length === 0) setAdding(true);
    return res;
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

  const onAdd = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setNote("Name is required.");
      return;
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
        setAdding(false);
      }
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
        Same as <code>grok mcp</code> — add, toggle, or remove here. Desktop
        never edits <code>config.toml</code>. Writes restart the agent so the
        live session picks them up.
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
            onClick={() => setAdding((v) => !v)}
          >
            {adding ? "Cancel" : "Add server"}
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
          return (
            <article
              className={`mcp-card${s.enabled === false ? " mcp-card-off" : ""}`}
              key={`${s.name}:${s.scope || ""}`}
              id={`mcp-card-${s.name}`}
            >
              <div className="mcp-card-head">
                <div className="settings-row-text">
                  <span className="settings-label">{s.name}</span>
                  <span className="mcp-badges">
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
                  <button
                    type="button"
                    className="btn btn-sm"
                    disabled={writeLocked}
                    onClick={() => void onRemove(s)}
                  >
                    Remove
                  </button>
                </div>
              </div>
              {view ? <McpTestPanel view={view} /> : null}
            </article>
          );
        })}
      </div>

      {adding ? (
        <div className="mcp-add mcp-add-card">
          <span className="settings-label">Add server</span>
          <div className="mcp-grid-2">
            <label className="mcp-field">
              <span>Name</span>
              <input
                className="settings-input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="filesystem"
                autoComplete="off"
                disabled={writeLocked}
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
                    placeholder="value"
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
                    placeholder="value"
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
          <div className="mcp-actions">
            <button
              type="button"
              className="btn"
              disabled={writeLocked}
              onClick={() => void onAdd()}
            >
              {restarting ? "Restarting…" : writeBusy ? "Working…" : "Add"}
            </button>
          </div>
        </div>
      ) : null}
      {note ? <span className="settings-desc settings-note">{note}</span> : null}
    </section>
  );
}

function McpTestPanel({ view }: { view: TestView }) {
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
          {view.checks.map((check) => (
            <li key={check.label}>
              <span className={check.passed ? "mcp-check-pass" : "mcp-check-fail"}>
                {check.passed ? "✓" : "✗"}
              </span>{" "}
              {check.label}
              {check.detail ? ` (${check.detail})` : ""}
            </li>
          ))}
        </ul>
      ) : view.error ? (
        <p className="mcp-test-error">{view.error}</p>
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
