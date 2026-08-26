/**
 * Permission mode ↔ grok-build session meta / yolo_mode_changed contract.
 * Drives shared/permission-mode.mjs (same functions used by acp-client).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ACP_CLIENT_IDENTIFIER,
  YOLO_MODE_CHANGED_METHOD,
  initializeClientMeta,
  normalizePermissionMode,
  sessionPermissionMeta,
  toAgentPermissionMode,
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
    clientIdentifier: ACP_CLIENT_IDENTIFIER,
  });
  assert.deepEqual(yoloModeChangedParams("auto"), {
    yolo_mode: false,
    auto_mode: true,
    permission_mode: "auto",
    clientIdentifier: ACP_CLIENT_IDENTIFIER,
  });
  assert.deepEqual(yoloModeChangedParams("ask"), {
    yolo_mode: false,
    auto_mode: false,
    permission_mode: "ask",
    clientIdentifier: ACP_CLIENT_IDENTIFIER,
  });
});

test("yolo_mode_changed is stdio _x.ai/ notification", () => {
  assert.equal(YOLO_MODE_CHANGED_METHOD, "_x.ai/yolo_mode_changed");
  const params = yoloModeChangedParams("auto");
  // Params must be a plain object (pager to_raw_value), not a JSON string —
  // a string RawValue makes agent from_str yield a String Value and drop keys.
  assert.equal(typeof params, "object");
  assert.notEqual(params, null);
  assert.equal(Array.isArray(params), false);
  assert.equal(params.auto_mode, true);
  assert.equal(params.yolo_mode, false);
  assert.equal(params.permission_mode, "auto");
  assert.equal(params.clientIdentifier, "grok-pager");

  // Full wire envelope: method is the underscore ext name; params is the body.
  const wire = JSON.stringify({
    jsonrpc: "2.0",
    method: YOLO_MODE_CHANGED_METHOD,
    params,
  });
  assert.match(wire, /"method":"_x.ai\/yolo_mode_changed"/);
  assert.match(wire, /"yolo_mode":false/);
  assert.match(wire, /"auto_mode":true/);
  assert.match(wire, /"permission_mode":"auto"/);
  assert.match(wire, /"clientIdentifier":"grok-pager"/);
  assert.doesNotMatch(
    wire,
    /"method":"ext_notification"/,
    "stdio must not wrap yolo_mode_changed in ext_notification",
  );
  assert.doesNotMatch(
    wire,
    /"params":"\{/,
    "params must not be a JSON-encoded string on the wire",
  );
});

test("initializeClientMeta uses pager identity until desktop is allowlisted", () => {
  assert.equal(ACP_CLIENT_IDENTIFIER, "grok-pager");
  assert.deepEqual(initializeClientMeta(), {
    clientIdentifier: "grok-pager",
  });
});

test("toAgentPermissionMode labels for hooks/telemetry", () => {
  assert.equal(toAgentPermissionMode("ask"), "default");
  assert.equal(toAgentPermissionMode("auto"), "auto");
  assert.equal(toAgentPermissionMode("always-approve"), "bypassPermissions");
});
