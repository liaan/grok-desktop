/**
 * grok-cli JSON parse + runGrok exit / missing-binary contract.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  assertMcpName,
  assertPluginName,
  assertPluginSource,
  checkGrokUpdate,
  isMissingGrokBinaryError,
  listMcpServers,
  listPlugins,
  mapMcpServerRow,
  mapPluginRow,
  mcpAddArgv,
  mcpDisableArgv,
  mcpDoctorArgv,
  mcpDoctorFromData,
  mcpEnableArgv,
  mcpListArgv,
  mcpRemoveArgv,
  mcpServersFromData,
  missingGrokBinaryMessage,
  parseGrokJson,
  pluginDisableArgv,
  pluginEnableArgv,
  pluginInstallArgv,
  pluginListArgv,
  pluginsFromData,
  runGrok,
  updateFromData,
  versionFromData,
} from "../electron/grok-cli.mjs";

test("parseGrokJson reads a bare object", () => {
  assert.deepEqual(parseGrokJson('{"currentVersion":"1.0.3"}'), {
    currentVersion: "1.0.3",
  });
});

test("parseGrokJson extracts an object wrapped in log noise", () => {
  assert.deepEqual(
    parseGrokJson('checking…\n{"updateAvailable":true,"latestVersion":"2.0.0"}\n'),
    { updateAvailable: true, latestVersion: "2.0.0" },
  );
});

test("parseGrokJson throws on empty or non-json", () => {
  assert.throws(() => parseGrokJson(""), /Empty grok output/);
  assert.throws(() => parseGrokJson("not json"), /Failed to parse grok JSON/);
});

test("parseGrokJson reads a bare array (grok mcp list --json)", () => {
  assert.deepEqual(parseGrokJson("[]"), []);
  assert.deepEqual(parseGrokJson('log\n[{"name":"fs"}]\n'), [{ name: "fs" }]);
});

test("versionFromData prefers currentVersion", () => {
  assert.equal(versionFromData({ currentVersion: "1.0.3 (abc)" }), "1.0.3 (abc)");
  assert.equal(versionFromData({ version: "9" }), "9");
  assert.equal(versionFromData({ grokVersion: "8" }), "8");
  assert.equal(versionFromData(null), null);
  assert.equal(versionFromData({}), null);
});

test("updateFromData maps grok update --check --json", () => {
  assert.deepEqual(
    updateFromData({
      currentVersion: "1.0.3",
      latestVersion: "1.0.4",
      updateAvailable: true,
      channel: "stable",
    }),
    {
      currentVersion: "1.0.3",
      latestVersion: "1.0.4",
      updateAvailable: true,
      channel: "stable",
    },
  );
  assert.equal(updateFromData(null).updateAvailable, false);
});

test("isMissingGrokBinaryError matches ENOENT and install copy", () => {
  assert.equal(isMissingGrokBinaryError({ code: "ENOENT", message: "spawn grok" }), true);
  assert.equal(isMissingGrokBinaryError(new Error("spawn grok ENOENT")), true);
  assert.equal(
    isMissingGrokBinaryError(new Error(missingGrokBinaryMessage("/opt/grok"))),
    true,
  );
  assert.equal(isMissingGrokBinaryError(new Error("Agent exited (code=1)")), false);
});

test("runGrok json:true parses stdout from a fake binary", async () => {
  const r = await runGrok(
    ["-e", "console.log(JSON.stringify({currentVersion:'1.2.3'}))"],
    { bin: process.execPath, json: true, env: process.env },
  );
  assert.equal(r.ok, true);
  assert.equal(r.code, 0);
  assert.equal(r.data.currentVersion, "1.2.3");
  assert.equal(r.error, null);
});

test("runGrok non-zero exit is not ok", async () => {
  const r = await runGrok(["-e", "console.error('fail'); process.exit(3)"], {
    bin: process.execPath,
    env: process.env,
  });
  assert.equal(r.ok, false);
  assert.equal(r.code, 3);
  assert.match(r.stderr, /fail/);
  assert.match(String(r.error), /fail|exited 3/);
});

test("runGrok json:true with non-json stdout is not ok", async () => {
  const r = await runGrok(["-e", "console.log('nope')"], {
    bin: process.execPath,
    json: true,
    env: process.env,
  });
  assert.equal(r.ok, false);
  assert.equal(r.data, null);
  assert.match(String(r.error), /parse grok JSON/i);
});

test("runGrok missing binary returns CLI-not-found", async () => {
  const bin = path.join(os.tmpdir(), "grok-desktop-missing-bin-xyz");
  const r = await runGrok(["version"], { bin, env: process.env });
  assert.equal(r.ok, false);
  assert.equal(r.data, null);
  assert.equal(isMissingGrokBinaryError({ message: r.error }), true);
});

test("checkGrokUpdate on a missing binary does not throw", async () => {
  const chk = await checkGrokUpdate({
    bin: path.join(os.tmpdir(), "grok-desktop-missing-update"),
    timeoutMs: 4000,
  });
  assert.equal(chk.ok, false);
  assert.equal(chk.updateAvailable, false);
  assert.equal(chk.currentVersion, null);
  assert.equal(chk.data, null);
});

/** Probed from `grok mcp list --json` (project-scope add) on Grok 1.0.3. */
const MCP_LIST_FIXTURE = [
  {
    command: "/usr/bin/true",
    args: ["--flag", "value"],
    enabled: true,
    name: "probe-stdio",
    scope: "project",
  },
  {
    url: "https://example.invalid/mcp",
    headers: { Authorization: "Bearer SECRET_TOKEN" },
    enabled: true,
    name: "probe-http",
    scope: "project",
  },
  {
    command: "/usr/bin/echo",
    args: ["hello"],
    env: { API_KEY: "supersecret" },
    enabled: true,
    name: "probe-env",
    scope: "project",
  },
];

