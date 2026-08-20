/** Dismiss the HTML overlay that covers the app until bootstrap finishes. */
export function hideBootSplash() {
  const el = document.getElementById("boot-splash");
  if (!el || el.getAttribute("data-done") === "1") return;
  el.setAttribute("data-done", "1");
  el.classList.add("boot-splash--done");
  window.setTimeout(() => {
    el.remove();
  }, 320);
}
