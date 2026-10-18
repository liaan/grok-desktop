import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { basen } from "../../lib/path-utils";
import { fileFromDiffPayload, shouldRenderDiff } from "../../lib/line-diff";
import { usePrivacy } from "../../lib/privacy-context";
import { useI18n } from "../../lib/i18n";
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
  const { t } = useI18n();
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
      return `${sourceText.slice(0, PEEK_CHAR_CAP)}\n${t("peek.truncated")}`;
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
            title={sourceMode ? t("peek.showRendered") : t("peek.showSource")}
            onClick={() => setSourceMode((on) => !on)}
          >
            {sourceMode ? t("peek.preview") : t("peek.source")}
          </button>
        ) : null}
        {canEdit ? (
          <button
            type="button"
            className="btn ghost btn-sm"
            title={t("peek.saveTitle")}
            disabled={!dirty || saving}
            onClick={() => onSave()}
          >
            {saving ? t("peek.saving") : dirty ? t("peek.save") : t("peek.saved")}
          </button>
        ) : null}
        <button
          type="button"
          className="btn ghost btn-sm"
          title={t("peek.openIn", { editor: editorLabel })}
          onClick={() => onOpenEditor()}
        >
          {editorLabel}
        </button>
        <button
          type="button"
          className="btn ghost btn-sm"
          title={t("files.copyPath")}
          onClick={() => onCopyPath()}
        >
          {copied ? t("peek.copied") : t("peek.copy")}
        </button>
        <button
          type="button"
          className="btn ghost btn-sm file-reveal"
          title={t("files.showFolder")}
          aria-label={t("peek.showInFolderAria", { name: basen(doc.path) })}
          onClick={() => void window.grokDesktop.showItem(doc.absPath)}
        >
          ↗
        </button>
        <button
          type="button"
          className="btn ghost btn-sm"
          title={t("files.close")}
          aria-label={t("files.close")}
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
          <p style={{ color: "var(--text-muted)", fontSize: 13 }}>{t("files.loading")}</p>
        ) : doc.error && doc.error !== "Binary file" ? (
          <p style={{ color: "var(--danger, #f87171)", fontSize: 13 }}>
            {doc.error}
          </p>
        ) : doc.kind === "diff" && peekDiff && shouldRenderDiff(peekDiff) ? (
          <DiffView diff={peekDiff} className="file-peek-diff" />
        ) : doc.kind === "diff" ? (
          <p style={{ color: "var(--text-muted)", fontSize: 13 }}>
            {t("peek.noDiff")}
          </p>
        ) : peekIsBinary || doc.error === "Binary file" ? (
          <p style={{ color: "var(--text-muted)", fontSize: 13 }}>
            {t("peek.binaryHint", { editor: editorLabel })}
          </p>
        ) : showMarkdown ? (
          <>
            {doc.truncated ? (
              <p style={{ color: "var(--text-muted)", fontSize: 12 }}>
                {t("peek.tooLargePreview")}
              </p>
            ) : null}
            <MarkdownPeek
              text={redact(peekFileText ?? "")}
              label={t("peek.previewOf", { name: basen(doc.path) })}
              fileAbsPath={doc.absPath}
              project={project}
              onOpenFile={onOpenLinkedFile}
              pendingHash={pendingHash}
            />
          </>
        ) : doc.truncated ? (
          <>
            <p style={{ color: "var(--text-muted)", fontSize: 12 }}>
              {t("peek.tooLargeEdit", { editor: editorLabel })}
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
            aria-label={t("peek.editAria", { name: basen(doc.path) })}
            onChange={(e) => onDraftChange(e.target.value)}
          />
        ) : peekFileText != null ? (
          <pre className="file-peek-text">{redact(peekFileText)}</pre>
        ) : null}
      </div>
    </div>
  );
}