test("mcp argv builders match CLI grok mcp add/enable/disable/remove/doctor", () => {
  assert.deepEqual(mcpListArgv(), ["mcp", "list", "--json"]);
  assert.deepEqual(mcpEnableArgv("github"), ["mcp", "enable", "github"]);
  assert.deepEqual(mcpDisableArgv("github"), ["mcp", "disable", "github"]);
  assert.deepEqual(mcpRemoveArgv("github"), ["mcp", "remove", "github"]);
  assert.deepEqual(mcpRemoveArgv("github", { scope: "project" }), [
    "mcp",
    "remove",
    "github",
    "--scope",
    "project",
  ]);
  assert.deepEqual(mcpDoctorArgv(), ["mcp", "doctor", "--json"]);
  assert.deepEqual(mcpDoctorArgv("github"), [
    "mcp",
    "doctor",
    "--json",
    "github",
  ]);

  assert.deepEqual(
    mcpAddArgv({
      name: "filesystem",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"],
    }),
    [
      "mcp",
      "add",
      "filesystem",
      "--",
      "npx",
      "-y",
      "@modelcontextprotocol/server-filesystem",
      "/tmp",
    ],
  );
  assert.deepEqual(
    mcpAddArgv({
      name: "postgres",
      command: "npx",
      args: ["-y", "@pkg"],
      env: [{ key: "DATABASE_URL", value: "postgres://localhost/mydb" }],
    }),
    [
      "mcp",
      "add",
      "-e",
      "DATABASE_URL=postgres://localhost/mydb",
      "postgres",
      "--",
      "npx",
      "-y",
      "@pkg",
    ],
  );
  assert.deepEqual(
    mcpAddArgv({
      name: "sentry",
      transport: "http",
      url: "https://mcp.sentry.dev/mcp",
    }),
    ["mcp", "add", "--transport", "http", "sentry", "https://mcp.sentry.dev/mcp"],
  );
  assert.deepEqual(
    mcpAddArgv({
      name: "api",
      transport: "http",
      url: "https://mcp.example.com/mcp",
      headers: [{ name: "Authorization", value: "Bearer YOUR_TOKEN" }],
      scope: "project",
    }),
    [
      "mcp",
      "add",
      "--transport",
      "http",
      "--scope",
      "project",
      "--header",
      "Authorization: Bearer YOUR_TOKEN",
      "api",
      "https://mcp.example.com/mcp",
    ],
  );
});

