import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  PreviewNetworkLog,
  entryName,
  formatBytes,
  formatDuration,
  formatNetworkDump,
  ingestWebRequest,
  matchesNetworkFilter,
  redactHeaders,
  resourceGroup,
  timingPhases,
} from "../electron/preview-network.mjs";

function req(log, id, url, extra = {}) {
  log.handleCdp("Network.requestWillBeSent", {
    requestId: id,
    timestamp: extra.ts ?? 1,
    type: extra.type || "Other",
    frameId: extra.frameId || "main",
    initiator: extra.initiator || { type: "parser" },
    request: {
      url,
      method: extra.method || "GET",
      headers: extra.reqHeaders || {},
    },
    redirectResponse: extra.redirectResponse,
  });
}

function res(log, id, status, extra = {}) {
  log.handleCdp("Network.responseReceived", {
    requestId: id,
    timestamp: extra.ts ?? 1.05,
    type: extra.type,
    response: {
      status,
      statusText: extra.statusText || "OK",
      mimeType: extra.mime || "text/plain",
      headers: extra.headers || {},
      fromDiskCache: extra.fromCache || false,
      timing: extra.timing,
      encodedDataLength: extra.encoded || 0,
    },
  });
}

function fin(log, id, extra = {}) {
  log.handleCdp("Network.loadingFinished", {
    requestId: id,
    timestamp: extra.ts ?? 1.2,
    encodedDataLength: extra.encoded ?? 1200,
  });
}

test("resourceGroup maps CDP types", () => {
  assert.equal(resourceGroup("Document"), "doc");
  assert.equal(resourceGroup("Script"), "js");
  assert.equal(resourceGroup("Image"), "img");
  assert.equal(resourceGroup("XHR"), "xhr");
  assert.equal(resourceGroup("Fetch"), "xhr");
  assert.equal(resourceGroup("Font", "font/woff2"), "font");
  assert.equal(resourceGroup("Other", "image/webp"), "img");
});

test("formatBytes / duration / name", () => {
  assert.equal(formatBytes(200), "200 B");
  assert.match(formatBytes(2048), /kB/);
  assert.equal(formatDuration(12), "12 ms");
  assert.match(formatDuration(1500), /s/);
  assert.equal(entryName("http://localhost:5173/assets/hero.webp?w=800"), "hero.webp?w=800");
});

test("redactHeaders strips cookies and auth", () => {
  const r = redactHeaders({
    Cookie: "sid=abc",
    Authorization: "Bearer x",
    "Content-Type": "application/json",
  });
  assert.equal(r.Cookie, "…");
  assert.equal(r.Authorization, "…");
  assert.equal(r["Content-Type"], "application/json");
});

test("request + response + finish become a row with duration", () => {
  const log = new PreviewNetworkLog();
  req(log, "1", "http://localhost:5173/", { type: "Document", ts: 10 });
  res(log, "1", 200, { ts: 10.04, mime: "text/html", type: "Document" });
  fin(log, "1", { ts: 10.2, encoded: 4096 });
  const snap = log.snapshot();
  assert.equal(snap.count, 1);
  assert.equal(snap.rows[0].status, 200);
  assert.equal(snap.rows[0].type, "doc");
  assert.equal(snap.rows[0].pending, false);
  assert.ok(Math.abs(snap.rows[0].durationMs - 200) < 0.5);
  assert.equal(snap.rows[0].size, 4096);
});

test("failed request is marked", () => {
  const log = new PreviewNetworkLog();
  req(log, "1", "http://localhost:5173/missing.png", { type: "Image", ts: 1 });
  log.handleCdp("Network.loadingFailed", {
    requestId: "1",
    timestamp: 1.3,
    errorText: "net::ERR_ABORTED",
    canceled: true,
    type: "Image",
  });
  const row = log.snapshot().rows[0];
  assert.equal(row.failed, true);
  assert.equal(row.canceled, true);
  assert.match(row.error, /ERR_ABORTED/);
  assert.equal(row.type, "img");
});

test("main-document navigation clears previous page unless preserve", () => {
  const log = new PreviewNetworkLog();
  req(log, "a", "http://localhost:5173/old", { type: "Document", ts: 1 });
  req(log, "b", "http://localhost:5173/old.css", {
    type: "Stylesheet",
    ts: 1.01,
  });
  req(log, "c", "http://localhost:5173/new", { type: "Document", ts: 5 });
  const snap = log.snapshot();
  assert.equal(snap.count, 1);
  assert.equal(snap.rows[0].url, "http://localhost:5173/new");

  log.setPreserveLog(true);
  req(log, "d", "http://localhost:5173/newer", { type: "Document", ts: 8 });
  assert.equal(log.snapshot().count, 2);
});

test("redirects emit a hop plus the final request", () => {
  const log = new PreviewNetworkLog();
  req(log, "1", "http://localhost:5173/go", { type: "Document", ts: 1 });
  req(log, "1", "http://localhost:5173/land", {
    type: "Document",
    ts: 1.1,
    redirectResponse: {
      url: "http://localhost:5173/go",
      status: 302,
      statusText: "Found",
      headers: { location: "/land" },
    },
  });
  res(log, "1", 200, { ts: 1.2, type: "Document", mime: "text/html" });
  fin(log, "1", { ts: 1.3, encoded: 100 });
  const rows = log.snapshot().rows;
  assert.equal(rows.length, 2);
  assert.equal(rows[0].status, 302);
  assert.equal(rows[1].status, 200);
  assert.equal(rows[1].url, "http://localhost:5173/land");
});

