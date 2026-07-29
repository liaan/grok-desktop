/* Apply theme before paint to avoid flash. Loaded as external script (CSP script-src 'self'). */
(function () {
  try {
    var t = localStorage.getItem("grok-desktop-theme");
    if (t === "light" || t === "dark") {
      document.documentElement.setAttribute("data-theme", t);
    } else {
      document.documentElement.setAttribute("data-theme", "dark");
    }
  } catch (e) {
    document.documentElement.setAttribute("data-theme", "dark");
  }
})();
