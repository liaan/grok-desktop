/**
 * Clipboard payloads for Grok replies.
 *
 * Slack / Docs / Teams keep bold, lists, and code when the clipboard has
 * semantic HTML (not the flattened innerText you get from a normal select).
 * Plain text stays GFM markdown so GitHub / editors still get source.
 */

import { micromark } from "micromark";
import { gfm, gfmHtml } from "micromark-extension-gfm";

const ALLOWED_TAGS = new Set([
  "a",
  "b",
  "blockquote",
  "br",
  "code",
  "del",
  "em",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "hr",
  "i",
  "img",
  "li",
  "ol",
  "p",
  "pre",
  "s",
  "strong",
  "table",
  "tbody",
  "td",
  "th",
  "thead",
  "tr",
  "ul",
]);

const VOID_TAGS = new Set(["br", "hr", "img"]);

/**
 * @param {string} href
 * @returns {boolean}
 */
export function isSafeHttpUrl(href) {
  if (typeof href !== "string") return false;
  const t = href.trim();
  if (!t || t.startsWith("//")) return false;
  try {
    const u = new URL(t);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * @param {string} s
 * @returns {string}
 */
export function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * @param {string} raw
 * @returns {Record<string, string>}
 */
function parseAttrs(raw) {
  /** @type {Record<string, string>} */
  const attrs = {};
  const re =
    /([:A-Za-z_][:A-Za-z0-9._-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g;
  let m;
  while ((m = re.exec(String(raw || "")))) {
    attrs[m[1].toLowerCase()] = m[2] ?? m[3] ?? m[4] ?? "";
  }
  return attrs;
}

/**
 * Strip classes/styles/scripts so Slack does not throw away the paste as
 * "styled from another app". Only semantic tags + http(s) links/images.
 *
 * @param {string} html
 * @returns {string}
 */
export function sanitizeCopiedHtml(html) {
  const src = String(html || "").replace(/<!--[\s\S]*?-->/g, "");
  return src.replace(
    /<\/?([A-Za-z][A-Za-z0-9]*)\b([^>]*)>/g,
    (full, name, attrSrc) => {
      const tag = String(name).toLowerCase();
      const closing = full.startsWith("</");
      if (
        tag === "script" ||
        tag === "style" ||
        tag === "iframe" ||
        tag === "object" ||
        tag === "input"
      ) {
        return "";
      }
      if (!ALLOWED_TAGS.has(tag)) return "";
      if (closing) return VOID_TAGS.has(tag) ? "" : `</${tag}>`;

      const attrs = parseAttrs(attrSrc);
      /** @type {Record<string, string>} */
      const keep = {};
      if (tag === "a") {
        const href = attrs.href || "";
        if (isSafeHttpUrl(href)) keep.href = href;
      } else if (tag === "img") {
        const srcUrl = attrs.src || "";
        if (isSafeHttpUrl(srcUrl)) keep.src = srcUrl;
        if (attrs.alt) keep.alt = attrs.alt;
      } else if (tag === "ol" && attrs.start) {
        const n = Number(attrs.start);
        if (Number.isFinite(n) && n > 1) keep.start = String(Math.floor(n));
      }

      let out = `<${tag}`;
      for (const [k, v] of Object.entries(keep)) {
        out += ` ${k}="${escapeHtml(v)}"`;
      }
      out += ">";
      return out;
    },
  );
}

/**
 * HTML clipboard fragment. Slack (and Word) look for StartFragment.
 *
 * @param {string} inner
 * @returns {string}
 */
export function wrapHtmlFragment(inner) {
  const body = String(inner || "");
  return `<html><head><meta charset="utf-8"></head><body><!--StartFragment-->${body}<!--EndFragment--></body></html>`;
}

/**
 * Render GFM the same family as the chat (micromark + GFM), then sanitize.
 *
 * @param {string} md
 * @returns {string}
 */
export function markdownToHtml(md) {
  const raw = micromark(String(md || ""), {
    allowDangerousHtml: false,
    extensions: [gfm()],
    htmlExtensions: [gfmHtml()],
  });
  return sanitizeCopiedHtml(raw);
}

/**
 * @param {string} md
 * @returns {{ text: string, html: string }}
 */
export function clipboardPayloadFromMarkdown(md) {
  const text = String(md || "");
  return {
    text,
    html: wrapHtmlFragment(markdownToHtml(text)),
  };
}
