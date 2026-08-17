/**
 * Shared MCP JSON-RPC handlers for Preview (stdio child + in-process HTTP).
 */
import { dispatchPreviewApi } from "./preview-api.mjs";

export const PREVIEW_MCP_TOOLS = [
  {
    name: "preview_open",
    description:
      "Open Grok Desktop's detachable Preview window (the user can see and drag it to another screen) and navigate to a URL. Use this in Grok Desktop whenever the user wants to preview, show, open, or visually check a site or localhost UI. Do NOT use cloakbrowser, playwright, puppeteer, docker browsers, web_fetch, or curl for that — this is the in-app browser. Qualified name: desktop-preview__preview_open.",
    inputSchema: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description:
            "http(s) URL, e.g. http://localhost:5173 or https://example.com",
        },
      },
      required: ["url"],
    },
  },
  {
    name: "preview_snapshot",
    description:
      "Read the current Preview page as a compact text accessibility snapshot (cheap tokens). Prefer this over preview_screenshot unless you need pixels (layout/CSS). Qualified name: desktop-preview__preview_snapshot.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "preview_screenshot",
    description:
      "Capture the Preview viewport as a JPEG. Expensive (~1–2k tokens). Only when the user asked to see it or the text snapshot cannot answer. Qualified name: desktop-preview__preview_screenshot.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "preview_state",
    description:
      "Current Preview window URL, title, and whether it is open. Qualified name: desktop-preview__preview_state.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "preview_close",
    description:
      "Close the Grok Desktop Preview window. Qualified name: desktop-preview__preview_close.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "preview_click",
    description:
      "Click a control in the Preview window. Prefer ref from the latest snapshot (e.g. e3). CSS selector or visible name also work. Qualified name: desktop-preview__preview_click.",
    inputSchema: {
      type: "object",
      properties: {
        ref: { type: "string", description: "Snapshot ref such as e3" },
        selector: { type: "string", description: "CSS selector" },
        name: {
          type: "string",
          description: "Visible label, placeholder, or aria-label",
        },
      },
    },
  },
  {
    name: "preview_fill",
    description:
      "Type/fill a text field in the Preview window (email, password, etc.). Prefer snapshot ref. Qualified name: desktop-preview__preview_fill.",
    inputSchema: {
      type: "object",
      properties: {
        value: { type: "string", description: "Text to enter" },
        ref: { type: "string", description: "Snapshot ref such as e2" },
        selector: { type: "string" },
        name: { type: "string" },
      },
      required: ["value"],
    },
  },
  {
    name: "preview_press",
    description:
      "Press a key in Preview (Enter to submit, Tab, Escape). Qualified name: desktop-preview__preview_press.",
    inputSchema: {
      type: "object",
      properties: {
        key: { type: "string", description: "Enter, Tab, or Escape" },
        ref: { type: "string" },
        selector: { type: "string" },
      },
    },
  },
  {
    name: "preview_interact",
    description:
      "Interact with the Preview page: click, type, fill, or press a key. Same as preview_click / preview_fill / preview_press. Use this to test login in the visible window. Do not use PowerShell, curl, or CSRF tokens. Qualified name: desktop-preview__preview_interact.",
    inputSchema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          description: "click | fill | type | press",
        },
        ref: { type: "string" },
        selector: { type: "string" },
        name: { type: "string" },
        value: { type: "string" },
        key: { type: "string" },
      },
      required: ["action"],
    },
  },
  {
    name: "preview_fill_form",
    description:
      "Fill a login or other form in the Preview window (multiple fields) then submit. Use this instead of PowerShell Invoke-WebRequest, curl, or forging CSRF. Qualified name: desktop-preview__preview_fill_form.",
    inputSchema: {
      type: "object",
      properties: {
        fields: {
          type: "array",
          items: {
            type: "object",
            properties: {
              ref: { type: "string" },
              selector: { type: "string" },
              name: { type: "string" },
              value: { type: "string" },
            },
          },
          description: "[{ ref: \"e2\", value: \"user\" }, { ref: \"e3\", value: \"wrong\" }]",
        },
        submit: {
          description:
            "false to skip submit; or { ref/name } of the button; default press Enter",
        },
      },
      required: ["fields"],
    },
  },
  {
    name: "preview_type",
    description:
      "Type into a Preview field (alias of preview_fill). Qualified name: desktop-preview__preview_type.",
    inputSchema: {
      type: "object",
      properties: {
        value: { type: "string" },
        ref: { type: "string" },
        selector: { type: "string" },
        name: { type: "string" },
      },
      required: ["value"],
    },
  },
];

function textResult(text, extra = []) {
  return {
    content: [{ type: "text", text: String(text) }, ...extra],
  };
}

