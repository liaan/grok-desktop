/**
 * Loopback JSON API for the detachable Preview window.
 * The grok agent cannot import Electron; the MCP child calls this instead.
 */
import http from "node:http";
import crypto from "node:crypto";
import {
  closePreviewWindow,
  navigatePreview,
  openPreviewWindow,
  previewPublicState,
  runPreviewAction,
  screenshotPreview,
  setPreviewViewport,
  snapshotPreview,
  snapshotPreviewNetwork,
  VIEWPORTS,
} from "./preview-window.mjs";

/** @type {http.Server | null} */
let server = null;
/** @type {string} */
let token = "";
/** @type {number} */
let port = 0;
/** @type {() => import('electron').BrowserWindow | null} */
let getOwner = () => null;

export function previewApiAddress() {
  if (!server || !port || !token) return null;
  return {
    url: `http://127.0.0.1:${port}`,
    token,
    port,
  };
}

/**
 * @param {object} req
 * @param {string} req.method
 * @param {string} req.path
 * @param {Record<string, unknown>} [req.body]
 */
export async function dispatchPreviewApi(req) {
  const method = String(req.method || "GET").toUpperCase();
  const path = String(req.path || "/");
  const body = req.body && typeof req.body === "object" ? req.body : {};

  if (method === "GET" && path === "/health") {
    return { ok: true, ...previewPublicState() };
  }
  if (method === "GET" && path === "/state") {
    return previewPublicState();
  }
  if (method === "POST" && path === "/open") {
    const url = typeof body.url === "string" ? body.url : "";
    return openPreviewWindow({ owner: getOwner(), url });
  }
  if (method === "POST" && path === "/close") {
    return { ok: closePreviewWindow(), ...previewPublicState() };
  }
  if (method === "POST" && path === "/navigate") {
    const url = typeof body.url === "string" ? body.url : "";
    if (!previewPublicState().open) {
      return openPreviewWindow({ owner: getOwner(), url });
    }
    return navigatePreview(url);
  }
  if (method === "POST" && path === "/snapshot") {
    if (!previewPublicState().open) {
      throw new Error("Preview is not open. Call preview_open first.");
    }
    return snapshotPreview();
  }
  if (method === "POST" && path === "/screenshot") {
    if (!previewPublicState().open) {
      throw new Error("Preview is not open. Call preview_open first.");
    }
    return screenshotPreview();
  }
  if (method === "POST" && path === "/click") {
    if (!previewPublicState().open) {
      throw new Error("Preview is not open. Call preview_open first.");
    }
    return runPreviewAction({
      action: "click",
      ref: body.ref || body.uid,
      selector: body.selector,
      name: body.name || body.text,
    });
  }
  if (method === "POST" && path === "/fill") {
    if (!previewPublicState().open) {
      throw new Error("Preview is not open. Call preview_open first.");
    }
    return runPreviewAction({
      action: "fill",
      ref: body.ref || body.uid,
      selector: body.selector,
      name: body.name || body.text,
      value: body.value,
    });
  }
  if (method === "POST" && path === "/press") {
    if (!previewPublicState().open) {
      throw new Error("Preview is not open. Call preview_open first.");
    }
    return runPreviewAction({
      action: "press",
      ref: body.ref || body.uid,
      selector: body.selector,
      name: body.name || body.text,
      key: body.key || "Enter",
    });
  }
  if (method === "POST" && path === "/viewport") {
    const id = String(body.id || body.viewport || "fluid");
    if (!VIEWPORTS[id]) {
      throw new Error(`Unknown viewport: ${id}`);
    }
    return setPreviewViewport(id);
  }
  if (
    (method === "GET" || method === "POST") &&
    (path === "/network" || path === "/network/log")
  ) {
    if (!previewPublicState().open) {
      throw new Error("Preview is not open. Call preview_open first.");
    }
    return snapshotPreviewNetwork({
      filter: body.filter,
      afterLoad: Boolean(body.afterLoad),
      limit: body.limit,
    });
  }
  const err = new Error(`Not found: ${method} ${path}`);
  err.statusCode = 404;
  throw err;
}

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch {
        resolve({});
      }
    });
  });
}

async function handleMcpHttp(req, res, rawBody) {
  const { handlePreviewMcpMessage } = await import("./preview-mcp-protocol.mjs");
  if (String(req.method || "").toUpperCase() === "GET") {
    res.writeHead(405, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "POST JSON-RPC to /mcp" }));
    return;
  }
  let msg = {};
  try {
    msg = rawBody ? JSON.parse(rawBody) : {};
  } catch {
    res.writeHead(400, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "invalid JSON" }));
    return;
  }
  const reply = await handlePreviewMcpMessage(msg);
  if (!reply) {
    res.writeHead(202);
    res.end();
    return;
  }
  res.writeHead(200, {
    "content-type": "application/json",
    "mcp-session-id": "desktop-preview",
  });
  res.end(JSON.stringify(reply));
}

/**
 * @param {{ getOwner?: () => import('electron').BrowserWindow | null }} [opts]
 * @returns {Promise<{ url: string, token: string, port: number } | null>}
 */
export function startPreviewApi(opts = {}) {
  if (opts.getOwner) getOwner = opts.getOwner;
  if (server && port) return Promise.resolve(previewApiAddress());

  token = token || crypto.randomBytes(24).toString("hex");
  if (server) {
    return new Promise((resolve) => {
      if (port) resolve(previewApiAddress());
      else server.once("listening", () => resolve(previewApiAddress()));
    });
  }

  server = http.createServer(async (req, res) => {
    const auth = String(req.headers.authorization || "");
    if (auth !== `Bearer ${token}`) {
      res.writeHead(401, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "unauthorized" }));
      return;
    }
    const url = new URL(req.url || "/", "http://127.0.0.1");
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", async () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (url.pathname === "/mcp") {
        try {
          await handleMcpHttp(req, res, raw);
        } catch (err) {
          if (!res.headersSent) {
            res.writeHead(500, { "content-type": "application/json" });
            res.end(JSON.stringify({ error: err?.message || String(err) }));
          }
        }
        return;
      }
      try {
        let body = {};
        if (raw) {
          try {
            body = JSON.parse(raw);
          } catch {
            body = {};
          }
        }
        const result = await dispatchPreviewApi({
          method: req.method,
          path: url.pathname,
          body,
        });
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify(result));
      } catch (err) {
        const status = Number(err?.statusCode) || 400;
        res.writeHead(status, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: err?.message || String(err) }));
      }
    });
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      port = addr && typeof addr === "object" ? addr.port : 0;
      resolve(previewApiAddress());
    });
  });
}

export function stopPreviewApi() {
  if (!server) return;
  try {
    server.close();
  } catch {
    /* ignore */
  }
  server = null;
  port = 0;
  token = "";
}
