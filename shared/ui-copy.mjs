/**
 * UI copy for Grok Desktop. One catalog per language.
 * Model names, slash commands, code, paths, Skills/MCP/Plugins names,
 * and API field names stay in the original language at the call site.
 */

import { en } from "./ui-copy-en.mjs";
import { zhCN } from "./ui-copy-zh-CN.mjs";

/** @typedef {"system" | "en" | "zh-CN"} LocalePref */
/** @typedef {"en" | "zh-CN"} Locale */

export const LOCALE_PREFS = ["system", "en", "zh-CN"];

/**
 * @param {unknown} pref
 * @returns {LocalePref}
 */
export function normalizeLocalePref(pref) {
  return pref === "en" || pref === "zh-CN" ? pref : "system";
}

/**
 * @param {unknown} pref
 * @param {unknown} systemLang  BCP-47 tag, e.g. app.getLocale() or navigator.language
 * @returns {Locale}
 */
export function resolveLocale(pref, systemLang) {
  const choice = normalizeLocalePref(pref);
  if (choice !== "system") return choice;
  const tag = String(systemLang || "").toLowerCase();
  return tag.startsWith("zh") ? "zh-CN" : "en";
}

export const catalogs = { en, "zh-CN": zhCN };

/**
 * @param {Locale} locale
 * @param {string} key
 * @param {Record<string, string | number>} [vars]
 */
export function translate(locale, key, vars) {
  const table = catalogs[locale] || catalogs.en;
  let text = table[key] ?? catalogs.en[key] ?? key;
  if (vars) {
    for (const [name, value] of Object.entries(vars)) {
      text = text.split(`{${name}}`).join(String(value));
    }
  }
  return text;
}
