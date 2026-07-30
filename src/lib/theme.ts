export type AppTheme = "dark" | "light";

export function applyTheme(theme: AppTheme): void {
  document.documentElement.setAttribute("data-theme", theme);
}

export function readStoredTheme(): AppTheme {
  try {
    const t = localStorage.getItem("grok-desktop-theme");
    return t === "light" ? "light" : "dark";
  } catch {
    return "dark";
  }
}

export function storeTheme(theme: AppTheme): void {
  try {
    localStorage.setItem("grok-desktop-theme", theme);
  } catch {
    /* ignore */
  }
}
