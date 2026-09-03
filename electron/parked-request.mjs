/**
 * Pending agent→UI reverse-requests (plan, folder-trust, ask, elicit).
 * Map values are `{ settle, params }` so the renderer can rehydrate after
 * open/HMR.
 */

/**
 * @typedef {{ settle: (decision: any) => void, params?: any }} ParkedEntry
 */

/**
 * @param {(decision: any) => void} settle
 * @param {any} params
 * @returns {ParkedEntry}
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
  if (!entry || typeof entry !== "object") return false;
  const fn = /** @type {ParkedEntry} */ (entry).settle;
  if (typeof fn !== "function") return false;
  fn(decision);
  return true;
}

/**
 * @param {Map<string, ParkedEntry> | undefined | null} map
 * @returns {Array<{ reqId: string, params?: any }>}
 */
export function listParked(map) {
  if (!map || typeof map.entries !== "function") return [];
  const out = [];
  for (const [reqId, entry] of map.entries()) {
    if (!entry || typeof entry !== "object" || typeof entry.settle !== "function") {
      continue;
    }
    out.push({ reqId: String(reqId), params: entry.params });
  }
  return out;
}
