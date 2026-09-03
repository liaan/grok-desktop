import { test } from "node:test";
import assert from "node:assert/strict";
import {
  listParked,
  settleParked,
  wrapParked,
} from "../electron/parked-request.mjs";

test("settleParked runs wrapParked settle", () => {
  let got = null;
  const entry = wrapParked((d) => {
    got = d;
  }, { cwd: "/repo" });
  assert.equal(settleParked(entry, { outcome: "trust" }), true);
  assert.deepEqual(got, { outcome: "trust" });
});

test("settleParked rejects a bare function", () => {
  assert.equal(
    settleParked((d) => d, { outcome: "reject" }),
    false,
  );
});

test("settleParked is fail-closed on junk", () => {
  assert.equal(settleParked(null, { outcome: "trust" }), false);
  assert.equal(settleParked({}, { outcome: "trust" }), false);
});

test("listParked returns reqId + params", () => {
  const map = new Map();
  map.set("trust-1", wrapParked(() => {}, { cwd: "G:\\repo", configKinds: ["mcp"] }));
  assert.deepEqual(listParked(map), [
    {
      reqId: "trust-1",
      params: { cwd: "G:\\repo", configKinds: ["mcp"] },
    },
  ]);
  assert.deepEqual(listParked(null), []);
});

test("listParked skips non-entry values", () => {
  const map = new Map();
  map.set("legacy", () => {});
  map.set("ok", wrapParked(() => {}, { cwd: "/repo" }));
  assert.deepEqual(listParked(map), [{ reqId: "ok", params: { cwd: "/repo" } }]);
});
