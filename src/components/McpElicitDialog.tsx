import { useEffect, useMemo, useState } from "react";

export type McpElicitField = {
  name: string;
  title: string;
  description?: string;
  type: "string" | "number" | "boolean" | "enum" | "multi";
  required: boolean;
  enumValues?: string[];
};

export type McpElicitRequest = {
  reqId: string;
  serverName: string;
  message: string;
  mode: "form" | "url";
  url?: string;
  elicitationId?: string;
  requestedSchema?: unknown;
};

export type McpElicitDecision =
  | { outcome: "accept"; content?: Record<string, unknown> }
  | { outcome: "decline" }
  | { outcome: "cancel" };

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function parseFormFields(schema: unknown): McpElicitField[] {
  const root = asRecord(schema);
  if (!root) return [];
  const props = asRecord(root.properties);
  if (!props) return [];
  const required = new Set(
    Array.isArray(root.required)
      ? root.required.map((x) => String(x))
      : [],
  );
  const fields: McpElicitField[] = [];
  for (const [name, raw] of Object.entries(props)) {
    const spec = asRecord(raw) || {};
    const title = String(spec.title || name);
    const description =
      typeof spec.description === "string" ? spec.description : undefined;
    const type = String(spec.type || "string").toLowerCase();
    const items = asRecord(spec.items);
    const fromItems = Array.isArray(items?.enum)
      ? items.enum.map((v) => String(v))
      : [];
    const fromSpec = Array.isArray(spec.enum)
      ? spec.enum.map((v) => String(v))
      : [];
    const enumValues =
      type === "array"
        ? fromItems.length
          ? fromItems
          : fromSpec
        : fromSpec;
    const minItems = Number(spec.minItems);
    const mustPick =
      required.has(name) ||
      (type === "array" && Number.isFinite(minItems) && minItems >= 1);
    let fieldType: McpElicitField["type"] = "string";
    if (type === "boolean") fieldType = "boolean";
    else if (type === "number" || type === "integer") fieldType = "number";
    else if (type === "array" && enumValues.length) fieldType = "multi";
    else if (enumValues.length) fieldType = "enum";
    fields.push({
      name,
      title,
      description,
      type: fieldType,
      required: mustPick,
      enumValues: enumValues.length ? enumValues : undefined,
    });
  }
  return fields;
}

function isHttpUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

function ElicitFormFields({
  fields,
  values,
  errors,
  setField,
  toggleMulti,
}: {
  fields: McpElicitField[];
  values: Record<string, unknown>;
  errors: Record<string, string>;
  setField: (name: string, value: unknown) => void;
  toggleMulti: (name: string, option: string) => void;
}) {
  return fields.map((field) => {
    const err = errors[field.name];
    return (
      <label key={field.name} className="mcp-elicit-field">
        <span className="mcp-elicit-field-label">
          {field.title}
          {field.required ? " *" : ""}
        </span>
        {field.description ? (
          <span className="mcp-elicit-field-desc">{field.description}</span>
        ) : null}
        {field.type === "boolean" ? (
          <input
            type="checkbox"
            checked={Boolean(values[field.name])}
            onChange={(e) => setField(field.name, e.target.checked)}
          />
        ) : field.type === "enum" ? (
          <div className="ask-user-opts">
            {(field.enumValues || []).map((opt) => (
              <button
                key={opt}
                type="button"
                className={`ask-user-opt ${
                  values[field.name] === opt ? "active" : ""
                }`}
                onClick={() => setField(field.name, opt)}
              >
                <span className="ask-user-opt-label">{opt}</span>
              </button>
            ))}
          </div>
        ) : field.type === "multi" ? (
          <div className="ask-user-opts">
            {(field.enumValues || []).map((opt) => {
              const selected = Array.isArray(values[field.name])
                ? (values[field.name] as string[]).includes(opt)
                : false;
              return (
                <button
                  key={opt}
                  type="button"
                  className={`ask-user-opt ${selected ? "active" : ""}`}
                  onClick={() => toggleMulti(field.name, opt)}
                >
                  <span className="ask-user-opt-label">{opt}</span>
                </button>
              );
            })}
          </div>
        ) : (
          <input
            className="mcp-elicit-input"
            type={field.type === "number" ? "number" : "text"}
            value={String(values[field.name] ?? "")}
            onChange={(e) => setField(field.name, e.target.value)}
          />
        )}
        {err ? <span className="mcp-elicit-error">{err}</span> : null}
      </label>
    );
  });
}

/**
 * Modal for Grok `_x.ai/mcp/elicit` (form fields or URL consent).
 * URL Accept opens http(s) and answers ACP immediately — Desktop has a browser.
 */
