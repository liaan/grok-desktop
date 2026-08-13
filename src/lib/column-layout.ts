/** Persisted chat-shell column widths / collapse. */

export const COLUMN_LAYOUT_KEY = "grok-desktop-column-layout";

export const SIDEBAR_WIDTH_DEFAULT = 280;
export const SIDEBAR_WIDTH_MIN = 200;
export const SIDEBAR_WIDTH_MAX = 480;

export const PANEL_WIDTH_DEFAULT = 340;
export const PANEL_WIDTH_MIN = 220;
export const PANEL_WIDTH_MAX = 560;

/** Rail width when a column is collapsed (Windows / Linux). */
export const COLUMN_COLLAPSED_WIDTH = 48;
/** macOS hiddenInset traffic lights need a wider left rail. */
export const COLUMN_COLLAPSED_WIDTH_DARWIN = 72;

export function collapsedColumnWidth(side: "sidebar" | "panel" = "panel"): number {
  if (side === "sidebar" && isMacUi()) return COLUMN_COLLAPSED_WIDTH_DARWIN;
  return COLUMN_COLLAPSED_WIDTH;
}

function isMacUi(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Mac/i.test(`${navigator.platform} ${navigator.userAgent}`);
}

/** Keep this much for the center chat column while resizing. */
export const MAIN_COLUMN_MIN = 360;

/** Drag this far inside min width to snap-collapse. */
export const COLUMN_COLLAPSE_SLACK = 36;

export type ColumnLayoutState = {
  sidebarWidth: number;
  panelWidth: number;
  sidebarCollapsed: boolean;
  panelCollapsed: boolean;
};

export function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(n)));
}

export function defaultColumnLayout(): ColumnLayoutState {
  return {
    sidebarWidth: SIDEBAR_WIDTH_DEFAULT,
    panelWidth: PANEL_WIDTH_DEFAULT,
    sidebarCollapsed: false,
    panelCollapsed: false,
  };
}

export function readStoredColumnLayout(): ColumnLayoutState {
  const fallback = defaultColumnLayout();
  try {
    const raw = localStorage.getItem(COLUMN_LAYOUT_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<ColumnLayoutState>;
    return {
      sidebarWidth: clamp(
        Number(parsed.sidebarWidth) || SIDEBAR_WIDTH_DEFAULT,
        SIDEBAR_WIDTH_MIN,
        SIDEBAR_WIDTH_MAX,
      ),
      panelWidth: clamp(
        Number(parsed.panelWidth) || PANEL_WIDTH_DEFAULT,
        PANEL_WIDTH_MIN,
        PANEL_WIDTH_MAX,
      ),
      sidebarCollapsed: Boolean(parsed.sidebarCollapsed),
      panelCollapsed: Boolean(parsed.panelCollapsed),
    };
  } catch {
    return fallback;
  }
}

export function persistColumnLayout(state: ColumnLayoutState) {
  try {
    localStorage.setItem(COLUMN_LAYOUT_KEY, JSON.stringify(state));
  } catch {
    /* private mode / quota */
  }
}

/** How wide the other column currently occupies (collapsed rail or full). */
export function displayedColumnWidth(
  width: number,
  collapsed: boolean,
  min: number,
  max: number,
  collapsedWidth: number = COLUMN_COLLAPSED_WIDTH,
): number {
  return collapsed ? collapsedWidth : clamp(width, min, max);
}

export function maxSidebarWidth(windowWidth: number, panelDisplayed: number): number {
  return Math.max(
    SIDEBAR_WIDTH_MIN,
    windowWidth - MAIN_COLUMN_MIN - panelDisplayed,
  );
}

export function maxPanelWidth(windowWidth: number, sidebarDisplayed: number): number {
  return Math.max(
    PANEL_WIDTH_MIN,
    windowWidth - MAIN_COLUMN_MIN - sidebarDisplayed,
  );
}
