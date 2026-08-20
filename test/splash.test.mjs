import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

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
  });
});
