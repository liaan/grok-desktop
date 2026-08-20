import { test } from "node:test";
import assert from "node:assert/strict";
import {
  clipboardPayloadFromMarkdown,
  isSafeHttpUrl,
  markdownToHtml,
  sanitizeCopiedHtml,
  wrapHtmlFragment,
} from "../shared/rich-clipboard.mjs";

test("markdownToHtml keeps bold, lists, code, and links", () => {
  const html = markdownToHtml(
    [
      "Hello **world** and *italics*",
      "",
      "- one",
      "- two",
      "",
      "```js",
      "const x = 1;",
      "```",
      "",
      "See [docs](https://example.com/path).",
    ].join("\n"),
  );
  assert.match(html, /<strong>world<\/strong>/);
  assert.match(html, /<em>italics<\/em>/);
  assert.match(html, /<ul>/);
  assert.match(html, /<li>one<\/li>/);
  assert.match(html, /<pre><code[^>]*>[\s\S]*const x = 1;/);
  assert.match(html, /<a href="https:\/\/example.com\/path">docs<\/a>/);
});

test("markdownToHtml maps GFM strikethrough and tables", () => {
  const html = markdownToHtml(
    ["~~old~~", "", "| A | B |", "| --- | --- |", "| 1 | 2 |"].join("\n"),
  );
  assert.match(html, /<del>old<\/del>/);
  assert.match(html, /<table>/);
  assert.match(html, /<th>A<\/th>/);
  assert.match(html, /<td>1<\/td>/);
});

test("sanitizeCopiedHtml strips styles so Slack will accept the paste", () => {
  const clean = sanitizeCopiedHtml(
    `<p class="body" style="color:#f2f2f5">Hi <strong class="x">there</strong></p>`,
  );
  assert.equal(clean, "<p>Hi <strong>there</strong></p>");
});

test("sanitizeCopiedHtml drops javascript URLs and data images", () => {
  const clean = sanitizeCopiedHtml(
    `<a href="javascript:alert(1)">x</a><img src="data:text/html,hi" alt="no">`,
  );
  assert.equal(clean.includes("javascript:"), false);
  assert.equal(clean.includes("data:"), false);
  assert.match(clean, /<a>x<\/a>/);
});

test("sanitizeCopiedHtml keeps http(s) hrefs and drops other tags", () => {
  const clean = sanitizeCopiedHtml(
    `<div><a href="https://x.ai" onclick="alert(1)">xAI</a><span>!</span></div>`,
  );
  assert.equal(clean, `<a href="https://x.ai">xAI</a>!`);
});

test("isSafeHttpUrl rejects non-http schemes", () => {
  assert.equal(isSafeHttpUrl("https://x.ai"), true);
  assert.equal(isSafeHttpUrl("http://localhost/a"), true);
  assert.equal(isSafeHttpUrl("javascript:alert(1)"), false);
  assert.equal(isSafeHttpUrl("file:///etc/passwd"), false);
  assert.equal(isSafeHttpUrl("//evil.example"), false);
});

test("clipboard payload is HTML fragment plus original markdown", () => {
  const md = "Use **bold**.";
  const payload = clipboardPayloadFromMarkdown(md);
  assert.equal(payload.text, md);
  assert.match(payload.html, /<!--StartFragment-->/);
  assert.match(payload.html, /<strong>bold<\/strong>/);
  assert.match(payload.html, /<!--EndFragment-->/);
});

test("wrapHtmlFragment is a full HTML clipboard document", () => {
  const wrapped = wrapHtmlFragment("<p>Hi</p>");
  assert.equal(
    wrapped,
    `<html><head><meta charset="utf-8"></head><body><!--StartFragment--><p>Hi</p><!--EndFragment--></body></html>`,
  );
});

test("code fences are not interpreted as markdown inside", () => {
  const html = markdownToHtml("```\n**not bold**\n```");
  assert.match(html, /<pre><code>/);
  assert.equal(html.includes("<strong>"), false);
  assert.match(html, /\*\*not bold\*\*/);
});
