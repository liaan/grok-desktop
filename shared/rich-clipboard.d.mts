/** Types for shared/rich-clipboard.mjs (renderer copy + tests). */

export function isSafeHttpUrl(href: string): boolean;
export function escapeHtml(s: string): string;
export function sanitizeCopiedHtml(html: string): string;
export function wrapHtmlFragment(inner: string): string;
export function markdownToHtml(md: string): string;
export function clipboardPayloadFromMarkdown(md: string): {
  text: string;
  html: string;
};
