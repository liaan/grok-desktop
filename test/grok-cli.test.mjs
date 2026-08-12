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
  checkGrokUpdate,
  isMissingGrokBinaryError,
  listMcpServers,
  mapMcpServerRow,
  mcpAddArgv,
  mcpDisableArgv,
  mcpDoctorArgv,
  mcpEnableArgv,
  mcpListArgv,
  mcpRemoveArgv,
  mcpServersFromData,
  missingGrokBinaryMessage,
  parseGrokJson,
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
  assert.deepEqual(mcpDoctorArgv(), ["mcp", "doctor"]);
  assert.deepEqual(mcpDoctorArgv("github"), ["mcp", "doctor", "github"]);

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