async function callTool(name, args) {
  switch (name) {
    case "preview_open": {
      const data = await dispatchPreviewApi({
        method: "POST",
        path: "/open",
        body: { url: args?.url || "" },
      });
      return textResult(
        `Preview open. url=${data.url || args?.url || ""} title=${data.title || "(loading)"}. The user can see this window and move it to another screen.`,
      );
    }
    case "preview_snapshot": {
      const data = await dispatchPreviewApi({
        method: "POST",
        path: "/snapshot",
        body: {},
      });
      const tokens = Math.ceil(
        (data.chars || String(data.text || "").length) / 4,
      );
      return textResult(`${data.text}\n\n(~${tokens} tokens)`);
    }
    case "preview_screenshot": {
      const data = await dispatchPreviewApi({
        method: "POST",
        path: "/screenshot",
        body: {},
      });
      const extra = [];
      if (data.data && data.mimeType) {
        extra.push({
          type: "image",
          data: data.data,
          mimeType: data.mimeType,
        });
      }
      return textResult(
        `Viewport JPEG ${data.width}×${data.height}, ${data.bytes} bytes, ~${data.tokens} tokens if kept in context.`,
        extra,
      );
    }
    case "preview_state": {
      const data = await dispatchPreviewApi({ method: "GET", path: "/state" });
      return textResult(JSON.stringify(data));
    }
    case "preview_close": {
      const data = await dispatchPreviewApi({
        method: "POST",
        path: "/close",
        body: {},
      });
      return textResult(data.open ? "Preview still open" : "Preview closed");
    }
    case "preview_click": {
      const data = await dispatchPreviewApi({
        method: "POST",
        path: "/click",
        body: args || {},
      });
      return textResult(JSON.stringify(data));
    }
    case "preview_fill": {
      const data = await dispatchPreviewApi({
        method: "POST",
        path: "/fill",
        body: args || {},
      });
      return textResult(JSON.stringify(data));
    }
    case "preview_press": {
      const data = await dispatchPreviewApi({
        method: "POST",
        path: "/press",
        body: args || {},
      });
      return textResult(JSON.stringify(data));
    }
    case "preview_interact":
    case "interact": {
      const action = String(args?.action || "click").toLowerCase();
      const path =
        action === "fill" || action === "type"
          ? "/fill"
          : action === "press" || action === "enter"
            ? "/press"
            : "/click";
      const data = await dispatchPreviewApi({
        method: "POST",
        path,
        body: args || {},
      });
      return textResult(JSON.stringify(data));
    }
    case "preview_fill_form":
    case "fill_form": {
      const fields = Array.isArray(args?.fields) ? args.fields : [];
      if (!fields.length) {
        throw new Error(
          "preview_fill_form needs fields: [{ ref, value }] from the snapshot",
        );
      }
      const results = [];
      for (const field of fields) {
        results.push(
          await dispatchPreviewApi({
            method: "POST",
            path: "/fill",
            body: field || {},
          }),
        );
      }
      if (args?.submit !== false) {
        const submit =
          args?.submit && typeof args.submit === "object" ? args.submit : {};
        if (submit.ref || submit.name || submit.selector) {
          results.push(
            await dispatchPreviewApi({
              method: "POST",
              path: "/click",
              body: submit,
            }),
          );
        } else {
          results.push(
            await dispatchPreviewApi({
              method: "POST",
              path: "/press",
              body: { key: "Enter" },
            }),
          );
        }
      }
      return textResult(JSON.stringify({ ok: true, steps: results }));
    }
    case "preview_type":
    case "type": {
      const data = await dispatchPreviewApi({
        method: "POST",
        path: "/fill",
        body: args || {},
      });
      return textResult(JSON.stringify(data));
    }
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

/**
 * Handle one MCP JSON-RPC message.
 * @returns {object | null} response to send, or null for notifications
 */
export async function handlePreviewMcpMessage(msg) {
  if (!msg || typeof msg !== "object") return null;
  const { id, method, params } = msg;
  if (method === "initialize") {
    return {
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: params?.protocolVersion || "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "desktop-preview", version: "0.1.0" },
      },
    };
  }
  if (method === "notifications/initialized" || method === "initialized") {
    return null;
  }
  if (method === "tools/list") {
    return {
      jsonrpc: "2.0",
      id,
      result: { tools: PREVIEW_MCP_TOOLS },
    };
  }
  if (method === "ping") {
    return { jsonrpc: "2.0", id, result: {} };
  }
  if (method === "tools/call") {
    try {
      const result = await callTool(params?.name, params?.arguments || {});
      return { jsonrpc: "2.0", id, result };
    } catch (err) {
      return {
        jsonrpc: "2.0",
        id,
        result: {
          isError: true,
          content: [{ type: "text", text: err?.message || String(err) }],
        },
      };
    }
  }
  if (id !== undefined) {
    return {
      jsonrpc: "2.0",
      id,
      error: { code: -32601, message: `Method not found: ${method}` },
    };
  }
  return null;
}

export const PREVIEW_SESSION_RULE = [
  "You are in Grok Desktop. The Preview window is how the user sees and tests the UI.",
  "Interact tools exist: desktop-preview__preview_click, desktop-preview__preview_fill, desktop-preview__preview_type, desktop-preview__preview_press, desktop-preview__preview_interact, desktop-preview__preview_fill_form.",
  "To test login: snapshot, then preview_fill_form with the username/password refs, or fill each field and preview_click the submit button.",
  "Never test a login or form with PowerShell, Invoke-WebRequest, curl, CSRF token scraping, or a raw HTTP POST. That bypasses the UI the user asked to see.",
  "Never use cloakbrowser, Docker Chromium, Playwright, or web_fetch to preview a page in Grok Desktop.",
].join(" ");
