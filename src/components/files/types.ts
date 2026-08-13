export type FileEntry = { name: string; isDirectory: boolean; path: string };

export type GitStatusEntry = {
  path: string;
  origPath: string | null;
  index: string;
  worktree: string;
  status: string;
  untracked: boolean;
  staged: boolean;
  unstaged: boolean;
};

export type PeekTarget =
  | { kind: "file"; path: string; absPath: string }
  | { kind: "diff"; path: string; absPath: string; staged: boolean };

export type FileDocument = {
  status: "loading" | "ready" | "error";
  path: string;
  absPath: string;
  kind: "file" | "diff";
  staged?: boolean;
  draft: string;
  saved: string | null;
  binary: boolean;
  truncated: boolean;
  error: string | null;
};

export function joinProjectPath(root: string, rel: string): string {
  const r = root.replace(/[/\\]+$/, "");
  const p = String(rel || "").replace(/\\/g, "/");
  if (!p) return r;
  if (p.startsWith("/") || /^[A-Za-z]:/.test(p)) return rel;
  const sep = root.includes("\\") ? "\\" : "/";
  return `${r}${sep}${p.replace(/\//g, sep)}`;
}

export function isDirty(doc: FileDocument | null): boolean {
  return Boolean(
    doc &&
      doc.kind === "file" &&
      !doc.binary &&
      !doc.truncated &&
      doc.saved != null &&
      doc.draft !== doc.saved,
  );
}

export function canEditFile(doc: FileDocument | null): boolean {
  return Boolean(
    doc &&
      doc.kind === "file" &&
      doc.status === "ready" &&
      !doc.binary &&
      !doc.truncated &&
      !doc.error,
  );
}

function absPathKey(p: string): string {
  let s = String(p || "").replace(/\\/g, "/");
  if (/^[a-zA-Z]:/.test(s)) s = s.toLowerCase();
  if (s.length > 1 && s.endsWith("/")) s = s.replace(/\/+$/, "");
  return s;
}

/** Apply a finished write only to the peek that started it. */
export function finishSave(
  doc: FileDocument | null,
  opts: { seq: number; currentSeq: number; absPath: string; written: string },
): FileDocument | null {
  if (opts.seq !== opts.currentSeq || !doc) return doc;
  if (absPathKey(doc.absPath) !== absPathKey(opts.absPath)) return doc;
  return { ...doc, saved: opts.written };
}
