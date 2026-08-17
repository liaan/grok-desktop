/**
 * Live MCP status overlay — TUI /mcps labels and Sign-in gating.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyMcpServerStatus,
  summarizeMcpDoctorDetail,
  isDesktopInternalMcp,
  mapMcpSessionCatalog,
  mcpLiveLabel,
  mcpNeedsSignIn,
  mergeMcpLiveStatus,
  normalizeMcpLiveStatus,
  resolveMcpCardStatus,
} from "../shared/mcp-status.mjs";

test("normalizeMcpLiveStatus matches TUI /mcps tokens", () => {
  assert.equal(normalizeMcpLiveStatus("ready"), "ready");
  assert.equal(normalizeMcpLiveStatus("initializing"), "initializing");
  assert.equal(normalizeMcpLiveStatus("unavailable"), "unavailable");
  assert.equal(normalizeMcpLiveStatus("needsauth"), "needs-auth");
  assert.equal(normalizeMcpLiveStatus("needs_auth"), "needs-auth");
  assert.equal(normalizeMcpLiveStatus("needs auth"), "needs-auth");
  assert.equal(mcpLiveLabel("needs-auth"), "needs auth");
  assert.equal(mcpLiveLabel("initializing"), "initializing");
});

test("mapMcpSessionCatalog never copies env values and flags needs auth", () => {
  const rows = mapMcpSessionCatalog({
    servers: [
      {
        name: "mysql",
        type: "stdio",
        command: "npx",
        env: [{ name: "DB_PASS", value: "SECRET" }],
        session: { enabled: true, status: "ready", tools: ["query"] },
      },
      {
        name: "DOLSlackChat",
        type: "http",
        url: "https://example/mcp",
        session: { enabled: true, status: "unavailable", authRequired: true },
      },
    ],
  });
  assert.equal(rows[0].liveStatus, "ready");
  assert.equal(rows[0].liveToolCount, 1);
  assert.equal(rows[1].liveStatus, "needs-auth");
  assert.equal(rows[1].authRequired, true);
  assert.equal(JSON.stringify(rows).includes("SECRET"), false);
});

test("mergeMcpLiveStatus assumes initializing until ACP reports, then overlays", () => {
  const listed = [
    {
      name: "mysql",
      enabled: true,
      liveStatus: null,
      authRequired: false,
    },
    {
      name: "DOLSlackChat",
      enabled: true,
      liveStatus: null,
      authRequired: false,
    },
    {
      name: "off",
      enabled: false,
      liveStatus: null,
    },
  ];
  const pending = mergeMcpLiveStatus(listed, [], { assumeInitializing: true });
  assert.equal(pending[0].liveStatus, "initializing");
  assert.equal(pending[1].liveStatus, "initializing");
  assert.equal(pending[2].liveStatus, "unavailable");

  const unmatched = mergeMcpLiveStatus(listed, [
    { name: "other", liveStatus: "ready", authRequired: false },
  ], { assumeInitializing: true });
  assert.equal(
    unmatched[0].liveStatus,
    null,
    "do not keep initializing when a live catalog exists but this name is absent",
  );

  const live = mergeMcpLiveStatus(
    listed,
    [
      { name: "mysql", liveStatus: "ready", authRequired: false },
      { name: "DOLSlackChat", liveStatus: "needs-auth", authRequired: true },
    ],
    { assumeInitializing: true },
  );
  assert.equal(live[0].liveStatus, "ready");
  assert.equal(live[1].liveStatus, "needs-auth");
});

test("mergeMcpLiveStatus adds managed catalog rows and skips desktop-preview", () => {
  const merged = mergeMcpLiveStatus(
    [{ name: "mysql", enabled: true }],
    [
      { name: "mysql", liveStatus: "ready", authRequired: false },
      {
        name: "managed_gateway:automations",
        liveStatus: "ready",
        authRequired: false,
        source: "managed",
      },
      { name: "desktop-preview", liveStatus: "ready", authRequired: false },
    ],
  );
  assert.equal(
    merged.some((s) => s.name === "managed_gateway:automations"),
    true,
  );
  assert.equal(
    merged.some((s) => s.name === "desktop-preview"),
    false,
  );
  assert.equal(isDesktopInternalMcp("desktop-preview-stdio"), true);
});

test("mcpNeedsSignIn is false for ready HTTP servers", () => {
  assert.equal(mcpNeedsSignIn({ liveStatus: "ready", authRequired: false }), false);
  assert.equal(
    mcpNeedsSignIn({ liveStatus: "initializing", authRequired: false }),
    false,
  );
  assert.equal(
    mcpNeedsSignIn({ liveStatus: "unavailable", authRequired: false }),
    false,
  );
  assert.equal(mcpNeedsSignIn({ liveStatus: "needs-auth" }), true);
  assert.equal(mcpNeedsSignIn({ liveStatus: "ready" }, { needsAuth: true }), true);
});

test("resolveMcpCardStatus prefers live status and Test overlay", () => {
  assert.equal(resolveMcpCardStatus({ liveStatus: "ready" }), "ready");
  assert.equal(resolveMcpCardStatus({ liveStatus: null }), "unknown");
  assert.equal(
    resolveMcpCardStatus({ liveStatus: "ready", enabled: false }),
    "unavailable",
  );
  assert.equal(
    resolveMcpCardStatus({ liveStatus: "ready" }, { needsAuth: true }),
    "needs-auth",
  );
  assert.equal(
    resolveMcpCardStatus({ liveStatus: null }, { status: "fail" }),
    "unavailable",
  );
  assert.equal(mcpLiveLabel("unknown"), "unknown");
});

test("summarizeMcpDoctorDetail hides rmcp type dumps", () => {
  assert.equal(
    summarizeMcpDoctorDetail(
      "Send message error Transport [rmcp::transport::worker::WorkerTransport<rmcp::transport::streamable_http_client::StreamableHttpClientWorker<xai_grok_mcp::mcp_http_client::McpHttpClient<rmcp::transport::auth::AuthClient<reqwest::async_impl::client::Client>>>>] error: Auth error: OAuth authorization required, when send initialize request",
    ),
    "OAuth sign-in required",
  );
  assert.equal(
    summarizeMcpDoctorDetail(
      "Failed to get tools after auth: MCP server 'DOLStagingDeploy' handshake failed: Auth required, when send initialize request",
    ),
    "Signed in, but the server still rejected the handshake",
  );
  assert.equal(summarizeMcpDoctorDetail("1.9s"), "1.9s");
  assert.equal(summarizeMcpDoctorDetail(""), null);
});

test("applyMcpServerStatus patches initializing to ready", () => {
  const next = applyMcpServerStatus(
    { name: "mysql", liveStatus: "initializing", authRequired: false },
    { name: "mysql", status: "ready" },
  );
  assert.equal(next.liveStatus, "ready");
  const auth = applyMcpServerStatus(
    { name: "slack", liveStatus: "initializing" },
    { status: "needsauth" },
  );
  assert.equal(auth.liveStatus, "needs-auth");
  assert.equal(auth.authRequired, true);
});