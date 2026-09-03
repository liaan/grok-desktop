/**
 * Pending agent→UI reverse-requests (plan, folder-trust, ask, elicit).
 * Map values are `{ settle, params }` so the renderer can rehydrate after
 * open/HMR. Legacy function values still settle.
 */

/**
 * @param {(decision: any) => void} settle
 * @param {any} params
 */
export function wrapParked(settle, params) {
  return { settle, params };
}

/**
 * @param {unknown} entry
 * @param {any} decision
 * @returns {boolean}
 */
export function settleParked(entry, decision) {
  if (!entry) return false;
  const fn =
    typeof entry === "function"
      ? entry
      : typeof entry === "object"
        ? /** @type {{ settle?: unknown }} */ (entry).settle
        : null;
  if (typeof fn !== "function") return false;
  fn(decision);
  return true;
}

/**
 * @param {Map<string, any> | undefined | null} map
 * @returns {Array<{ reqId: string, params?: any }>}
 */
export function listParked(map) {
  if (!map || typeof map.entries !== "function") return [];
  const out = [];
  for (const [reqId, entry] of map.entries()) {
    const params =
      entry && typeof entry === "object" && typeof entry !== "function"
        ? entry.params
        : undefined;
    out.push({ reqId: String(reqId), params });
  }
  return out;
}
