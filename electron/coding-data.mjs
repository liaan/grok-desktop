/**
 * Coding data, retention, and training — same preference as CLI `/privacy`.
 *
 * Stored on the OAuth entry in ~/.grok/auth.json as:
 *   coding_data_retention_opt_out: boolean
 *
 *   false / missing → Opt in  (share coding data with SpaceXAI for training)
 *   true            → Opt out
 *
 * Desktop defaults to **Opt in** when the field is unset (writes it so the
 * agent/CLI and console see an explicit choice). Never returns tokens.
 */
import fs from "node:fs";
import path from "node:path";
import { authJsonPath } from "./grok-home.mjs";

/**
 * @typedef {{
 *   optedIn: boolean,
 *   source: 'auth' | 'default' | 'none',
 *   managed: boolean,
 *   note?: string,
 * }} CodingDataStatus
 */

/**
 * @param {unknown} raw
 * @returns {Array<{ key: string, entry: Record<string, unknown> }>}
 */
function listAuthEntries(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
  /** @type {Array<{ key: string, entry: Record<string, unknown> }>} */
  const out = [];
  for (const [key, v] of Object.entries(
    /** @type {Record<string, unknown>} */ (raw),
  )) {
    if (!v || typeof v !== "object" || Array.isArray(v)) continue;
    const o = /** @type {Record<string, unknown>} */ (v);
    if (
      o.key ||
      o.refresh_token ||
      o.access_token ||
      o.email ||
      o.auth_mode ||
      o.authMode
    ) {
      out.push({ key, entry: o });
    }
  }
  return out;
}

/**
 * @returns {{ raw: Record<string, unknown>, entries: ReturnType<typeof listAuthEntries> } | null}
 */
function readAuthFile() {
  const p = authJsonPath();
  if (!fs.existsSync(p)) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(p, "utf8"));
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    const obj = /** @type {Record<string, unknown>} */ (raw);
    return { raw: obj, entries: listAuthEntries(obj) };
  } catch {
    return null;
  }
}

/**
 * Atomic-ish write (write temp + rename). Preserves unrelated keys.
 * @param {Record<string, unknown>} raw
 */
function writeAuthFile(raw) {
  const p = authJsonPath();
  const dir = path.dirname(p);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = `${p}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(raw, null, 2)}\n`, "utf8");
  fs.renameSync(tmp, p);
}

/**
 * Prefer the first OAuth-looking entry (same order as auth.mjs pick).
 * @param {ReturnType<typeof listAuthEntries>} entries
 */
function primaryEntry(entries) {
  return entries[0] || null;
}

/**
 * Read current coding-data sharing preference.
 * Missing field → opted in (Desktop / product default).
 * @returns {CodingDataStatus}
 */
export function getCodingDataStatus() {
  const file = readAuthFile();
  if (!file || file.entries.length === 0) {
    return {
      optedIn: true,
      source: "none",
      managed: false,
      note: "Sign in with OAuth so this preference is stored with your account.",
    };
  }
  const primary = primaryEntry(file.entries);
  const v = primary?.entry?.coding_data_retention_opt_out;
  // Explicit opt-out only when true; missing/false → opt in
  const optedOut = v === true || v === "true" || v === 1;
  return {
    optedIn: !optedOut,
    source: v === undefined || v === null ? "default" : "auth",
    managed: false,
  };
}

/**
 * Ensure auth.json has an explicit opt-in when the field is missing.
 * Idempotent. Call from getInfo so agent sessions inherit the default.
 * @returns {CodingDataStatus}
 */
export function ensureCodingDataDefaultOptIn() {
  const file = readAuthFile();
  if (!file || file.entries.length === 0) {
    return getCodingDataStatus();
  }
  let changed = false;
  for (const { key, entry } of file.entries) {
    if (
      entry.coding_data_retention_opt_out === undefined ||
      entry.coding_data_retention_opt_out === null
    ) {
      file.raw[key] = {
        ...entry,
        coding_data_retention_opt_out: false,
      };
      changed = true;
    }
  }
  if (changed) {
    try {
      writeAuthFile(file.raw);
    } catch {
      /* leave as-is if file locked */
    }
  }
  return getCodingDataStatus();
}

/**
 * Set coding-data sharing (true = Opt in, false = Opt out).
 * Writes coding_data_retention_opt_out on every auth entry.
 * @param {boolean} optedIn
 * @returns {CodingDataStatus}
 */
export function setCodingDataOptIn(optedIn) {
  const share = Boolean(optedIn);
  const file = readAuthFile();
  if (!file || file.entries.length === 0) {
    return {
      optedIn: share,
      source: "none",
      managed: false,
      note: "No OAuth session in auth.json — sign in first, then set this again.",
    };
  }
  for (const { key, entry } of file.entries) {
    file.raw[key] = {
      ...entry,
      // CLI field is opt-*out*: false means share / opt in
      coding_data_retention_opt_out: !share,
    };
  }
  writeAuthFile(file.raw);
  return getCodingDataStatus();
}
