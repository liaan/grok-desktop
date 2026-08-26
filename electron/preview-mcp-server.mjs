#!/usr/bin/env node
/**
 * Stdio MCP server the grok agent spawns.
 * Talks to Grok Desktop's loopback Preview API (never prints non-JSON on stdout).
 */
import http from "node:http";
import readline from "node:readline";

const API = process.env.GROK_DESKTOP_PREVIEW_API || "";
const TOKEN = process.env.GROK_DESKTOP_PREVIEW_TOKEN || "";

const TOOLS = [
  {
    name: "preview_open",
    description:
      "Open Grok Desktop's detachable Preview window (the user can see and drag it to another screen) and navigate to a URL. Use this in Grok Desktop whenever the user wants to preview, show, open, or visually check a site or localhost UI. Do NOT use cloakbrowser, playwright, puppeteer, docker browsers, web_fetch, or curl for that — this is the in-app browser.",
    inputSchema: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description: "http(s) URL, e.g. http://localhost:5173 or https://example.com",
        },
      },
      required: ["url"],
    },
  },
  {
    name: "preview_snapshot",
    description:
      "Read the current Preview page as a compact text accessibility snapshot (cheap tokens). Prefer this over preview_screenshot unless you need pixels (layout/CSS).",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "preview_screenshot",
    description:
      "Capture the Preview viewport as a JPEG. Expensive (~1–2k tokens). Only when the user asked to see it or the text snapshot cannot answer (overlap, spacing, color).",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "preview_network",
    description:
      "Read the Preview request waterfall (status, type, size, timing, initiator). Debug lazy-load, 404s, cache. afterLoad: true keeps only requests after window load.",
    inputSchema: {
      type: "object",
      properties: {
        filter: { type: "string" },
        afterLoad: { type: "boolean" },
        limit: { type: "number" },
      },
    },
  },
  {
    name: "preview_state",
    description: "Current Preview window URL, title, and whether it is open.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "preview_close",
    description: "Close the Grok Desktop Preview window.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "preview_click",
    description:
      "Click a Preview control. Prefer snapshot ref (e3). selector or name also work.",
    inputSchema: {
      type: "object",
      properties: {
        ref: { type: "string" },
        selector: { type: "string" },
        name: { type: "string" },
      },
    },
  },
  {
    name: "preview_fill",
    description: "Fill a Preview text field. Requires value. Prefer snapshot ref.",
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
  {
    name: "preview_press",
    description: "Press Enter/Tab/Escape in Preview.",
    inputSchema: {
      type: "object",
      properties: { key: { type: "string" }, ref: { type: "string" } },
    },
  },
];

function send(msg) {
  process.stdout.write(`${JSON.stringify(msg)}\n`);
}

function callApi(method, path, body) {
  return new Promise((resolve, reject) => {
    if (!API || !TOKEN) {
      reject(new Error("Preview API is not configured (Grok Desktop is not running)"));
      return;
    }
    const url = new URL(path, API.endsWith("/") ? API : `${API}/`);
    const payload = body ? JSON.stringify(body) : "";
    const req = http.request(
      url,
      {
        method,
        headers: {
          authorization: `Bearer ${TOKEN}`,
          "content-type": "application/json",
          "content-length": Buffer.byteLength(payload),
        },
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const raw = Buffer.concat(chunks).toString("utf8");
          let data = {};
          try {
            data = raw ? JSON.parse(raw) : {};
          } catch {
            data = { error: raw };
          }
          if (res.statusCode && res.statusCode >= 400) {
            reject(new Error(data.error || raw || `HTTP ${res.statusCode}`));
            return;
          }
          resolve(data);
        });
      },
    );
    req.on("error", reject);
    req.end(payload);
  });
}

function textResult(text, extra = []) {
  return {
    content: [{ type: "text", text: String(text) }, ...extra],
  };
}

async function callTool(name, args) {
  switch (name) {
    case "preview_open": {
      const data = await callApi("POST", "/open", { url: args?.url || "" });
      return textResult(
        `Preview open. url=${data.url || args?.url || ""} title=${data.title || "(loading)"}. The user can see this window and move it to another screen.`,
      );
    }
    case "preview_snapshot": {
      const data = await callApi("POST", "/snapshot", {});
      const tokens = Math.ceil((data.chars || String(data.text || "").length) / 4);
      return textResult(`${data.text}\n\n(~${tokens} tokens)`);
    }
    case "preview_screenshot": {
      const data = await callApi("POST", "/screenshot", {});
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
    case "preview_network": {
      const data = await callApi("POST", "/network", args || {});
      return textResult(data.text || JSON.stringify(data));
    }
    case "preview_state": {
      const data = await callApi("GET", "/state");
      return textResult(JSON.stringify(data));
    }
    case "preview_close": {
      const data = await callApi("POST", "/close", {});
      return textResult(data.open ? "Preview still open" : "Preview closed");
    }
    case "preview_click": {
      const data = await callApi("POST", "/click", args || {});
      return textResult(JSON.stringify(data));
    }
    case "preview_fill": {
      const data = await callApi("POST", "/fill", args || {});
      return textResult(JSON.stringify(data));
    }
    case "preview_press": {
      const data = await callApi("POST", "/press", args || {});
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
      const data = await callApi("POST", path, args || {});
      return textResult(JSON.stringify(data));
    }
    case "preview_fill_form":
    case "fill_form": {
      const fields = Array.isArray(args?.fields) ? args.fields : [];
      const results = [];
      for (const field of fields) {
        results.push(await callApi("POST", "/fill", field || {}));
      }
      if (args?.submit !== false) {
        const submit =
          args?.submit && typeof args.submit === "object" ? args.submit : {};
        if (submit.ref || submit.name || submit.selector) {
          results.push(await callApi("POST", "/click", submit));
        } else {
          results.push(await callApi("POST", "/press", { key: "Enter" }));
        }
      }
      return textResult(JSON.stringify({ ok: true, steps: results }));
    }
    case "preview_type":
    case "type": {
      const data = await callApi("POST", "/fill", args || {});
      return textResult(JSON.stringify(data));
    }
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

async function handle(msg) {
  if (!msg || typeof msg !== "object") return;
  const { id, method, params } = msg;
  if (method === "initialize") {
    send({
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: params?.protocolVersion || "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "desktop-preview", version: "0.1.0" },
      },
    });
    return;
  }
  if (method === "notifications/initialized" || method === "initialized") {
    return;
  }
  if (method === "tools/list") {
    send({ jsonrpc: "2.0", id, result: { tools: TOOLS } });
    return;
  }
  if (method === "ping") {
    send({ jsonrpc: "2.0", id, result: {} });
    return;
  }
  if (method === "tools/call") {
    try {
      const result = await callTool(params?.name, params?.arguments || {});
      send({ jsonrpc: "2.0", id, result });
    } catch (err) {
      send({
        jsonrpc: "2.0",
        id,
        result: {
          isError: true,
          content: [{ type: "text", text: err?.message || String(err) }],
        },
      });
    }
    return;
  }
  if (id !== undefined) {
    send({
      jsonrpc: "2.0",
      id,
      error: { code: -32601, message: `Method not found: ${method}` },
    });
  }
}

const rl = readline.createInterface({ input: process.stdin });
rl.on("line", (line) => {
  const trimmed = String(line || "").trim();
  if (!trimmed) return;
  let msg;
  try {
    msg = JSON.parse(trimmed);
  } catch {
    return;
  }
  void handle(msg);
});