test("mcp argv builders reject unsafe names and never splice extra grok flags", () => {
  assert.throws(() => assertMcpName(""), /required/);
  assert.throws(() => assertMcpName("bad name"), /letters/);
  assert.throws(() => mcpEnableArgv("--help"), /letters/);
  assert.throws(() => mcpAddArgv({ name: "x", command: "npx -y foo" }), /single argv/);
  assert.throws(
    () => mcpAddArgv({ name: "x", transport: "http" }),
    /requires a URL/,
  );
  const argv = mcpAddArgv({
    name: "ok",
    command: "npx",
    args: ["-y", "--help"],
  });
  assert.deepEqual(argv.slice(0, 4), ["mcp", "add", "ok", "--"]);
  assert.ok(!argv.includes("--json"));
});

test("mcpServersFromData maps grok mcp list --json fixture and strips secrets", () => {
  const mapped = mcpServersFromData(MCP_LIST_FIXTURE);
  assert.equal(mapped.length, 3);
  assert.deepEqual(mapped[0], {
    name: "probe-stdio",
    transport: "stdio",
    enabled: true,
    scope: "project",
    command: "/usr/bin/true",
    args: ["--flag", "value"],
    url: null,
    envKeys: [],
    headerKeys: [],
    source: null,
  });
  assert.equal(mapped[1].name, "probe-http");
  assert.equal(mapped[1].transport, "http");
  assert.equal(mapped[1].url, "https://example.invalid/mcp");
  assert.deepEqual(mapped[1].headerKeys, ["Authorization"]);
  assert.deepEqual(mapped[2].envKeys, ["API_KEY"]);
  const dumped = JSON.stringify(mapped);
  assert.equal(dumped.includes("SECRET_TOKEN"), false);
  assert.equal(dumped.includes("supersecret"), false);
});

/** Probed from `grok mcp doctor --json figma` on Grok 1.0.3. */
const MCP_DOCTOR_FIXTURE = {
  sources: [
    { path: "~/.grok/config.toml", status: { status: "found", server_count: 1 } },
  ],
  servers: [
    {
      name: "figma",
      transport: "http",
      target: "https://mcp.figma.com/mcp",
      source: "plugin: figma",
      checks: [
        { label: "server started", passed: true, detail: "1.9s" },
        { label: "handshake OK", passed: true, detail: "protocol 2025-11-25" },
        { label: "32 tools discovered", passed: true, detail: "" },
      ],
      healthy: true,
    },
    {
      name: "broken",
      transport: "stdio",
      target: "/usr/bin/false",
      source: { type: "configToml", path: "/tmp/config.toml" },
      checks: [{ label: "server started", passed: false, detail: "timeout" }],
      healthy: false,
    },
  ],
  healthy_count: 1,
  failing_count: 1,
};

test("mcpDoctorFromData maps grok mcp doctor --json and extracts tool count", () => {
  const report = mcpDoctorFromData(MCP_DOCTOR_FIXTURE);
  assert.equal(report.healthyCount, 1);
  assert.equal(report.failingCount, 1);
  assert.equal(report.servers.length, 2);
  assert.deepEqual(report.servers[0], {
    name: "figma",
    transport: "http",
    target: "https://mcp.figma.com/mcp",
    source: "plugin: figma",
    healthy: true,
    checks: [
      { label: "server started", passed: true, detail: "1.9s" },
      { label: "handshake OK", passed: true, detail: "protocol 2025-11-25" },
      { label: "32 tools discovered", passed: true, detail: null },
    ],
    tools: [],
    toolCount: 32,
  });
  assert.equal(report.servers[1].healthy, false);
  assert.equal(report.servers[1].source, "/tmp/config.toml");
});

