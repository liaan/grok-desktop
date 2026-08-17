/**
 * Windows agent env: SHELL must match the Git Bash tool jail.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildGrokEnv, windowsGitBashPath } from "../electron/grok-home.mjs";

test("buildGrokEnv sets SHELL to Git bash on Windows", () => {
  if (process.platform !== "win32") return;
  const env = buildGrokEnv();
  const bash = windowsGitBashPath();
  assert.equal(env.SHELL, bash || "/bin/bash");
  assert.notEqual((env.SHELL || "").toLowerCase(), "powershell");
});

test("buildGrokEnv extra.SHELL wins", () => {
  if (process.platform !== "win32") return;
  const env = buildGrokEnv({ SHELL: "/custom/bash" });
  assert.equal(env.SHELL, "/custom/bash");
});
