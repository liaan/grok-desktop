/**
 * Permission option classification — enable-always-approve must never be
 * the default allow-once pick (agent prepends it at position 0 for Desktop).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ENABLE_ALWAYS_APPROVE_OPTION_ID,
  classifyPermissionOption,
  classifyOptionId,
  isEnableAlwaysApproveOption,
  pickAllowOptionId,
  pickAllowOnceOptionId,
  permissionButtonClass,
  permissionOutcomeFromUi,
} from "../shared/permission-options.mjs";

const DESKTOP_CATALOG = [
  {
    optionId: ENABLE_ALWAYS_APPROVE_OPTION_ID,
    name: "Yes, and don't ask again for anything (always-approve mode)",
    kind: "allow_once",
  },
  { optionId: "allow-once", name: "Allow once", kind: "allow_once" },
  { optionId: "allow-always", name: "Always allow", kind: "allow_always" },
  { optionId: "reject", name: "Reject", kind: "reject_once" },
];

test("enable-always-approve is its own class, not allow_once", () => {
  assert.equal(
    classifyPermissionOption(DESKTOP_CATALOG[0]),
    "enable_always_approve",
  );
  assert.equal(
    classifyOptionId(ENABLE_ALWAYS_APPROVE_OPTION_ID, DESKTOP_CATALOG),
    "enable_always_approve",
  );
  // id contains "approve" — must not fall through to the allow_once regex
  assert.equal(
    classifyPermissionOption({
      optionId: "enable-always-approve",
      name: "",
      kind: "allow_once",
    }),
    "enable_always_approve",
  );
});

test("isEnableAlwaysApproveOption pins the option id, not the name", () => {
  assert.equal(isEnableAlwaysApproveOption("enable-always-approve"), true);
  assert.equal(isEnableAlwaysApproveOption("enable_always_approve"), true);
  assert.equal(
    isEnableAlwaysApproveOption("allow-once"),
    false,
  );
  assert.equal(
    classifyPermissionOption({
      optionId: "allow-once",
      name: "Yes, and don't ask again for anything (always-approve mode)",
      kind: "allow_once",
    }),
    "allow_once",
  );
});

test("permissionButtonClass treats enable-always-approve as not primary", () => {
  assert.equal(permissionButtonClass("allow_once"), "btn primary");
  assert.equal(permissionButtonClass("allow_always"), "btn primary");
  assert.equal(permissionButtonClass("enable_always_approve"), "btn");
  assert.equal(permissionButtonClass("reject"), "btn");
  assert.equal(
    permissionButtonClass("allow_once", { size: "sm" }),
    "btn primary btn-sm",
  );
  assert.equal(
    permissionButtonClass("enable_always_approve", { size: "sm" }),
    "btn btn-sm",
  );
});

test("pickAllowOptionId skips enable-always-approve even when first", () => {
  assert.equal(pickAllowOptionId(DESKTOP_CATALOG), "allow-once");
  assert.equal(
    pickAllowOptionId(DESKTOP_CATALOG, { allowAlwaysOk: true }),
    "allow-once",
  );
  assert.equal(pickAllowOnceOptionId(DESKTOP_CATALOG), "allow-once");
});

test("pickAllowOptionId still works when catalog is only the yolo row + reject", () => {
  const onlyYolo = [
    DESKTOP_CATALOG[0],
    { optionId: "reject", name: "Reject", kind: "reject_once" },
  ];
  assert.equal(pickAllowOptionId(onlyYolo), "allow-once");
  assert.equal(pickAllowOnceOptionId(onlyYolo), null);
});

test("permissionOutcomeFromUi keeps the listed enable-always-approve id", () => {
  const result = permissionOutcomeFromUi(
    ENABLE_ALWAYS_APPROVE_OPTION_ID,
    DESKTOP_CATALOG,
  );
  assert.equal(result?.outcome?.optionId, ENABLE_ALWAYS_APPROVE_OPTION_ID);
});

test("batch Allow all never selects enable-always-approve", () => {
  const result = permissionOutcomeFromUi("allow-once", DESKTOP_CATALOG, {
    batchOnce: true,
  });
  assert.equal(result?.outcome?.optionId, "allow-once");
});