test("mcpDoctorFromData lists tool names when the CLI includes them", () => {
  const report = mcpDoctorFromData({
    servers: [
      {
        name: "github",
        healthy: true,
        tools: [
          { name: "create_issue", description: "secret schema" },
          "list_pull_requests",
        ],
        checks: [{ label: "2 tools discovered", passed: true, detail: "" }],
      },
    ],
    healthy_count: 1,
    failing_count: 0,
  });
  assert.deepEqual(report.servers[0].tools, [
    "create_issue",
    "list_pull_requests",
  ]);
  assert.equal(report.servers[0].toolCount, 2);
  assert.equal(JSON.stringify(report).includes("secret schema"), false);
});

test("listMcpServers result never includes raw data/stdout or env secrets", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "grok-mcp-"));
  const bin = path.join(dir, "grok");
  fs.writeFileSync(
    bin,
    `#!/usr/bin/env node
const args = process.argv.slice(2).join(" ");
if (args.includes("mcp list")) {
  console.log(${JSON.stringify(JSON.stringify(MCP_LIST_FIXTURE))});
  process.exit(0);
}
process.exit(2);
`,
  );
  fs.chmodSync(bin, 0o755);
  const res = await listMcpServers({ bin, timeoutMs: 8000 });
  assert.equal(res.ok, true);
  assert.equal(res.source, "list");
  assert.equal(res.servers.length, 3);
  assert.equal("data" in res, false);
  assert.equal("stdout" in res, false);
  assert.deepEqual(res.servers[2].envKeys, ["API_KEY"]);
  const dumped = JSON.stringify(res);
  assert.equal(dumped.includes("SECRET_TOKEN"), false);
  assert.equal(dumped.includes("supersecret"), false);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("mapMcpServerRow is defensive on inspect-shaped and unknown fields", () => {
  const inspectRow = mapMcpServerRow({
    name: "probe-stdio",
    transport: "stdio",
    target: "/usr/bin/true",
    source: { type: "configToml", path: "/tmp/.grok/config.toml" },
    extra: { ignore: true },
  });
  assert.equal(inspectRow.name, "probe-stdio");
  assert.equal(inspectRow.transport, "stdio");
  assert.equal(inspectRow.enabled, null);
  assert.equal(inspectRow.source, "configToml");

  assert.equal(mapMcpServerRow(null).name, "");
  assert.equal(mapMcpServerRow({ weird: 1 }).name, "");
  assert.deepEqual(mcpServersFromData({ mcpServers: [{ name: "a" }] }).map((s) => s.name), [
    "a",
  ]);
  assert.deepEqual(mcpServersFromData({ servers: [{ id: "b" }] }).map((s) => s.name), [
    "b",
  ]);
  assert.deepEqual(mcpServersFromData("nope"), []);
});

test("listMcpServers falls back to inspect when list JSON is empty", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "grok-mcp-"));
  const bin = path.join(dir, "grok");
  fs.writeFileSync(
    bin,
    `#!/usr/bin/env node
const args = process.argv.slice(2).join(" ");
if (args.includes("mcp list")) {
  console.log("[]");
  process.exit(0);
}
if (args.includes("inspect")) {
  console.log(JSON.stringify({
    mcpServers: [{ name: "from-inspect", transport: "stdio" }],
  }));
  process.exit(0);
}
process.exit(2);
`,
  );
  fs.chmodSync(bin, 0o755);
  const res = await listMcpServers({ bin, timeoutMs: 8000 });
  assert.equal(res.ok, true);
  assert.equal(res.source, "inspect");
  assert.equal(res.servers[0]?.name, "from-inspect");
  fs.rmSync(dir, { recursive: true, force: true });
});

