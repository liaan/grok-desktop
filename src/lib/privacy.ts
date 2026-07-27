/**
 * Display-only redaction for Privacy mode (screenshots / demos).
 * Does not alter session logs, disk paths, or agent I/O.
 */

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Unique home-path spellings (POSIX + Windows seps), longest first. */
export function buildHomePathVariants(home: string): string[] {
  const raw = String(home || "").trim();
  if (!raw) return [];

  const posix = raw.replace(/\\/g, "/").replace(/\/+$/, "");
  const win = raw.replace(/\//g, "\\").replace(/\\+$/, "");
  const set = new Set<string>();
  for (const v of [raw, posix, win]) {
    if (v) set.add(v);
  }
  return [...set].sort((a, b) => b.length - a.length);
}

/**
 * Replace absolute home directory **prefixes** with `~` when Privacy mode is on.
 * Path-boundary aware so `/Users/a` does not corrupt `/Users/ab/...`.
 * Example: `/Users/alice/dev/app` → `~/dev/app`
 */
export function redactSensitiveText(
  text: string,
  home: string | null | undefined,
  enabled: boolean,
): string {
  if (!enabled || text == null || text === "") return text == null ? "" : text;
  if (!home) return text;

  let out = String(text);
  for (const variant of buildHomePathVariants(home)) {
    if (!variant) continue;
    // Match home as a path prefix: end of string, or followed by / or \
    const re = new RegExp(
      `(^|[^A-Za-z0-9_])${escapeRegExp(variant)}(?=$|[/\\\\])`,
      "gi",
    );
    out = out.replace(re, (_m, pre: string) => `${pre}~`);
  }
  return out;
}
