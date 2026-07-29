/**
 * Permission mode ↔ grok-build session meta / yolo_mode_changed contract.
 * Drives shared/permission-mode.mjs (same functions used by acp-client).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  YOLO_MODE_CHANGED_METHOD,
  normalizePermissionMode,
  sessionPermissionMeta,
  toAgentPermissionMode,
  yoloModeChangedExtNotification,
  yoloModeChangedParams,
} from "../shared/permission-mode.mjs";

test("normalizePermissionMode maps aliases", () => {
  assert.equal(normalizePermissionMode("ask"), "ask");
  assert.equal(normalizePermissionMode("auto"), "auto");
  assert.equal(normalizePermissionMode("always-approve"), "always-approve");
  assert.equal(normalizePermissionMode("yolo"), "always-approve");
  assert.equal(normalizePermissionMode("bypassPermissions"), "always-approve");
});

test("sessionPermissionMeta seeds yoloMode and autoMode (agent contract)", () => {
  assert.deepEqual(sessionPermissionMeta("ask"), {
    yoloMode: false,
    autoMode: false,
    permissionMode: "default",
  });
  assert.deepEqual(sessionPermissionMeta("auto"), {
    yoloMode: false,
    autoMode: true,
    permissionMode: "auto",
  });
  assert.deepEqual(sessionPermissionMeta("always-approve"), {
    yoloMode: true,
    autoMode: false,
    permissionMode: "bypassPermissions",
  });
});

test("sessionPermissionMeta autoMode is true only for Desktop auto", () => {
  // Regression: permissionMode string alone is not enough for agent auto seed
  const auto = sessionPermissionMeta("auto");
  assert.equal(auto.autoMode, true);
  assert.equal(auto.yoloMode, false);
  assert.ok("autoMode" in auto);
});

test("yoloModeChangedParams match pager snake_case keys", () => {
  assert.deepEqual(yoloModeChangedParams("always-approve"), {
    yolo_mode: true,
    auto_mode: false,
    permission_mode: "always-approve",
  });
  assert.deepEqual(yoloModeChangedParams("auto"), {
    yolo_mode: false,
    auto_mode: true,
    permission_mode: "auto",
  });
  assert.deepEqual(yoloModeChangedParams("ask"), {
    yolo_mode: false,
    auto_mode: false,
    permission_mode: "ask",
  });
});

test("yoloModeChangedExtNotification is ext_notification payload", () => {
  const n = yoloModeChangedExtNotification("auto");
  assert.equal(n.method, YOLO_MODE_CHANGED_METHOD);
  assert.equal(n.method, "x.ai/yolo_mode_changed");
  // Params must be a plain object (pager to_raw_value), not a JSON string —
  // a string RawValue makes agent from_str yield a String Value and drop keys.
  assert.equal(typeof n.params, "object");
  assert.notEqual(n.params, null);
  assert.equal(typeof n.params, "object");
  assert.equal(Array.isArray(n.params), false);
  assert.equal(n.params.auto_mode, true);
  assert.equal(n.params.yolo_mode, false);
  assert.equal(n.params.permission_mode, "auto");

  // Full wire envelope: params serializes as a JSON object token, not a quoted string
  const wire = JSON.stringify({
    jsonrpc: "2.0",
    method: "ext_notification",
    params: n,
  });
  assert.match(wire, /"params":\{"yolo_mode":false,"auto_mode":true,"permission_mode":"auto"\}/);
  assert.doesNotMatch(
    wire,
    /"params":"\{/,
    "params must not be a JSON-encoded string on the wire",
  );
});

test("toAgentPermissionMode labels for hooks/telemetry", () => {
  assert.equal(toAgentPermissionMode("ask"), "default");
  assert.equal(toAgentPermissionMode("auto"), "auto");
  assert.equal(toAgentPermissionMode("always-approve"), "bypassPermissions");
});
