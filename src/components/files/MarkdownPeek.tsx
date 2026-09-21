import { useEffect, useMemo, useRef, type ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { samePathKey } from "../../lib/path-utils";
import {
  classifyMarkdownHref,
  markdownSlug,
  previewUrlTransform,
  type MarkdownLink,
} from "./markdown-doc";

const REMARK_PLUGINS = [remarkGfm];

function textOf(node: ReactNode): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (typeof node === "object" && "props" in node) {
    const props = (node as { props?: { children?: ReactNode } }).props;
    return textOf(props?.children);
  }
  return "";
}

function findAnchor(root: HTMLElement, id: string): HTMLElement | null {
  const candidates = [id, markdownSlug(id)];
  const seen = new Set<string>();
  for (const candidate of candidates) {
    if (!candidate || seen.has(candidate)) continue;
    seen.add(candidate);
    try {
      const el = root.querySelector(`#${CSS.escape(candidate)}`);
      if (el instanceof HTMLElement) return el;
    } catch {
      /* ignore a selector the slug still could not form */
    }
  }
  return null;
}

function scrollToAnchor(root: HTMLElement | null, id: string) {
  if (!root || !id) return;
  findAnchor(root, id)?.scrollIntoView({ block: "start" });
}

function DocInput({
  type,
  checked,
}: {
  type?: string;
  checked?: boolean;
}) {
  if (type !== "checkbox") return null;
  return <input type="checkbox" checked={Boolean(checked)} disabled readOnly />;
}

function DocImage({ src, alt }: { src?: string; alt?: string }) {
  if (src && /^https?:\/\//i.test(src)) {
    return <img src={src} alt={alt || ""} loading="lazy" />;
  }
  return <span className="file-peek-img-missing">{alt?.trim() || "image"}</span>;
}

export function MarkdownPeek({
  text,
  label,
  fileAbsPath,
  project,
  onOpenFile,
  pendingHash,
}: {
  text: string;
  label: string;
  fileAbsPath: string;
  project: string;
  onOpenFile: (absPath: string) => boolean;
  pendingHash: { current: string | null };
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const openRef = useRef(onOpenFile);
  openRef.current = onOpenFile;

  useEffect(() => {
    const hash = pendingHash.current;
    if (!hash) return;
    const root = rootRef.current;
    let cancelled = false;
    // Clear the hash only once the frame sticks. Strict Mode runs the
    // effect twice and cancels the first frame; clearing earlier drops it.
    const frame = requestAnimationFrame(() => {
      if (cancelled || !root) return;
      pendingHash.current = null;
      scrollToAnchor(root, hash);
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
    };
  }, [text, fileAbsPath, pendingHash]);

  const components = useMemo<Components>(() => {
    const heading =
      (level: 1 | 2 | 3 | 4 | 5 | 6) =>
      function MdHeading({ children }: { children?: ReactNode }) {
        const id = markdownSlug(textOf(children)) || "section";
        const Tag = `h${level}` as "h1" | "h2" | "h3" | "h4" | "h5" | "h6";
        return <Tag id={id}>{children}</Tag>;
      };

    function DocLink({
      href,
      children,
    }: {
      href?: string;
      children?: ReactNode;
    }) {
      return (
        <a
          href={href}
          onClick={(e) => {
            e.preventDefault();
            if (!href) return;
            const link: MarkdownLink = classifyMarkdownHref(
              fileAbsPath,
              href,
              project,
            );
            if (link.kind === "external") {
              void window.grokDesktop.openExternal(link.url);
              return;
            }
            if (link.kind === "anchor") {
              scrollToAnchor(rootRef.current, link.id);
              return;
            }
            if (link.kind !== "file") return;
            if (samePathKey(link.absPath, fileAbsPath)) {
              if (link.hash) scrollToAnchor(rootRef.current, link.hash);
              return;
            }
            if (openRef.current(link.absPath) && link.hash) {
              pendingHash.current = link.hash;
            }
          }}
        >
          {children}
        </a>
      );
    }

    return {
      h1: heading(1),
      h2: heading(2),
      h3: heading(3),
      h4: heading(4),
      h5: heading(5),
      h6: heading(6),
      a: DocLink,
      img: DocImage,
      input: DocInput,
    } as Components;
  }, [fileAbsPath, pendingHash, project]);

  return (
    <div ref={rootRef} className="file-peek-markdown" aria-label={label}>
      {text.trim() ? (
        <ReactMarkdown
          remarkPlugins={REMARK_PLUGINS}
          urlTransform={previewUrlTransform}
          components={components}
        >
          {text}
        </ReactMarkdown>
      ) : (
        <p style={{ color: "var(--text-muted)", fontSize: 13 }}>
          This file is empty.
        </p>
      )}
    </div>
  );
}