test("iframe documents do not wipe the main page", () => {
  const log = new PreviewNetworkLog();
  req(log, "main", "http://localhost:5173/", {
    type: "Document",
    ts: 1,
    frameId: "main",
  });
  req(log, "iframe", "http://ads.example/pixel", {
    type: "Document",
    ts: 1.2,
    frameId: "child",
  });
  assert.equal(log.snapshot().count, 2);
});

test("cache flag and extra info headers merge", () => {
  const log = new PreviewNetworkLog();
  req(log, "1", "http://localhost:5173/app.js", { type: "Script", ts: 1 });
  log.handleCdp("Network.requestServedFromCache", { requestId: "1" });
  res(log, "1", 200, {
    ts: 1.01,
    type: "Script",
    mime: "text/javascript",
    fromCache: true,
  });
  log.handleCdp("Network.responseReceivedExtraInfo", {
    requestId: "1",
    headers: { "x-cache": "HIT" },
  });
  fin(log, "1", { ts: 1.02, encoded: 80 });
  const row = log.snapshot().rows[0];
  assert.equal(row.fromCache, true);
  assert.match(row.sizeLabel, /cache/);
  assert.equal(log.detail("1").resHeaders["x-cache"], "HIT");
});

test("caps at MAX_NETWORK_ENTRIES", () => {
  const log = new PreviewNetworkLog();
  req(log, "doc", "http://localhost:5173/", { type: "Document", ts: 1 });
  for (let i = 0; i < 600; i++) {
    req(log, `x${i}`, `http://localhost:5173/i/${i}.png`, {
      type: "Image",
      ts: 1 + i / 1000,
    });
  }
  assert.equal(log.snapshot().count, 500);
});

test("afterLoad dump keeps only post-load rows", () => {
  const log = new PreviewNetworkLog();
  req(log, "doc", "http://localhost:5173/", { type: "Document", ts: 1 });
  res(log, "doc", 200, { ts: 1.05, type: "Document", mime: "text/html" });
  fin(log, "doc", { ts: 1.1, encoded: 800 });
  req(log, "js", "http://localhost:5173/app.js", { type: "Script", ts: 1.12 });
  fin(log, "js", { ts: 1.2, encoded: 4000 });
  log.handleCdp("Page.loadEventFired", { timestamp: 1.3 });
  req(log, "img", "http://localhost:5173/lazy.webp", {
    type: "Image",
    ts: 2.0,
    initiator: { type: "script", url: "http://localhost:5173/app.js" },
  });
  fin(log, "img", { ts: 2.05, encoded: 22000 });

  const snap = log.snapshot();
  const all = formatNetworkDump(snap);
  assert.match(all, /app\.js/);
  assert.match(all, /lazy\.webp/);
  assert.match(all, /Load /);

  const late = formatNetworkDump(snap, { afterLoad: true, filter: "img" });
  assert.match(late, /lazy\.webp/);
  assert.doesNotMatch(late, /app\.js/);
  assert.match(late, /started after window load/);
});

test("matchesNetworkFilter groups xhr+ws", () => {
  assert.equal(matchesNetworkFilter("xhr", "xhr"), true);
  assert.equal(matchesNetworkFilter("ws", "xhr"), true);
  assert.equal(matchesNetworkFilter("img", "xhr"), false);
  assert.equal(matchesNetworkFilter("img", "all"), true);
});

test("ingestWebRequest maps Electron resource types", () => {
  const log = new PreviewNetworkLog();
  ingestWebRequest(log, "start", {
    id: 7,
    url: "http://localhost:5173/hero.webp",
    method: "GET",
    timestamp: 2,
    resourceType: "image",
  });
  ingestWebRequest(log, "done", {
    id: 7,
    url: "http://localhost:5173/hero.webp",
    timestamp: 2.05,
    resourceType: "image",
    statusCode: 200,
    fromCache: false,
  });
  const row = log.snapshot().rows[0];
  assert.equal(row.type, "img");
  assert.equal(row.status, 200);
  assert.equal(row.pending, false);
});

test("timingPhases reads CDP ResourceTiming", () => {
  const phases = timingPhases(
    {
      dnsStart: 0,
      dnsEnd: 4,
      connectStart: 4,
      connectEnd: 20,
      sslStart: 8,
      sslEnd: 20,
      sendStart: 20,
      sendEnd: 21,
      receiveHeadersEnd: 40,
    },
    50,
  );
  assert.equal(phases[0].name, "DNS");
  assert.equal(phases[0].ms, 4);
  assert.equal(phases.at(-1).name, "Total");
});

test("desktop-preview skill mentions preview_network", () => {
  const skill = fs.readFileSync(
    new URL("../electron/preview/SKILL.md", import.meta.url),
    "utf8",
  );
  assert.match(skill, /desktop-preview__preview_network/);
  assert.match(skill, /afterLoad/);
});
