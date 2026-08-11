/**
 * coding_data_retention_opt_out mapping (Opt in = field false).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "grok-desktop-coding-"));
const grokHome = path.join(tmpHome, ".grok");
fs.mkdirSync(grokHome, { recursive: true });
process.env.GROK_HOME = grokHome;

const mod = await import(
  pathToFileURL(
    path.resolve("electron/coding-data.mjs"),
  ).href
);

function writeAuth(entry) {
  const authPath = path.join(grokHome, "auth.json");
  fs.writeFileSync(
    authPath,
    JSON.stringify(
      {
        "https://auth.x.ai::test": {
          email: "t@example.com",
          auth_mode: "oidc",
          key: "fake",
          ...entry,
        },
      },
      null,
      2,
    ),
  );
}

test("missing field defaults to opt in and ensure writes false", () => {
  writeAuth({});
  const before = mod.getCodingDataStatus();
  assert.equal(before.optedIn, true);
  const ensured = mod.ensureCodingDataDefaultOptIn();
  assert.equal(ensured.optedIn, true);
  const raw = JSON.parse(
    fs.readFileSync(path.join(grokHome, "auth.json"), "utf8"),
  );
  const entry = Object.values(raw)[0];
  assert.equal(entry.coding_data_retention_opt_out, false);
});

test("opt out sets coding_data_retention_opt_out true", () => {
  writeAuth({ coding_data_retention_opt_out: false });
  const status = mod.setCodingDataOptIn(false);
  assert.equal(status.optedIn, false);
  const raw = JSON.parse(
    fs.readFileSync(path.join(grokHome, "auth.json"), "utf8"),
  );
  assert.equal(
    Object.values(raw)[0].coding_data_retention_opt_out,
    true,
  );
});

test("opt in sets coding_data_retention_opt_out false", () => {
  writeAuth({ coding_data_retention_opt_out: true });
  const status = mod.setCodingDataOptIn(true);
  assert.equal(status.optedIn, true);
  const raw = JSON.parse(
    fs.readFileSync(path.join(grokHome, "auth.json"), "utf8"),
  );
  assert.equal(
    Object.values(raw)[0].coding_data_retention_opt_out,
    false,
  );
});
