/**
 * Dismiss the in-page overlay and tell main the first frame is painted.
 * Main keeps the BrowserWindow hidden until this signal (native splash covers
 * the wait). Reloads already have a visible window — overlay is the fallback.
 */
export function hideBootSplash() {
  const el = document.getElementById("boot-splash");
  if (el && el.getAttribute("data-done") !== "1") {
    el.setAttribute("data-done", "1");
    el.classList.add("boot-splash--done");
    window.setTimeout(() => {
      el.remove();
    }, 320);
  }
  const signal = () => {
    try {
      window.grokDesktop?.windowReady?.();
    } catch {
      /* preload missing in unit tests / non-electron */
    }
  };
  // Two frames so the real UI is committed before main shows the shell.
  window.requestAnimationFrame(() => {
    window.requestAnimationFrame(signal);
  });
}
