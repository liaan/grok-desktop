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

test("settleParked still accepts a bare function", () => {
  let got = null;
  assert.equal(
    settleParked((d) => {
      got = d;
    }, { outcome: "reject" }),
    true,
  );
  assert.deepEqual(got, { outcome: "reject" });
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
