import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import {
  LOCALE_PREFS,
  catalogs,
  normalizeLocalePref,
  resolveLocale,
  translate,
} from "../shared/ui-copy.mjs";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Every {name} placeholder in a catalog string, sorted. */
function placeholders(text) {
  return (String(text).match(/{(\w+)}/g) || [])
    .map((m) => m.slice(1, -1))
    .sort()
    .join(",");
}

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (/\.(tsx?|mjs)$/.test(entry)) out.push(full);
  }
  return out;
}

describe("ui-copy catalogs", () => {
  it("exposes both locales with the same key set", () => {
    const en = Object.keys(catalogs.en).sort();
    const zh = Object.keys(catalogs["zh-CN"]).sort();
    assert.deepEqual(en, zh);
    assert.ok(en.length > 0);
  });

  it("uses the same {placeholders} in en and zh-CN for every key", () => {
    for (const key of Object.keys(catalogs.en)) {
      assert.equal(
        placeholders(catalogs.en[key]),
        placeholders(catalogs["zh-CN"][key]),
        `placeholder mismatch for "${key}"`,
      );
    }
  });

  it("has no empty catalog entries", () => {
    for (const locale of Object.keys(catalogs)) {
      for (const [key, value] of Object.entries(catalogs[locale])) {
        assert.ok(
          typeof value === "string" && value.trim().length > 0,
          `${locale}:${key} is empty`,
        );
      }
    }
  });

  it("keeps zh-CN free of stray latin-only sentences", () => {
    // Chinese copy may legitimately contain latin tokens (Grok, MCP, Skills,
    // skills, plugins, ~/.grok, URLs, CLI flags). Only flag entries with no
    // CJK at all, which means the translation was never written.
    // A few keys are intentionally latin-only: MCP/plugins/skills must stay as
    // the original term per the i18n handoff constraints.
    const allowLatinOnly = new Set([
      "nav.mcp",
      "nav.plugins",
      "nav.skills",
      "general.english",
      "engine.cli",
      "auth.grokVersion",
      "auth.grokWithPath",
      "cmd.skillFallback",
      "msg.grok",
      "mcp.url",
    ]);
    const cjk = /[\u4e00-\u9fff]/;
    for (const [key, value] of Object.entries(catalogs["zh-CN"])) {
      if (allowLatinOnly.has(key)) continue;
      assert.ok(cjk.test(value), `zh-CN:${key} has no Chinese text`);
    }
  });
});

describe("translate", () => {
  it("returns the catalog text for the requested locale", () => {
    assert.equal(translate("zh-CN", "menu.file"), "文件");
    assert.equal(translate("en", "menu.file"), "File");
  });

  it("substitutes {vars}", () => {
    assert.equal(translate("en", "sidebar.skills", { n: 3 }), "3 skills");
    assert.equal(
      translate("zh-CN", "sidebar.deleteConfirm", { label: "demo" }),
      "删除“demo”？此操作无法撤销。",
    );
  });

  it("falls back to en, then to the key itself", () => {
    assert.equal(translate("zh-CN", "menu.file"), catalogs["zh-CN"]["menu.file"]);
    assert.equal(translate("zh-CN", "nope.missing"), "nope.missing");
  });

  it("leaves unknown placeholders untouched", () => {
    assert.equal(translate("en", "menu.file", { n: 1 }), "File");
  });
});

describe("locale preference", () => {
  it("normalizes unknown prefs to system", () => {
    assert.equal(normalizeLocalePref("en"), "en");
    assert.equal(normalizeLocalePref("zh-CN"), "zh-CN");
    assert.equal(normalizeLocalePref("fr"), "system");
    assert.equal(normalizeLocalePref(undefined), "system");
  });

  it("follows the system language for zh, else English", () => {
    assert.equal(resolveLocale("system", "zh-CN"), "zh-CN");
    assert.equal(resolveLocale("system", "zh-TW"), "zh-CN");
    assert.equal(resolveLocale("system", "en-US"), "en");
    assert.equal(resolveLocale("system", ""), "en");
  });

  it("an explicit choice always wins over the system language", () => {
    assert.equal(resolveLocale("en", "zh-CN"), "en");
    assert.equal(resolveLocale("zh-CN", "en-US"), "zh-CN");
  });

  it("ships the three documented prefs", () => {
    assert.deepEqual(LOCALE_PREFS, ["system", "en", "zh-CN"]);
  });
});

describe("renderer key usage", () => {
  it("every static t(\"key\") in src/ exists in both catalogs", () => {
    const files = walk(path.join(root, "src"));
    const used = new Set();
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      for (const m of text.matchAll(/\bt\(\s*"([^"{]+)"/g)) {
        used.add(m[1]);
      }
    }
    assert.ok(used.size > 100, `expected broad key usage, saw ${used.size}`);
    const missing = [...used].filter(
      (key) =>
        !(key in catalogs.en) ||
        !(key in catalogs["zh-CN"]),
    );
    assert.deepEqual(missing, []);
  });
});
