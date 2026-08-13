import { useEffect, useRef, useState } from "react";
import type { McpServerInfo } from "../../vite-env";

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
    if (onRestartAfterWrite) {
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
      setDoctorOut(
        text || (res.ok ? "Doctor finished with no output." : res.error || "Doctor failed."),
      );
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
