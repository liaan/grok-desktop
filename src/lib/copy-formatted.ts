/**
 * Copy Grok replies as rich HTML + markdown so Slack/Docs keep formatting.
 */

import {
  clipboardPayloadFromMarkdown,
  escapeHtml,
  sanitizeCopiedHtml,
  wrapHtmlFragment,
} from "../../shared/rich-clipboard.mjs";

export async function writeRichClipboard(payload: {
  text: string;
  html?: string;
}): Promise<void> {
  const text = payload.text ?? "";
  const html = payload.html;
  const api = window.grokDesktop?.writeClipboard;
  if (typeof api === "function") {
    await api({ text, html });
    return;
  }
  if (
    html &&
    typeof ClipboardItem !== "undefined" &&
    navigator.clipboard?.write
  ) {
    await navigator.clipboard.write([
      new ClipboardItem({
        "text/plain": new Blob([text], { type: "text/plain" }),
        "text/html": new Blob([html], { type: "text/html" }),
      }),
    ]);
    return;
  }
  await navigator.clipboard.writeText(text);
}

export async function copyMarkdownRich(
  markdown: string,
  opts?: { markdownOnly?: boolean },
): Promise<void> {
  const md = String(markdown || "");
  if (opts?.markdownOnly) {
    await writeRichClipboard({ text: md });
    return;
  }
  const payload = clipboardPayloadFromMarkdown(md);
  await writeRichClipboard(payload);
}

function isTypingTarget(el: Element | null): boolean {
  if (!el) return false;
  const tag = el.tagName;
  if (tag === "TEXTAREA" || tag === "INPUT") return true;
  return (el as HTMLElement).isContentEditable === true;
}

