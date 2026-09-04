import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  estimateImageTokens,
  estimateTextTokens,
  formatPreviewCapturePrompt,
  normalizePreviewUrl,
} from "../electron/preview-url.mjs";
import {
  formatPreviewSnapshot,
  PAGE_SNAPSHOT_SCRIPT,
} from "../electron/preview-snapshot.mjs";
import {
  PREVIEW_MCP_TOOLS,
  SCREENSHOT_DISABLED_TEXT,
  callPreviewTool,
  PREVIEW_OWNER_HEADER,
  previewMcpHttpServers,
  previewOwnerHeaders,
  previewOwnerIdFromHeaders,
} from "../electron/preview-mcp-tools.mjs";
import {
  dispatchPreviewApi,
  previewApiRecognizes,
} from "../electron/preview-api.mjs";

test("normalizePreviewUrl adds http when scheme is missing", () => {
  const r = normalizePreviewUrl("localhost:5173/app");
  assert.equal(r.ok, true);
  assert.equal(r.href, "http://localhost:5173/app");
});

test("normalizePreviewUrl allows https", () => {
  const r = normalizePreviewUrl("https://example.com/x");
  assert.equal(r.ok, true);
  assert.equal(r.href, "https://example.com/x");
});

test("normalizePreviewUrl rejects file and javascript", () => {
  assert.equal(normalizePreviewUrl("file:///etc/passwd").ok, false);
  assert.equal(normalizePreviewUrl("javascript:alert(1)").ok, false);
  assert.equal(normalizePreviewUrl("data:text/html,hi").ok, false);
});

test("normalizePreviewUrl rejects empty", () => {
  assert.equal(normalizePreviewUrl("").ok, false);
  assert.equal(normalizePreviewUrl("   ").ok, false);
});