export function McpElicitDialog({
  request,
  onRespond,
}: {
  request: McpElicitRequest | null;
  onRespond: (reqId: string, decision: McpElicitDecision) => void;
}) {
  const fields = useMemo(
    () => parseFormFields(request?.requestedSchema),
    [request?.reqId, request?.requestedSchema],
  );
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [openError, setOpenError] = useState<string | null>(null);

  useEffect(() => {
    if (!request) return;
    const next: Record<string, unknown> = {};
    for (const field of parseFormFields(request.requestedSchema)) {
      if (field.type === "boolean") next[field.name] = false;
      else if (field.type === "multi") next[field.name] = [];
      else next[field.name] = "";
    }
    setValues(next);
    setErrors({});
    setOpenError(null);
  }, [request?.reqId]);

  if (!request) return null;

  const title = request.serverName
    ? `${request.serverName} needs input`
    : "MCP server needs input";

  const setField = (name: string, value: unknown) => {
    setValues((prev) => ({ ...prev, [name]: value }));
    setErrors((prev) => {
      if (!prev[name]) return prev;
      const next = { ...prev };
      delete next[name];
      return next;
    });
  };

  const toggleMulti = (name: string, option: string) => {
    const cur = Array.isArray(values[name])
      ? (values[name] as string[])
      : [];
    const next = cur.includes(option)
      ? cur.filter((x) => x !== option)
      : [...cur, option];
    setField(name, next);
  };

  const acceptForm = () => {
    const nextErrors: Record<string, string> = {};
    const content: Record<string, unknown> = {};
    for (const field of fields) {
      const raw = values[field.name];
      if (field.type === "boolean") {
        content[field.name] = Boolean(raw);
        continue;
      }
      if (field.type === "multi") {
        const list = Array.isArray(raw) ? raw : [];
        if (field.required && list.length === 0) {
          nextErrors[field.name] = "Select at least one option";
        } else {
          content[field.name] = list;
        }
        continue;
      }
      if (field.type === "number") {
        const n = raw === "" || raw == null ? NaN : Number(raw);
        if (field.required && !Number.isFinite(n)) {
          nextErrors[field.name] = "Enter a number";
        } else if (Number.isFinite(n)) {
          content[field.name] = n;
        }
        continue;
      }
      const text = String(raw ?? "").trim();
      if (field.required && !text) {
        nextErrors[field.name] = "Required";
      } else if (text) {
        content[field.name] = text;
      }
    }
    if (Object.keys(nextErrors).length) {
      setErrors(nextErrors);
      return;
    }
    onRespond(request.reqId, {
      outcome: "accept",
      content: fields.length ? content : undefined,
    });
  };

  const acceptUrl = async () => {
    const url = request.url || "";
    if (!isHttpUrl(url)) return;
    try {
      await window.grokDesktop.openExternal(url);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setOpenError(msg || "Could not open the URL");
      return;
    }
    onRespond(request.reqId, { outcome: "accept" });
  };

  return (
    <div
      className="modal-backdrop"
      role="presentation"
      data-modal-layer="overlay"
    >
      <div
        className="modal-dialog mcp-elicit-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="mcp-elicit-title"
      >
        <div className="modal-header">
          <h2 id="mcp-elicit-title">{title}</h2>
          <button
            type="button"
            className="btn ghost btn-sm"
            aria-label="Cancel"
            onClick={() => onRespond(request.reqId, { outcome: "cancel" })}
          >
            ✕
          </button>
        </div>
        <div className="modal-body">
          {request.message ? (
            <p className="mcp-elicit-message">{request.message}</p>
          ) : null}
          {request.mode === "url" && request.url ? (
            <p className="worktree-path" title={request.url}>
              {request.url}
            </p>
          ) : null}
          {openError ? (
            <p className="mcp-elicit-error">{openError}</p>
          ) : null}
          {request.mode === "form" ? (
            <ElicitFormFields
              fields={fields}
              values={values}
              errors={errors}
              setField={setField}
              toggleMulti={toggleMulti}
            />
          ) : null}
        </div>
        <div className="modal-footer plan-approval-footer">
          <button
            type="button"
            className="btn"
            onClick={() => onRespond(request.reqId, { outcome: "cancel" })}
          >
            Cancel
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => onRespond(request.reqId, { outcome: "decline" })}
          >
            Decline
          </button>
          {request.mode === "url" ? (
            <button
              type="button"
              className="btn primary"
              disabled={!isHttpUrl(request.url || "")}
              onClick={acceptUrl}
            >
              Open and continue
            </button>
          ) : (
            <button type="button" className="btn primary" onClick={acceptForm}>
              Submit
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
