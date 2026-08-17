import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  estimateImageTokens,
  estimateTextTokens,
  normalizePreviewUrl,
} from "../electron/preview-url.mjs";
import { formatPreviewSnapshot } from "../electron/preview-snapshot.mjs";

test("normalizePreviewUrl adds http when scheme is missing", () => {
  const r = normalizePreviewUrl("localhost:5173/app");
  assert.equal(r.ok, true);
  assert.equal(r.href, "http://localhost:5173/app");
});

test("normalizePreviewUrl allows https", () => {
  const r = normalizePreviewUrl("https://example.com/x");
  assert.equal(r.ok, true);
  assert.equal(r.href, "https://example.com/x");
});

test("normalizePreviewUrl rejects file and javascript", () => {
  assert.equal(normalizePreviewUrl("file:///etc/passwd").ok, false);
  assert.equal(normalizePreviewUrl("javascript:alert(1)").ok, false);
  assert.equal(normalizePreviewUrl("data:text/html,hi").ok, false);
});

test("normalizePreviewUrl rejects empty", () => {
  assert.equal(normalizePreviewUrl("").ok, false);
  assert.equal(normalizePreviewUrl("   ").ok, false);
});

test("formatPreviewSnapshot is compact text", () => {
  const text = formatPreviewSnapshot({
    url: "http://localhost:5173/",
    title: "Demo",
    headings: ["Welcome"],
    nodes: [
      { ref: "e1", tag: "button", role: null, name: "Save", type: null },
      { ref: "e2", tag: "input", role: null, name: "Email", type: "email" },
    ],
  });
  assert.match(text, /URL: http:\/\/localhost:5173\//);
  assert.match(text, /Title: Demo/);
  assert.match(text, /\[e1\].*Save/);
  assert.match(text, /\[e2\].*input\/email/);
  assert.match(text, /preview_fill/);
  assert.ok(text.length < 500);
});

test("desktop-preview skill names the Preview MCP tools", () => {
  const skill = fs.readFileSync(
    new URL("../electron/preview/SKILL.md", import.meta.url),
    "utf8",
  );
  assert.match(skill, /desktop-preview__preview_open/);
  assert.match(skill, /desktop-preview__preview_fill/);
  assert.match(skill, /preview_fill_form/);
  assert.match(skill, /PowerShell/);
  assert.match(skill, /cloakbrowser/i);
});

test("token heuristics stay in the expected ballpark", () => {
  assert.equal(estimateTextTokens("abcd".repeat(25)), 25);
  const img = estimateImageTokens(1280, 800);
  assert.ok(img >= 1000 && img <= 2500);
});
