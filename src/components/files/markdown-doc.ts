/**
 * Markdown file preview: which paths render, and where a link in that
 * preview is allowed to go. http(s) leaves the app. Relative links and
 * project-root links (`/docs/a.md`) stay inside the open project.
 * Other schemes are ignored.
 */
import {
  isLexicallyUnder,
  normalizePathKey,
  parentDir,
  samePathKey,
} from "../../lib/path-utils.ts";

export function isMarkdownPath(path: string): boolean {
  const base = normalizePathKey(path).split("/").pop() || "";
  return /\.(?:md|markdown|mdx)$/i.test(base);
}

/** GitHub-style heading slug. Duplicate headings share an id. */
export function markdownSlug(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export type MarkdownLink =
  | { kind: "external"; url: string }
  | { kind: "anchor"; id: string }
  | { kind: "file"; absPath: string; hash: string }
  | { kind: "ignore" };

/**
 * Keep relative links, in-page anchors, http(s), and Windows paths.
 * Blank other schemes so they never land on the anchor's href.
 */
export function previewUrlTransform(url: string): string {
  const value = String(url ?? "");
  if (!value) return "";
  if (/^https?:\/\//i.test(value)) return value;
  if (/^[a-z]:[\\/]/i.test(value)) return value;
  if (/^[a-z][a-z0-9+.-]*:/i.test(value)) return "";
  return value;
}

export function classifyMarkdownHref(
  fileAbsPath: string,
  href: string,
  projectRoot: string | null,
): MarkdownLink {
  const raw = String(href ?? "").trim();
  if (!raw) return { kind: "ignore" };
  if (/^https?:\/\//i.test(raw)) return { kind: "external", url: raw };
  // A single letter before ":" is a Windows drive (`C:/...`), not a scheme.
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(raw);
  if ((scheme && scheme[1].length > 1) || raw.startsWith("//")) {
    return { kind: "ignore" };
  }

  if (raw.startsWith("#")) {
    const id = safeDecode(raw.slice(1));
    return id ? { kind: "anchor", id } : { kind: "ignore" };
  }
  if (!projectRoot) return { kind: "ignore" };

  const hashAt = raw.indexOf("#");
  const beforeHash = hashAt >= 0 ? raw.slice(0, hashAt) : raw;
  const hash = hashAt >= 0 ? safeDecode(raw.slice(hashAt + 1)) : "";
  const pathPart = (beforeHash.split("?")[0] ?? "").trim();
  if (!pathPart) return hash ? { kind: "anchor", id: hash } : { kind: "ignore" };

  let rel = pathPart;
  try {
    rel = decodeURIComponent(pathPart);
  } catch {
    /* keep the raw path part */
  }
  rel = rel.replace(/\\/g, "/");

  const abs = resolveDocPath(fileAbsPath, rel, projectRoot);
  if (!abs || !isLexicallyUnder(projectRoot, abs)) return { kind: "ignore" };
  if (samePathKey(abs, projectRoot)) return { kind: "ignore" };
  return { kind: "file", absPath: abs, hash };
}

function resolveDocPath(
  fileAbsPath: string,
  rel: string,
  projectRoot: string,
): string | null {
  if (rel.startsWith("/")) {
    const root = normalizePathKey(projectRoot).replace(/\/$/, "");
    return lexicalNormalize(`${root}/${rel.replace(/^\/+/, "")}`);
  }
  if (/^[A-Za-z]:/.test(rel)) return lexicalNormalize(rel);
  const dir = parentDir(fileAbsPath);
  if (!dir) return null;
  const prefix = normalizePathKey(dir).replace(/\/$/, "");
  return lexicalNormalize(`${prefix}/${rel}`);
}

/** Collapse `.` and `..`. Null when the path would leave the filesystem root. */
function lexicalNormalize(abs: string): string | null {
  const norm = normalizePathKey(abs);
  if (!norm) return null;
  const win = /^[A-Za-z]:/.test(norm);
  const parts = norm.split("/");
  const out: string[] = [];
  for (let i = 0; i < parts.length; i++) {
    const seg = parts[i];
    if (seg === "" || seg === ".") {
      if (i === 0 && seg === "") out.push("");
      continue;
    }
    if (seg === "..") {
      if (
        out.length === 0 ||
        (out.length === 1 && (out[0] === "" || /^[A-Za-z]:$/.test(out[0])))
      ) {
        return null;
      }
      out.pop();
      continue;
    }
    if (seg.includes("\0")) return null;
    out.push(seg);
  }
  if (out.length === 0) return null;
  if (out.length === 1 && out[0] === "") return "/";
  if (win && out.length === 1 && /^[A-Za-z]:$/.test(out[0])) {
    return `${out[0]}/`;
  }
  return out.join("/");
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
