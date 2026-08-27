/**
 * Build a compact accessibility-style text snapshot of a page.
 * This is what the model should read most of the time (not a screenshot).
 */

export const SNAPSHOT_MAX_CHARS = 8000;
export const SNAPSHOT_MAX_NODES = 220;
export const SNAPSHOT_MAX_TEXT_CHARS = 2400;

const INTERESTING = new Set([
  "a",
  "button",
  "input",
  "select",
  "textarea",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "summary",
  "label",
  "option",
]);

/**
 * Script injected into the guest page. Returns a JSON-serializable tree.
 * Kept as a function so tests can reason about the formatter independently.
 */
export const PAGE_SNAPSHOT_SCRIPT = `(() => {
  const MAX_NODES = ${SNAPSHOT_MAX_NODES};
  const MAX_TEXT = ${SNAPSHOT_MAX_TEXT_CHARS};
  const interesting = new Set(${JSON.stringify([...INTERESTING])});
  const nodes = [];
  const headings = [];
  const alerts = [];

  const visible = (el) => {
    if (!(el instanceof Element)) return false;
    const st = window.getComputedStyle(el);
    if (st.display === "none" || st.visibility === "hidden" || st.opacity === "0") {
      return false;
    }
    const r = el.getBoundingClientRect();
    if (r.width < 2 && r.height < 2) return false;
    return true;
  };

  const nameOf = (el) => {
    const aria = el.getAttribute("aria-label");
    if (aria) return aria.trim().slice(0, 120);
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
      return (el.placeholder || el.name || el.type || "").trim().slice(0, 120);
    }
    const t = (el.innerText || el.textContent || "").replace(/\\s+/g, " ").trim();
    return t.slice(0, 120);
  };

  const fieldValue = (el) => {
    if (el instanceof HTMLInputElement) {
      if (el.type === "password") return el.value ? "••••" : "";
      if (el.type === "checkbox" || el.type === "radio") return el.checked ? "checked" : "unchecked";
      if (el.type === "file") return el.value ? "(file chosen)" : "";
      return String(el.value || "").slice(0, 80);
    }
    if (el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) {
      return String(el.value || "").slice(0, 80);
    }
    return null;
  };

  const walker = document.createTreeWalker(document.body || document.documentElement, NodeFilter.SHOW_ELEMENT);
  let el = walker.currentNode;
  while (el && nodes.length < MAX_NODES) {
    if (el instanceof Element && visible(el)) {
      const tag = el.tagName.toLowerCase();
      const role = (el.getAttribute("role") || "").trim();
      if (interesting.has(tag) || role) {
        const name = nameOf(el);
        if (name || role || tag === "input") {
          const ref = "e" + (nodes.length + 1);
          el.setAttribute("data-grok-preview-id", ref);
          const value = fieldValue(el);
          nodes.push({
            ref,
            tag,
            role: role || null,
            name: name || null,
            type: el instanceof HTMLInputElement ? el.type : null,
            value: value || null,
          });
        }
        if (/^h[1-6]$/.test(tag) && name) headings.push(name);
      }
      if (role === "alert" || role === "status" || el.getAttribute("aria-live")) {
        const t = (el.innerText || "").replace(/\\s+/g, " ").trim();
        if (t) alerts.push(t.slice(0, 200));
      }
    }
    el = walker.nextNode();
  }

  const pageText = ((document.body && document.body.innerText) || "")
    .replace(/\\s+/g, " ")
    .trim()
    .slice(0, MAX_TEXT);

  return {
    url: location.href,
    title: document.title || "",
    headings,
    alerts,
    text: pageText,
    nodes,
    truncated: Boolean(el),
  };
})()`;

/**
 * @param {{ url?: string, title?: string, headings?: string[], alerts?: string[], text?: string, nodes?: Array<Record<string, unknown>>, truncated?: boolean }} raw
 */
export function formatPreviewSnapshot(raw) {
  const url = String(raw?.url || "");
  const title = String(raw?.title || "").trim();
  const headings = Array.isArray(raw?.headings) ? raw.headings : [];
  const alerts = Array.isArray(raw?.alerts) ? raw.alerts : [];
  const pageText = String(raw?.text || "").trim();
  const nodes = Array.isArray(raw?.nodes) ? raw.nodes : [];

  const lines = [];
  lines.push(`URL: ${url || "(none)"}`);
  lines.push(`Title: ${title || "(untitled)"}`);
  if (alerts.length) {
    lines.push("Alerts:");
    for (const a of alerts.slice(0, 12)) lines.push(`  - ${a}`);
  }
  if (headings.length) {
    lines.push("Headings:");
    for (const h of headings.slice(0, 24)) lines.push(`  - ${h}`);
  }
  if (pageText) {
    lines.push("Visible text:");
    lines.push(pageText);
  }
  lines.push("Controls:");
  if (!nodes.length) {
    lines.push("  (none detected)");
  } else {
    for (const n of nodes) {
      const tag = String(n.tag || "el");
      const role = n.role ? String(n.role) : "";
      const type = n.type ? String(n.type) : "";
      const name = n.name ? String(n.name) : "";
      const value = n.value != null && String(n.value) !== "" ? String(n.value) : "";
      const kind = [tag, role, type].filter(Boolean).join("/");
      const ref = n.ref ? `[${n.ref}] ` : "";
      let line = name ? `  - ${ref}${kind} "${name}"` : `  - ${ref}${kind}`;
      if (value) line += ` = ${JSON.stringify(value)}`;
      lines.push(line);
    }
  }
  lines.push(
    "Interact: preview_click / preview_fill / preview_fill_form / preview_press.",
  );
  if (raw?.truncated) {
    lines.push("(truncated — viewport controls only)");
  }

  let text = lines.join("\n");
  if (text.length > SNAPSHOT_MAX_CHARS) {
    text = `${text.slice(0, SNAPSHOT_MAX_CHARS - 20)}\n…(truncated)`;
  }
  return text;
}

/** Footer the MCP layer appends so the model does not fall back to pixels. */
export const SNAPSHOT_NO_SCREENSHOT_HINT =
  "This is the page as text. The user can see the Preview window.";