/** Probed from `grok plugin list --available --json` (installed rows drop status=available). */
const PLUGIN_LIST_FIXTURE = [
  {
    status: "enabled",
    name: "deploy-tools",
    version: "1.2.0",
    description: "Deploy helpers",
    marketplace: "xAI Official",
    skill_count: 3,
    has_hooks: true,
    has_agents: false,
    has_mcp: false,
    components: { skills: [{ name: "release", description: "secret-not-leaked" }] },
  },
  {
    status: "disabled",
    name: "noisy-plugin",
    version: null,
    description: "Noisy",
    marketplace: null,
    skill_count: 0,
    has_hooks: false,
    has_agents: false,
    has_mcp: false,
  },
  {
    status: "available",
    name: "vercel",
    version: null,
    description: "Marketplace-only; not installed",
    marketplace: "xAI Official",
    skill_count: 0,
    has_hooks: false,
    has_agents: false,
    has_mcp: false,
  },
];

test("plugin argv builders match CLI grok plugin list/enable/disable/install", () => {
  assert.deepEqual(pluginListArgv(), ["plugin", "list", "--json"]);
  assert.deepEqual(pluginEnableArgv("deploy-tools"), [
    "plugin",
    "enable",
    "deploy-tools",
  ]);
  assert.deepEqual(pluginDisableArgv("deploy-tools"), [
    "plugin",
    "disable",
    "deploy-tools",
  ]);
  assert.deepEqual(pluginEnableArgv("user/a1b2c3d4/team-tools"), [
    "plugin",
    "enable",
    "user/a1b2c3d4/team-tools",
  ]);
  assert.deepEqual(
    pluginInstallArgv("https://github.com/org/plugin.git"),
    ["plugin", "install", "--trust", "https://github.com/org/plugin.git"],
  );
  assert.deepEqual(pluginInstallArgv("owner/repo@v1.0"), [
    "plugin",
    "install",
    "--trust",
    "owner/repo@v1.0",
  ]);
  assert.deepEqual(pluginInstallArgv("owner/repo#subdir"), [
    "plugin",
    "install",
    "--trust",
    "owner/repo#subdir",
  ]);
  assert.deepEqual(pluginInstallArgv("owner/repo", { trust: false }), [
    "plugin",
    "install",
    "owner/repo",
  ]);
});

test("plugin argv builders reject unsafe names/sources and never splice extra grok flags", () => {
  assert.throws(() => assertPluginName(""), /required/);
  assert.throws(() => assertPluginName("--help"), /letters/);
  assert.throws(() => assertPluginName("../escape"), /letters/);
  assert.throws(() => pluginEnableArgv("--help"), /letters/);
  assert.throws(() => assertPluginSource(""), /required/);
  assert.throws(() => assertPluginSource("--trust"), /must not start with -/);
  assert.throws(() => pluginInstallArgv("owner/repo extra"), /single argv/);
  assert.throws(() => pluginInstallArgv("-e evil=1"), /must not start with -/);
  const argv = pluginInstallArgv("https://github.com/org/plugin.git");
  assert.deepEqual(argv.slice(0, 3), ["plugin", "install", "--trust"]);
  assert.ok(!argv.includes("--json"));
  assert.ok(!argv.includes("--available"));
});

test("pluginsFromData maps grok plugin list fixture and drops available + components", () => {
  const mapped = pluginsFromData(PLUGIN_LIST_FIXTURE);
  assert.equal(mapped.length, 2);
  assert.deepEqual(mapped[0], {
    name: "deploy-tools",
    enabled: true,
    status: "enabled",
    version: "1.2.0",
    description: "Deploy helpers",
    marketplace: "xAI Official",
    source: "xAI Official",
    skillCount: 3,
    hasHooks: true,
    hasAgents: false,
    hasMcp: false,
  });
  assert.equal(mapped[1].name, "noisy-plugin");
  assert.equal(mapped[1].enabled, false);
  assert.equal(mapped[1].status, "disabled");
  const dumped = JSON.stringify(mapped);
  assert.equal(dumped.includes("secret-not-leaked"), false);
  assert.equal(dumped.includes("components"), false);
});

