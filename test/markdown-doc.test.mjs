/**
 * Markdown file preview: path detection and which links may open.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  classifyMarkdownHref,
  isMarkdownPath,
  markdownSlug,
  previewUrlTransform,
} from "../src/components/files/markdown-doc.ts";

const project = "/proj";
const doc = "/proj/docs/EXTERIOR_TYPE.md";

test("isMarkdownPath matches markdown extensions only", () => {
  assert.equal(isMarkdownPath("docs/EXTERIOR_TYPE.md"), true);
  assert.equal(isMarkdownPath("docs/EXTERIOR_TYPE.MD"), true);
  assert.equal(isMarkdownPath("README.markdown"), true);
  assert.equal(isMarkdownPath("note.mdx"), true);
  assert.equal(isMarkdownPath("docs/file.md.bak"), false);
  assert.equal(isMarkdownPath("src/a.ts"), false);
  assert.equal(isMarkdownPath("readme"), false);
});

test("markdownSlug matches GitHub heading anchors", () => {
  assert.equal(markdownSlug("Product shape"), "product-shape");
  assert.equal(markdownSlug("Hello, world!"), "hello-world");
  assert.equal(markdownSlug("  Already-slugged  "), "already-slugged");
});

test("classifyMarkdownHref opens sibling docs and blocks escapes", () => {
  assert.deepEqual(
    classifyMarkdownHref(doc, "MODEL_EXTERIOR_TWINS.md", project),
    { kind: "file", absPath: "/proj/docs/MODEL_EXTERIOR_TWINS.md", hash: "" },
  );
  assert.deepEqual(
    classifyMarkdownHref(doc, "./sub/Note.md#Product%20shape", project),
    { kind: "file", absPath: "/proj/docs/sub/Note.md", hash: "Product shape" },
  );
  assert.deepEqual(classifyMarkdownHref(doc, "../README.md", project), {
    kind: "file",
    absPath: "/proj/README.md",
    hash: "",
  });
  assert.deepEqual(classifyMarkdownHref(doc, "../../etc/passwd", project), {
    kind: "ignore",
  });
  assert.deepEqual(classifyMarkdownHref(doc, "/docs/A.md", project), {
    kind: "file",
    absPath: "/proj/docs/A.md",
    hash: "",
  });
  assert.deepEqual(classifyMarkdownHref(doc, "/../etc/passwd", project), {
    kind: "ignore",
  });
});

test("classifyMarkdownHref keeps web links and in-page anchors", () => {
  assert.deepEqual(classifyMarkdownHref(doc, "https://example.com/a", project), {
    kind: "external",
    url: "https://example.com/a",
  });
  assert.deepEqual(classifyMarkdownHref(doc, "http://example.com", project), {
    kind: "external",
    url: "http://example.com",
  });
  assert.deepEqual(classifyMarkdownHref(doc, "#product-shape", project), {
    kind: "anchor",
    id: "product-shape",
  });
  assert.deepEqual(classifyMarkdownHref(doc, "javascript:alert(1)", project), {
    kind: "ignore",
  });
  assert.deepEqual(classifyMarkdownHref(doc, "file:///etc/passwd", project), {
    kind: "ignore",
  });
  assert.deepEqual(classifyMarkdownHref(doc, "mailto:a@b.c", project), {
    kind: "ignore",
  });
  assert.deepEqual(classifyMarkdownHref(doc, "", project), { kind: "ignore" });
});

test("previewUrlTransform drops unsafe schemes and keeps doc links", () => {
  assert.equal(previewUrlTransform("javascript:alert(1)"), "");
  assert.equal(previewUrlTransform("file:///etc/passwd"), "");
  assert.equal(previewUrlTransform("https://example.com/a"), "https://example.com/a");
  assert.equal(previewUrlTransform("MODEL_EXTERIOR_TWINS.md"), "MODEL_EXTERIOR_TWINS.md");
  assert.equal(previewUrlTransform("#product-shape"), "#product-shape");
  assert.equal(previewUrlTransform("C:/repo/docs/A.md"), "C:/repo/docs/A.md");
});

test("classifyMarkdownHref resolves windows paths inside the project only", () => {
  const root = "C:/repo";
  const file = "C:/repo/docs/A.md";
  assert.deepEqual(classifyMarkdownHref(file, "../B.md", root), {
    kind: "file",
    absPath: "C:/repo/B.md",
    hash: "",
  });
  assert.deepEqual(classifyMarkdownHref(file, "C:/repo/../outside/x.md", root), {
    kind: "ignore",
  });
  assert.deepEqual(classifyMarkdownHref(file, "C:/repo/docs/C.md#h", root), {
    kind: "file",
    absPath: "C:/repo/docs/C.md",
    hash: "h",
  });
});
