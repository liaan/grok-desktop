import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyPermissionOption } from "../shared/permission-options.mjs";
import { localizeOptionLabel } from "../src/lib/permission-labels.ts";

/** @param {string} key @param {Record<string, string | number>} [vars] */
function t(key, vars) {
  if (vars && Object.prototype.hasOwnProperty.call(vars, "name")) {
    return `${key}:${vars.name}`;
  }
  return key;
}

test("session allow is not labeled allow-once", () => {
  const optionId = "allow-session";
  const name = "Allow this session";
  assert.equal(classifyPermissionOption({ optionId, name }), "allow_always");
  const label = localizeOptionLabel(optionId, name, t);
  assert.equal(label, "perm.allowAlways");
  assert.notEqual(label, "perm.allowOnce");
});

test("Never allow keeps the command text", () => {
  assert.equal(
    localizeOptionLabel("reject", "Never allow: git status", t),
    "perm.neverAllow:git status",
  );
  assert.equal(
    localizeOptionLabel("reject", "NEVER ALLOW git status", t),
    "perm.neverAllow:git status",
  );
});

test("unknown option text is returned unchanged", () => {
  assert.equal(
    localizeOptionLabel("custom", "Do the unusual thing", t),
    "Do the unusual thing",
  );
  assert.equal(localizeOptionLabel("custom-id", undefined, t), "custom-id");
  assert.equal(localizeOptionLabel("custom-id", "   ", t), "custom-id");
});

test("cancel ids map to the cancel string even when the class is unknown", () => {
  assert.equal(
    classifyPermissionOption({ optionId: "cancelled", name: "Cancel" }),
    "unknown",
  );
  assert.equal(classifyPermissionOption({ optionId: "cancelled" }), "unknown");
  assert.equal(localizeOptionLabel("cancel", "Cancel", t), "perm.cancel");
  assert.equal(localizeOptionLabel("cancelled", "Cancel", t), "perm.cancel");
  assert.equal(localizeOptionLabel("cancelled", undefined, t), "perm.cancel");
  assert.equal(localizeOptionLabel("cancelled", "Reject", t), "perm.cancel");
  assert.equal(localizeOptionLabel("reject", "Reject", t), "perm.reject");
  assert.equal(
    localizeOptionLabel("custom", "Please cancel this", t),
    "Please cancel this",
  );
});

test("edit-session allow uses kind, not the yes in the name", () => {
  const optionId = "allow-edits-session";
  const name = "Yes, allow all edits during this session";
  assert.equal(classifyPermissionOption({ optionId, name }), "allow_once");
  assert.equal(
    classifyPermissionOption({ optionId, name, kind: "allow_always" }),
    "allow_always",
  );
  assert.equal(
    classifyPermissionOption({ optionId, name, kind: "AllowAlways" }),
    "allow_always",
  );
  assert.equal(
    localizeOptionLabel(optionId, name, t, "allow_always"),
    "perm.allowAlways",
  );
  assert.equal(
    localizeOptionLabel(optionId, name, t, "AllowAlways"),
    "perm.allowAlways",
  );
  assert.notEqual(
    localizeOptionLabel(optionId, name, t, "allow_always"),
    "perm.allowOnce",
  );
});

test("reject-once kind is perm.reject, not the English sentence", () => {
  const optionId = "reject-once";
  const name = "No, and tell Grok what to do differently";
  assert.equal(classifyPermissionOption({ optionId, name }), "unknown");
  assert.equal(
    classifyPermissionOption({ optionId, name, kind: "reject_once" }),
    "reject",
  );
  assert.equal(
    classifyPermissionOption({ optionId, name, kind: "RejectOnce" }),
    "reject",
  );
  assert.equal(
    localizeOptionLabel(optionId, name, t, "reject_once"),
    "perm.reject",
  );
  assert.equal(
    localizeOptionLabel(optionId, name, t, "RejectOnce"),
    "perm.reject",
  );
  assert.notEqual(localizeOptionLabel(optionId, name, t, "reject_once"), name);
});

test("enable-always-approve is not labeled allow-once", () => {
  const optionId = "enable-always-approve";
  const name = "Yes, and don't ask again for anything (always-approve mode)";
  assert.equal(
    classifyPermissionOption({ optionId, name }),
    "enable_always_approve",
  );
  assert.equal(localizeOptionLabel(optionId, name, t), "perm.alwaysApprove");
});

test("allow-once class does not keep Yes, proceed wording", () => {
  const name = "Yes, proceed";
  assert.equal(
    classifyPermissionOption({ optionId: "allow-once", name }),
    "allow_once",
  );
  assert.equal(localizeOptionLabel("allow-once", name, t), "perm.allowOnce");
});