test("mapPluginRow is defensive on inspect-shaped and unknown fields", () => {
  const inspectRow = mapPluginRow({
    name: "from-inspect",
    source: { type: "installed" },
    extra: { ignore: true },
  });
  assert.equal(inspectRow.name, "from-inspect");
  assert.equal(inspectRow.enabled, null);
  assert.equal(inspectRow.source, "installed");

  assert.equal(mapPluginRow(null).name, "");
  assert.equal(mapPluginRow({ weird: 1 }).name, "");
  assert.deepEqual(pluginsFromData({ plugins: [{ name: "a" }] }).map((p) => p.name), [
    "a",
  ]);
  assert.deepEqual(pluginsFromData("nope"), []);
});

test("listPlugins result never includes raw data/stdout or component inventory", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "grok-plugin-"));
  const bin = path.join(dir, "grok");
  fs.writeFileSync(
    bin,
    `#!/usr/bin/env node
const args = process.argv.slice(2).join(" ");
if (args.includes("plugin list")) {
  console.log(${JSON.stringify(JSON.stringify(PLUGIN_LIST_FIXTURE))});
  process.exit(0);
}
process.exit(2);
`,
  );
  fs.chmodSync(bin, 0o755);
  const res = await listPlugins({ bin, timeoutMs: 8000 });
  assert.equal(res.ok, true);
  assert.equal(res.source, "list");
  assert.equal(res.plugins.length, 2);
  assert.equal("data" in res, false);
  assert.equal("stdout" in res, false);
  assert.equal(res.plugins[0].name, "deploy-tools");
  const dumped = JSON.stringify(res);
  assert.equal(dumped.includes("secret-not-leaked"), false);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("listPlugins falls back to inspect when list JSON is unparseable", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "grok-plugin-"));
  const bin = path.join(dir, "grok");
  fs.writeFileSync(
    bin,
    `#!/usr/bin/env node
const args = process.argv.slice(2).join(" ");
if (args.includes("plugin list")) {
  console.log("not json");
  process.exit(0);
}
if (args.includes("inspect")) {
  console.log(JSON.stringify({
    plugins: [{ name: "from-inspect" }],
  }));
  process.exit(0);
}
process.exit(2);
`,
  );
  fs.chmodSync(bin, 0o755);
  const res = await listPlugins({ bin, timeoutMs: 8000 });
  assert.equal(res.ok, true);
  assert.equal(res.source, "inspect");
  assert.equal(res.plugins[0]?.name, "from-inspect");
  assert.equal("data" in res, false);
  assert.equal("stdout" in res, false);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("listPlugins empty installed list does not fall back to inspect", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "grok-plugin-"));
  const bin = path.join(dir, "grok");
  fs.writeFileSync(
    bin,
    `#!/usr/bin/env node
const args = process.argv.slice(2).join(" ");
if (args.includes("plugin list")) {
  console.log("[]");
  process.exit(0);
}
if (args.includes("inspect")) {
  console.log(JSON.stringify({
    plugins: [{ name: "should-not-appear" }],
  }));
  process.exit(0);
}
process.exit(2);
`,
  );
  fs.chmodSync(bin, 0o755);
  const res = await listPlugins({ bin, timeoutMs: 8000 });
  assert.equal(res.ok, true);
  assert.equal(res.source, "list");
  assert.deepEqual(res.plugins, []);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("listMcpServers falls back to inspect when list JSON is unparseable", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "grok-mcp-"));
  const bin = path.join(dir, "grok");
  fs.writeFileSync(
    bin,
    `#!/usr/bin/env node
const args = process.argv.slice(2).join(" ");
if (args.includes("mcp list")) {
  console.log("not json");
  process.exit(0);
}
if (args.includes("inspect")) {
  console.log(JSON.stringify({
    mcpServers: [{ name: "from-inspect", transport: "stdio" }],
  }));
  process.exit(0);
}
process.exit(2);
`,
  );
  fs.chmodSync(bin, 0o755);
  const res = await listMcpServers({ bin, timeoutMs: 8000 });
  assert.equal(res.ok, true);
  assert.equal(res.source, "inspect");
  assert.equal(res.servers[0]?.name, "from-inspect");
  assert.equal("data" in res, false);
  assert.equal("stdout" in res, false);
  fs.rmSync(dir, { recursive: true, force: true });
});
