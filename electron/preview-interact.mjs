/**
 * Guest-page click / fill / press. Snapshot stamps data-grok-preview-id.
 */

export const PAGE_ACTION_SOURCE = `function grokPreviewAction(action) {
  const act = action && typeof action === "object" ? action : {};
  const kind = String(act.action || "click");
  const find = () => {
    const ref = String(act.ref || act.uid || "").trim();
    if (ref) {
      const id = ref.replace(/^\\[|\\]$/g, "");
      const byId = document.querySelector("[data-grok-preview-id=\\"" + id + "\\"]");
      if (byId) return byId;
    }
    const selector = String(act.selector || "").trim();
    if (selector) {
      try {
        const el = document.querySelector(selector);
        if (el) return el;
      } catch (e) {}
    }
    const name = String(act.name || act.text || "").trim().toLowerCase();
    if (!name) return null;
    const all = document.querySelectorAll("a,button,input,select,textarea,summary,label,[role]");
    for (const el of all) {
      const bits = [
        el.getAttribute("aria-label"),
        el.getAttribute("placeholder"),
        el.getAttribute("name"),
        el.getAttribute("id"),
        el.type,
        el.innerText,
        el.textContent,
      ]
        .filter(Boolean)
        .join(" ")
        .replace(/\\s+/g, " ")
        .trim()
        .toLowerCase();
      if (bits.includes(name)) return el;
    }
    return null;
  };

  const setReactValue = (el, value) => {
    const proto =
      el instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
    const desc = Object.getOwnPropertyDescriptor(proto, "value");
    if (desc && desc.set) desc.set.call(el, value);
    else el.value = value;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  };

  const describe = (el) => {
    if (!el) return null;
    return {
      tag: el.tagName.toLowerCase(),
      type: el.type || null,
      name: el.getAttribute("name") || null,
      ref: el.getAttribute("data-grok-preview-id") || null,
    };
  };

  if (kind === "press") {
    const key = String(act.key || "Enter");
    const el = find() || document.activeElement;
    if (el && el instanceof HTMLElement) el.focus();
    const evInit = { key, code: key, keyCode: key === "Enter" ? 13 : 0, which: key === "Enter" ? 13 : 0, bubbles: true, cancelable: true };
    const target = document.activeElement || document.body;
    target.dispatchEvent(new KeyboardEvent("keydown", evInit));
    target.dispatchEvent(new KeyboardEvent("keypress", evInit));
    if (key === "Enter" && target instanceof HTMLFormElement) target.requestSubmit();
    else if (key === "Enter" && target.form) {
      if (typeof target.form.requestSubmit === "function") target.form.requestSubmit();
      else target.form.submit();
    }
    target.dispatchEvent(new KeyboardEvent("keyup", evInit));
    return { ok: true, action: "press", key, target: describe(target) };
  }

  const el = find();
  if (!el) {
    return { ok: false, error: "No matching control. Take a snapshot and use a ref like e3." };
  }
  if (el instanceof HTMLElement) {
    el.scrollIntoView({ block: "center", inline: "nearest" });
    el.focus();
  }

  if (kind === "fill" || kind === "type") {
    const value = act.value == null ? "" : String(act.value);
    if (el instanceof HTMLSelectElement) {
      el.value = value;
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    } else if (el instanceof HTMLInputElement && (el.type === "checkbox" || el.type === "radio")) {
      el.checked = value !== "false" && value !== "0";
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    } else {
      setReactValue(el, value);
    }
    return { ok: true, action: "fill", value, target: describe(el) };
  }

  if (el instanceof HTMLElement) el.click();
  return { ok: true, action: "click", target: describe(el) };
}`;

export function previewActionScript(action) {
  return `(${PAGE_ACTION_SOURCE})(${JSON.stringify(action || {})})`;
}
