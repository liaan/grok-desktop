import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { basen } from "../../lib/path-utils";
import { fileFromDiffPayload, shouldRenderDiff } from "../../lib/line-diff";
import { usePrivacy } from "../../lib/privacy-context";
import { DiffView } from "../DiffView";
import { MarkdownPeek } from "./MarkdownPeek";
import { isMarkdownPath } from "./markdown-doc";
import { canEditFile, isDirty, type FileDocument } from "./types";

const PEEK_CHAR_CAP = 200_000;

export function FilePeek({
  doc,
  project,
  editorLabel,
  copied,
  saving,
  saveError,
  openError,
  onDraftChange,
  onSave,
  onOpenEditor,
  onOpenLinkedFile,
  onCopyPath,
  onClose,
}: {
  doc: FileDocument;
  project: string;
  editorLabel: string;
  copied: boolean;
  saving: boolean;
  saveError: string | null;
  openError: string | null;
  onDraftChange: (draft: string) => void;
  onSave: () => void;
  onOpenEditor: () => void;
  onOpenLinkedFile: (absPath: string) => boolean;
  onCopyPath: () => void;
  onClose: () => void;
}) {
  const { redact } = usePrivacy();
  const dirty = isDirty(doc);
  const canEdit = canEditFile(doc);
  const peekIsBinary =
    doc.binary || Boolean(doc.saved && doc.saved.includes("\u0000"));
  // Ready files use the draft, including an emptied buffer. Falling through
  // to `saved` on a falsy draft would hide unsaved deletions in preview.
  const sourceText =
    doc.kind === "file"
      ? doc.status === "ready"
        ? doc.draft
        : doc.saved
      : doc.saved;
  const markdownFile =
    doc.kind === "file" &&
    !peekIsBinary &&
    doc.error !== "Binary file" &&
    isMarkdownPath(doc.path);
  const [viewFor, setViewFor] = useState(doc.absPath);
  const [sourceMode, setSourceMode] = useState(false);
  if (viewFor !== doc.absPath) {
    setViewFor(doc.absPath);
    setSourceMode(false);
  }
  const pendingHash = useRef<string | null>(null);
  const showMarkdown =
    markdownFile && !sourceMode && doc.status === "ready" && !doc.error;
  // A link hash is consumed by the markdown view. Drop it when that view
  // is not what mounted, so a later file does not scroll to a stale anchor.
  useEffect(() => {
    if (doc.status !== "ready") return;
    if (!showMarkdown) pendingHash.current = null;
  }, [doc.status, doc.absPath, showMarkdown]);

  const peekDiff = useMemo(() => {
    if (doc.kind !== "diff" || doc.saved == null) return null;
    return {
      files: [fileFromDiffPayload({ path: doc.path, patch: doc.saved })],
    };
  }, [doc]);

  const peekFileText = useMemo(() => {
    if (sourceText == null) return null;
    if (sourceText.includes("\u0000")) return null;
    if (sourceText.length > PEEK_CHAR_CAP) {
      return `${sourceText.slice(0, PEEK_CHAR_CAP)}\n… (truncated)`;
    }
    return sourceText;
  }, [sourceText]);

  const onPeekKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.repeat) return;
    if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "s") return;
    if (!canEdit) return;
    e.preventDefault();
    onSave();
  };

  return (
    <div className="file-peek" onKeyDown={onPeekKeyDown}>
      <div className="file-peek-header">
        <span className="file-peek-title" title={redact(doc.path)}>
          {dirty ? "• " : ""}
          {basen(doc.path)}
        </span>
        {markdownFile && doc.status === "ready" && !doc.error ? (
          <button
            type="button"
            className="btn ghost btn-sm"
            title={
              sourceMode ? "Show rendered markdown" : "Show markdown source"
            }
            onClick={() => setSourceMode((on) => !on)}
          >
            {sourceMode ? "Preview" : "Source"}
          </button>
        ) : null}
        {canEdit ? (
          <button
            type="button"
            className="btn ghost btn-sm"
            title="Save (⌘S)"
            disabled={!dirty || saving}
            onClick={() => onSave()}
          >
            {saving ? "Saving…" : dirty ? "Save" : "Saved"}
          </button>
        ) : null}
        <button
          type="button"
          className="btn ghost btn-sm"
          title={`Open in ${editorLabel}`}
          onClick={() => onOpenEditor()}
        >
          {editorLabel}
        </button>
        <button
          type="button"
          className="btn ghost btn-sm"
          title="Copy path"
          onClick={() => onCopyPath()}
        >
          {copied ? "Copied" : "Copy"}
        </button>
        <button
          type="button"
          className="btn ghost btn-sm file-reveal"
          title="Show in folder"
          aria-label={`Show ${basen(doc.path)} in folder`}
          onClick={() => void window.grokDesktop.showItem(doc.absPath)}
        >
          ↗
        </button>
        <button
          type="button"
          className="btn ghost btn-sm"
          title="Close"
          aria-label="Close"
          onClick={() => onClose()}
        >
          ×
        </button>
      </div>
      {saveError || openError ? (
        <p className="file-peek-error">{saveError || openError}</p>
      ) : null}
      <div className="file-peek-body">
        {doc.status === "loading" ? (
          <p style={{ color: "var(--text-muted)", fontSize: 13 }}>Loading…</p>
        ) : doc.error && doc.error !== "Binary file" ? (
          <p style={{ color: "var(--danger, #f87171)", fontSize: 13 }}>
            {doc.error}
          </p>
        ) : doc.kind === "diff" && peekDiff && shouldRenderDiff(peekDiff) ? (
          <DiffView diff={peekDiff} className="file-peek-diff" />
        ) : doc.kind === "diff" ? (
          <p style={{ color: "var(--text-muted)", fontSize: 13 }}>
            No textual diff.
          </p>
        ) : peekIsBinary || doc.error === "Binary file" ? (
          <p style={{ color: "var(--text-muted)", fontSize: 13 }}>
            Binary file — open it in {editorLabel} instead.
          </p>
        ) : showMarkdown ? (
          <>
            {doc.truncated ? (
              <p style={{ color: "var(--text-muted)", fontSize: 12 }}>
                File is too large to edit here. Showing the start of it.
              </p>
            ) : null}
            <MarkdownPeek
              text={redact(peekFileText ?? "")}
              label={`Preview of ${basen(doc.path)}`}
              fileAbsPath={doc.absPath}
              project={project}
              onOpenFile={onOpenLinkedFile}
              pendingHash={pendingHash}
            />
          </>
        ) : doc.truncated ? (
          <>
            <p style={{ color: "var(--text-muted)", fontSize: 12 }}>
              File is too large to edit here. Open it in {editorLabel}.
            </p>
            {peekFileText != null ? (
              <pre className="file-peek-text">{redact(peekFileText)}</pre>
            ) : null}
          </>
        ) : canEdit ? (
          <textarea
            className="file-peek-editor"
            value={doc.draft}
            spellCheck={false}
            aria-label={`Edit ${basen(doc.path)}`}
            onChange={(e) => onDraftChange(e.target.value)}
          />
        ) : peekFileText != null ? (
          <pre className="file-peek-text">{redact(peekFileText)}</pre>
        ) : null}
      </div>
    </div>
  );
}