function htmlToMarkdown(root: ParentNode): string {
  const walk = (node: Node): string => {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent || "";
    if (node.nodeType !== Node.ELEMENT_NODE) return "";
    const el = node as HTMLElement;
    const tag = el.tagName.toLowerCase();
    if (el.classList.contains("md-code-copy")) return "";
    const inner = () => Array.from(el.childNodes).map(walk).join("");
    if (el.classList.contains("md-codeblock")) {
      const pre = el.querySelector("pre");
      const body = (pre?.textContent || inner()).replace(/\n$/, "");
      return `\n\`\`\`\n${body}\n\`\`\`\n`;
    }
    switch (tag) {
      case "strong":
      case "b":
        return `**${inner()}**`;
      case "em":
      case "i":
        return `*${inner()}*`;
      case "del":
      case "s":
        return `~~${inner()}~~`;
      case "code":
        if (el.parentElement?.tagName === "PRE") return el.textContent || "";
        return `\`${el.textContent || ""}\``;
      case "pre":
        return `\n\`\`\`\n${(el.textContent || "").replace(/\n$/, "")}\n\`\`\`\n`;
      case "a": {
        const href = el.getAttribute("href") || "";
        return href ? `[${inner()}](${href})` : inner();
      }
      case "img": {
        const src = el.getAttribute("src") || "";
        const alt = el.getAttribute("alt") || "";
        return src ? `![${alt}](${src})` : alt;
      }
      case "h1":
        return `\n# ${inner().trim()}\n\n`;
      case "h2":
        return `\n## ${inner().trim()}\n\n`;
      case "h3":
        return `\n### ${inner().trim()}\n\n`;
      case "h4":
      case "h5":
      case "h6":
        return `\n#### ${inner().trim()}\n\n`;
      case "li": {
        const parent = el.parentElement?.tagName;
        const bullet = parent === "OL" ? "1. " : "- ";
        return `${bullet}${inner().trim()}\n`;
      }
      case "br":
        return "\n";
      case "p":
        return `${inner()}\n\n`;
      case "blockquote":
        return (
          inner()
            .trim()
            .split("\n")
            .map((line) => `> ${line}`)
            .join("\n") + "\n\n"
        );
      case "hr":
        return "\n---\n\n";
      case "tr": {
        const cells = Array.from(el.children).map((c) =>
          (c.textContent || "").trim(),
        );
        return `| ${cells.join(" | ")} |\n`;
      }
      case "table":
        return `\n${inner()}\n`;
      default:
        return inner();
    }
  };
  return Array.from(root.childNodes)
    .map(walk)
    .join("")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function elementOf(node: Node | null): Element | null {
  if (!node) return null;
  return node instanceof Element ? node : node.parentElement;
}

/** A rendered block usually ends with a newline that should not be part of the command. */
function trimCodeBlock(text: string): string {
  return text.replace(/\n$/, "");
}

type CodePlain = { text: string; block: boolean };

/**
 * Selection sits entirely inside one code block or one inline code span.
 * The characters on screen are the command or identifier — markdown fences
 * are not part of that text.
 */
function plainTextFromCodeSelection(sel: Selection): CodePlain | null {
  const a = elementOf(sel.anchorNode);
  const f = elementOf(sel.focusNode);
  if (!a || !f) return null;
  const preA = a.closest("pre");
  const preF = f.closest("pre");
  if (preA && preA === preF && preA.closest(".body.markdown")) {
    const raw = sel.toString();
    const full = preA.textContent || "";
    return {
      text: raw === full ? trimCodeBlock(full) : raw,
      block: true,
    };
  }
  const codeA = a.closest("code");
  const codeF = f.closest("code");
  if (
    codeA &&
    codeA === codeF &&
    !codeA.closest("pre") &&
    codeA.closest(".body.markdown")
  ) {
    return { text: sel.toString(), block: false };
  }
  return null;
}

/** Cloned range is only code blocks (a highlighted fence), not surrounding prose. */
function plainTextFromCodeFragment(holder: HTMLElement): CodePlain | null {
  const parts: string[] = [];
  let block = false;
  for (const n of Array.from(holder.childNodes)) {
    if (n.nodeType === Node.TEXT_NODE) {
      if ((n.textContent || "").trim()) return null;
      continue;
    }
    if (n.nodeType !== Node.ELEMENT_NODE) continue;
    const el = n as HTMLElement;
    if (el.classList.contains("md-code-copy") || el.tagName === "BUTTON") {
      continue;
    }
    if (el.classList.contains("md-codeblock")) {
      const pre = el.querySelector("pre");
      if (!pre) return null;
      block = true;
      parts.push(trimCodeBlock(pre.textContent || ""));
      continue;
    }
    if (el.tagName === "PRE") {
      block = true;
      parts.push(trimCodeBlock(el.textContent || ""));
      continue;
    }
    if (el.tagName === "CODE") {
      parts.push(el.textContent || "");
      continue;
    }
    return null;
  }
  if (parts.length === 0) return null;
  return { text: parts.join("\n"), block };
}

function htmlForCodePlain(plain: CodePlain): string {
  const body = escapeHtml(plain.text);
  return plain.block ? `<pre><code>${body}</code></pre>` : `<code>${body}</code>`;
}

/** Rich payload for the current selection inside a rendered reply, or null. */
export function selectionRichPayload(): { text: string; html: string } | null {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null;
  if (isTypingTarget(document.activeElement)) return null;

  const node = sel.anchorNode;
  const el = node instanceof Element ? node : node?.parentElement;
  if (!el?.closest(".body.markdown")) return null;

  const holder = document.createElement("div");
  holder.appendChild(sel.getRangeAt(0).cloneContents());
  const clean = sanitizeCopiedHtml(holder.innerHTML);
  if (!clean.trim() && !sel.toString().trim()) return null;
  const plain =
    plainTextFromCodeSelection(sel) ?? plainTextFromCodeFragment(holder);
  const text = (plain ? plain.text : htmlToMarkdown(holder)) || sel.toString();
  const html = wrapHtmlFragment(plain ? htmlForCodePlain(plain) : clean);
  return { text, html };
}

export function applyFormattedCopy(e: ClipboardEvent): boolean {
  if (!e.clipboardData) return false;
  const payload = selectionRichPayload();
  if (!payload) return false;
  e.preventDefault();
  e.clipboardData.setData("text/html", payload.html);
  e.clipboardData.setData("text/plain", payload.text);
  return true;
}

export async function copySelectionAsMarkdown(): Promise<boolean> {
  const payload = selectionRichPayload();
  const text = payload?.text || window.getSelection()?.toString() || "";
  if (!text) return false;
  await writeRichClipboard({ text });
  return true;
}

export function installCopySelectionMarkdownHook(): () => void {
  window.__grokCopySelectionMarkdown = () => {
    void copySelectionAsMarkdown();
  };
  return () => {
    delete window.__grokCopySelectionMarkdown;
  };
}