test("formatPreviewSnapshot is compact text", () => {
  const text = formatPreviewSnapshot({
    url: "http://localhost:5173/",
    title: "Demo",
    headings: ["Welcome"],
    text: "Welcome Sign in to continue",
    alerts: ["Invalid password"],
    nodes: [
      { ref: "e1", tag: "button", role: null, name: "Save", type: null },
      {
        ref: "e2",
        tag: "input",
        role: null,
        name: "Email",
        type: "email",
        value: "a@b.c",
      },
    ],
  });
  assert.match(text, /URL: http:\/\/localhost:5173\//);
  assert.match(text, /Title: Demo/);
  assert.match(text, /Visible text:/);
  assert.match(text, /Welcome Sign in to continue/);
  assert.match(text, /Invalid password/);
  assert.match(text, /\[e1\].*Save/);
  assert.match(text, /\[e2\].*input\/email/);
  assert.match(text, /a@b\.c/);
  assert.match(text, /preview_click/);
  assert.ok(text.length < 2000);
});

test("guest snapshot script collects innerText not pixels", () => {
  assert.match(PAGE_SNAPSHOT_SCRIPT, /innerText/);
  assert.match(PAGE_SNAPSHOT_SCRIPT, /alerts/);
  assert.doesNotMatch(PAGE_SNAPSHOT_SCRIPT, /capturePage|toDataURL|screenshot/i);
});

test("MCP advertises HTTP snapshot tools, not screenshot", () => {
  const names = PREVIEW_MCP_TOOLS.map((t) => t.name);
  assert.ok(names.includes("preview_snapshot"));
  assert.ok(names.includes("preview_open"));
  assert.equal(names.includes("preview_screenshot"), false);
  const servers = previewMcpHttpServers({
    url: "http://127.0.0.1:9",
    token: "t",
  });
  assert.equal(servers.length, 1);
  assert.equal(servers[0].type, "http");
  assert.equal(servers[0].name, "desktop-preview");
  assert.equal(previewMcpHttpServers({}).length, 0);
});

test("preview MCP stamps the owning BrowserWindow id on HTTP headers", () => {
  assert.deepEqual(previewOwnerHeaders(42), [
    { name: PREVIEW_OWNER_HEADER, value: "42" },
  ]);
  assert.deepEqual(previewOwnerHeaders(0), []);
  assert.deepEqual(previewOwnerHeaders("nope"), []);
  const servers = previewMcpHttpServers(
    { url: "http://127.0.0.1:9", token: "t" },
    7,
  );
  assert.deepEqual(servers[0].headers, [
    { name: "Authorization", value: "Bearer t" },
    { name: PREVIEW_OWNER_HEADER, value: "7" },
  ]);
  assert.equal(
    previewOwnerIdFromHeaders({ "x-grok-desktop-window": "7" }),
    7,
  );
  assert.equal(
    previewOwnerIdFromHeaders({ [PREVIEW_OWNER_HEADER]: "7" }),
    7,
  );
  assert.equal(previewOwnerIdFromHeaders({}), null);
  assert.equal(previewOwnerIdFromHeaders({ "x-grok-desktop-window": "0" }), null);
});

test("preview_screenshot does not dispatch a JPEG capture", async () => {
  const calls = [];
  const dispatch = async (req) => {
    calls.push(req);
    return { text: "URL: x", chars: 6 };
  };
  const result = await callPreviewTool("preview_screenshot", {}, dispatch);
  assert.equal(
    result.content.every((c) => c.type === "text"),
    true,
  );
  assert.equal(result.content.some((c) => c.type === "image"), false);
  assert.equal(result.content[0].text, SCREENSHOT_DISABLED_TEXT);
  assert.equal(
    calls.some((c) => c.path === "/screenshot"),
    false,
  );
});

test("dispatchPreviewApi POST /screenshot 404s with no JPEG data", async () => {
  assert.equal(previewApiRecognizes("POST", "/snapshot"), true);
  assert.equal(previewApiRecognizes("POST", "/screenshot"), false);
  const err = await dispatchPreviewApi({
    method: "POST",
    path: "/screenshot",
  }).then(
    (result) => {
      assert.equal(result?.data, undefined);
      throw new Error("expected 404, got result");
    },
    (e) => e,
  );
  assert.equal(err.statusCode, 404);
  assert.match(String(err.message), /Not found: POST \/screenshot/);
  assert.equal(err.data, undefined);
});

test("capture delivery is in usePromptDelivery, not App", () => {
  const app = fs.readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
  const hook = fs.readFileSync(
    new URL("../src/hooks/usePromptDelivery.ts", import.meta.url),
    "utf8",
  );
  const capture = fs.readFileSync(
    new URL("../shared/preview-capture.mjs", import.meta.url),
    "utf8",
  );
  const preload = fs.readFileSync(
    new URL("../electron/preload.cjs", import.meta.url),
    "utf8",
  );
  const win = fs.readFileSync(
    new URL("../electron/preview-window.mjs", import.meta.url),
    "utf8",
  );
  const chrome = fs.readFileSync(
    new URL("../electron/preview/preview.js", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(app, /preview:viewport-capture/);
  assert.doesNotMatch(app, /pendingImageFromBase64/);
  assert.match(hook, /preview:viewport-capture/);
  assert.match(hook, /previewCaptureToSubmit/);
  assert.match(hook, /submitFromComposer\(parsed\.submit\)/);
  assert.match(capture, /mode: "auto"/);
  assert.match(capture, /imageQuality: "compact"/);
  assert.match(preload, /"preview:viewport-capture"/);
  assert.doesNotMatch(preload, /previewScreenshot/);
  assert.doesNotMatch(win, /ipcMain\.handle\(["']preview:screenshot["']/);
  assert.match(win, /ipcMain\.handle\(["']preview:chrome-screenshot["']/);
  assert.match(win, /sendPreviewCaptureToChat/);
  const mcp = fs.readFileSync(
    new URL("../electron/preview-mcp-tools.mjs", import.meta.url),
    "utf8",
  );
  const acp = fs.readFileSync(
    new URL("../electron/acp-client.mjs", import.meta.url),
    "utf8",
  );
  assert.match(mcp, /X-Grok-Desktop-Window/);
  assert.match(acp, /desktopPreviewMcpServers\(this\.windowId\)/);
  assert.match(chrome, /Handed to chat/);
  assert.doesNotMatch(chrome, /Sent to chat ·/);
});

test("preview_open returns a text snapshot, not a JPEG", async () => {
  const calls = [];
  const dispatch = async (req) => {
    calls.push(req);
    if (req.path === "/open") return { url: "http://x/", title: "T" };
    if (req.path === "/snapshot") {
      return { text: "URL: http://x/\nTitle: T", chars: 22 };
    }
    return {};
  };
  const result = await callPreviewTool(
    "preview_open",
    { url: "http://x/" },
    dispatch,
  );
  assert.match(result.content[0].text, /URL: http:\/\/x\//);
  assert.ok(calls.some((c) => c.path === "/snapshot"));
  assert.equal(
    calls.some((c) => c.path === "/screenshot"),
    false,
  );
});

test("desktop-preview skill names the Preview MCP tools", () => {
  const skill = fs.readFileSync(
    new URL("../electron/preview/SKILL.md", import.meta.url),
    "utf8",
  );
  assert.match(skill, /desktop-preview__preview_open/);
  assert.match(skill, /desktop-preview__preview_fill/);
  assert.match(skill, /preview_fill_form/);
  assert.match(skill, /desktop-preview__preview_network/);
  assert.match(skill, /PowerShell/);
  assert.match(skill, /cloakbrowser/i);
  assert.match(skill, /Read text/);
  assert.match(skill, /Send screenshot/);
  assert.match(skill, /Do not call `preview_screenshot`/);
});

test("user capture caption names the URL", () => {
  assert.equal(
    formatPreviewCapturePrompt({ url: "http://localhost:5173/app" }),
    "Preview viewport capture (http://localhost:5173/app).",
  );
  assert.equal(formatPreviewCapturePrompt({ url: "about:blank" }), "Preview viewport capture.");
  assert.equal(formatPreviewCapturePrompt({}), "Preview viewport capture.");
});

test("token heuristics stay in the expected ballpark", () => {
  assert.equal(estimateTextTokens("abcd".repeat(25)), 25);
  const img = estimateImageTokens(1280, 800);
  assert.ok(img >= 1000 && img <= 2500);
});
