/**
 * Locale hydration is a source contract: no React renderer in this repo.
 * A getInfo snapshot must not call setLocale, and a stale gen must return
 * before localStorage is written. The user setPref is the setLocale writer.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const app = readFileSync(path.join(root, "src/App.tsx"), "utf8");
const i18n = readFileSync(path.join(root, "src/lib/i18n.tsx"), "utf8");

function sliceFn(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.ok(start >= 0 && end > start, `missing ${startMarker}`);
  return source.slice(start, end);
}

test("bootstrap applies getInfo without setLocale and captures gen first", () => {
  assert.doesNotMatch(app, /hydratePref/);
  assert.doesNotMatch(app, /setLocale/);
  const boot = sliceFn(app, "const bootstrap = useCallback", "}, [refreshBackbone");
  assert.match(boot, /const gen = localeGen\.current/);
  assert.match(boot, /getInfo\(\)/);
  assert.match(boot, /setPref\(i\.localePref,\s*\{\s*gen\s*\}\)/);
  assert.ok(boot.indexOf("const gen = localeGen.current") < boot.indexOf("getInfo()"));
  assert.ok(boot.indexOf("getInfo()") < boot.indexOf("setPref(i.localePref"));
  assert.doesNotMatch(boot, /setLocale/);
  assert.doesNotMatch(boot, /storeLocalePref/);
});

test("user setPref calls setLocale; a stale snapshot returns before localStorage", () => {
  assert.doesNotMatch(i18n, /hydratePref/);
  const setPrefFn = sliceFn(i18n, "const setPref = useCallback", "const t = useCallback");
  const guard = setPrefFn.indexOf("opts.gen !== localeGen.current) return");
  const store = setPrefFn.indexOf("storeLocalePref");
  const snapshotReturn = setPrefFn.indexOf("if (opts) return");
  const setLocale = setPrefFn.indexOf("setLocale");
  assert.ok(guard >= 0 && guard < store, "stale gen must return before storeLocalePref");
  assert.ok(snapshotReturn >= 0 && snapshotReturn < setLocale, "snapshot must return before setLocale");
  assert.match(setPrefFn, /if \(!opts\) localeGen\.current \+= 1/);
});
