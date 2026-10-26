import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { catalogs, translate } from "../shared/ui-copy.mjs";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("native splash", () => {
  it("ships a static splash.html that does not load the Vite app", () => {
    const html = readFileSync(path.join(root, "electron/splash.html"), "utf8");
    const main = readFileSync(path.join(root, "electron/main.mjs"), "utf8");
    assert.match(html, /Grok Desktop/);
    assert.doesNotMatch(html, /src\/main\.tsx/);
    assert.doesNotMatch(html, /type="module"/);
    assert.match(main, /createSplashWindow/);
    assert.match(main, /show: false/);
    assert.doesNotMatch(html, /正在加载/);
    assert.match(html, /get\("loading"\)/);
    assert.match(html, /get\("theme"\)/);
    const splash = readFileSync(path.join(root, "electron/splash.mjs"), "utf8");
    assert.doesNotMatch(splash, /正在加载/);
    assert.match(
      splash,
      /const loading = translate\(locale, "splash\.loading"\)/,
    );
    assert.match(
      splash,
      /query:\s*\{\s*theme:\s*t,\s*lang:\s*locale,\s*loading\s*\}/,
    );
    assert.equal(translate("en", "splash.loading"), "Loading the app…");
    assert.equal(translate("zh-CN", "splash.loading"), "正在加载…");
    assert.equal(
      translate("en", "splash.loading"),
      catalogs.en["splash.loading"],
    );
    assert.equal(
      translate("zh-CN", "splash.loading"),
      catalogs["zh-CN"]["splash.loading"],
    );
    assert.notEqual(translate("en", "splash.loading"), "splash.loading");
    assert.notEqual(translate("zh-CN", "splash.loading"), "splash.loading");
  });
});
