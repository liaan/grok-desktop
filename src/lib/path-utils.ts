/**
 * Pure path helpers for the renderer (no Node path / realpath).
 * Main-process enforcement lives in electron/path-safety.mjs; these only
 * drive UI (file browser up-control, labels).
 */

/** Normalize separators and strip trailing slashes (keep root "/" and "C:/"). */
export function normalizePathKey(p: string): string {
  let s = String(p || "").replace(/\\/g, "/");
  // Collapse duplicate slashes except leading // (unc not used here)
  s = s.replace(/\/+/g, "/");
  if (s.length > 1 && s.endsWith("/")) {
    // Keep "C:/" drive root; strip other trailing slashes
    if (!/^[A-Za-z]:\/$/.test(s)) {
      s = s.replace(/\/+$/, "");
    }
  }
  // Canonicalize Windows drive letter casing for comparisons
  if (/^[a-zA-Z]:/.test(s)) {
    s = s[0].toUpperCase() + s.slice(1);
  }
  return s;
}

/**
 * Comparison key: case-fold Windows-style paths (drive letter present).
 * POSIX paths stay case-sensitive.
 */
function compareKey(p: string): string {
  const n = normalizePathKey(p);
  if (/^[A-Za-z]:/.test(n)) return n.toLowerCase();
  return n;
}

/**
 * Lexical containment matching path.relative semantics (no symlink resolution).
 * `target` is under `root` or equal to it.
 */
export function isLexicallyUnder(root: string, target: string): boolean {
  const r = compareKey(root);
  const t = compareKey(target);
  if (!r || !t) return false;
  if (t === r) return true;
  // Avoid /proj matching /proj-evil
  return t.startsWith(r.endsWith("/") ? r : r + "/");
}

/**
 * Parent directory. Handles Unix `/tmp` → `/` and Windows `C:\Users` → `C:/`.
 * Returns null for filesystem / drive roots and empty input.
 */
export function parentDir(p: string): string | null {
  if (!p) return null;
  const norm = normalizePathKey(p);
  if (!norm || norm === "/") return null;

  // Windows drive root: "C:" or "C:/"
  if (/^[A-Za-z]:$/.test(norm) || /^[A-Za-z]:\/$/.test(norm)) return null;

  const idx = norm.lastIndexOf("/");
  if (idx < 0) return null;

  // Unix: /tmp → /
  if (idx === 0) return "/";

  // Windows: C:/Users → C:/
  if (idx === 2 && /^[A-Za-z]:\//.test(norm)) {
    return norm.slice(0, 3); // "C:/"
  }

  return norm.slice(0, idx);
}

export function basen(p: string): string {
  const norm = normalizePathKey(p);
  if (/^[A-Za-z]:\/$/.test(norm)) return norm;
  const idx = norm.lastIndexOf("/");
  return idx >= 0 ? norm.slice(idx + 1) : norm;
}

/** Path of `target` relative to `root` for display (forward slashes). */
export function relativeDisplay(root: string, target: string): string {
  const r = normalizePathKey(root);
  const t = normalizePathKey(target);
  if (!r || !t) return t || "";
  if (compareKey(r) === compareKey(t)) return ".";
  const foldedR = compareKey(r);
  const foldedT = compareKey(t);
  const foldedPrefix = foldedR.endsWith("/") ? foldedR : `${foldedR}/`;
  if (!foldedT.startsWith(foldedPrefix)) return t;
  // Preserve original casing from target when slicing by matched prefix length
  const prefixLen = r.endsWith("/") ? r.length : r.length + 1;
  return t.slice(prefixLen) || ".";
}
