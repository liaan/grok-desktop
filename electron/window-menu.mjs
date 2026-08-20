/**
 * Window menu extras per OS.
 *
 * macOS: role:"window" appends the open-window list; same-app cycle is Cmd+`.
 * Linux: no OS list, so we list windows and keep Ctrl+Tab cycling.
 * Windows: no OS list, and Ctrl+Tab is unreliable as an Electron accelerator
 * (Alt+Tab already switches). List windows instead of Next/Previous.
 */

/**
 * @param {string} [platform]
 * @returns {"cmd-backtick" | "ctrl-tab" | "none"}
 */
export function windowCycleKind(platform = process.platform) {
  if (platform === "darwin") return "cmd-backtick";
  if (platform === "win32") return "none";
  return "ctrl-tab";
}

/**
 * Electron only auto-appends the window list on macOS (role: "window").
 * @param {string} [platform]
 */
export function menuListsOpenWindows(platform = process.platform) {
  return platform !== "darwin";
}

/**
 * @typedef {{ id: number, title?: string, focused?: boolean }} WindowListEntry
 */

/**
 * Radio items for Window → open shells (Windows / Linux).
 * @param {WindowListEntry[]} windows
 * @param {(id: number) => void} [onFocus]
 * @returns {import('electron').MenuItemConstructorOptions[]}
 */
export function windowListMenuItems(windows, onFocus) {
  const titles = (windows || []).map((w) => {
    const t = String(w?.title || "Grok Desktop").trim();
    return t || "Grok Desktop";
  });
  /** @type {Map<string, number>} */
  const counts = new Map();
  for (const t of titles) counts.set(t, (counts.get(t) || 0) + 1);

  return (windows || []).map((w, i) => {
    let label = titles[i];
    if ((counts.get(label) || 0) > 1) {
      label = `${label} · ${w.id}`;
    }
    return {
      label,
      type: "radio",
      checked: Boolean(w.focused),
      click: () => {
        if (typeof onFocus === "function") onFocus(w.id);
      },
    };
  });
}
