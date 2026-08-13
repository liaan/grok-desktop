import { useCallback, useEffect, useRef, useState } from "react";
import { normalizePathKey } from "../../lib/path-utils";
import {
  canEditFile,
  finishSave,
  isDirty,
  type FileDocument,
  type PeekTarget,
} from "./types";

export function useFileDocument({
  project,
  onDirtyChange,
  onAfterSave,
}: {
  project: string | null;
  onDirtyChange?: (dirty: boolean) => void;
  onAfterSave?: () => void;
}) {
  const [doc, setDoc] = useState<FileDocument | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);
  const peekSeq = useRef(0);

  const dirty = isDirty(doc);
  const canEdit = canEditFile(doc);

  const confirmLeave = useCallback(() => {
    if (!dirty) return true;
    return window.confirm("Discard unsaved edits?");
  }, [dirty]);

  const loadInto = useCallback(async (next: PeekTarget, seq: number) => {
    try {
      if (next.kind === "file") {
        const res = await window.grokDesktop.readFile(next.absPath);
        if (seq !== peekSeq.current) return;
        setDoc((d) =>
          d && d.absPath === next.absPath
            ? {
                ...d,
                status: "ready",
                draft: res.text,
                saved: res.text,
                binary: res.binary,
                truncated: res.truncated,
                error: null,
              }
            : d,
        );
      } else {
        const res = await window.grokDesktop.getGitDiff(next.path, {
          staged: next.staged,
        });
        if (seq !== peekSeq.current) return;
        setDoc((d) =>
          d && d.path === next.path
            ? {
                ...d,
                status: "ready",
                saved: res?.diff ?? "",
                draft: "",
                error: null,
              }
            : d,
        );
      }
    } catch (err) {
      if (seq !== peekSeq.current) return;
      setDoc((d) =>
        d
          ? {
              ...d,
              status: "error",
              error: err instanceof Error ? err.message : String(err),
            }
          : d,
      );
    }
  }, []);

  const openPeek = useCallback(
    (next: PeekTarget) => {
      if (!confirmLeave()) return;
      const seq = ++peekSeq.current;
      setSaving(false);
      setSaveError(null);
      setOpenError(null);
      setDoc({
        status: "loading",
        path: next.path,
        absPath: next.absPath,
        kind: next.kind,
        staged: next.kind === "diff" ? next.staged : undefined,
        draft: "",
        saved: null,
        binary: false,
        truncated: false,
        error: null,
      });
      void loadInto(next, seq);
    },
    [confirmLeave, loadInto],
  );

  const closePeek = useCallback(() => {
    if (!confirmLeave()) return;
    peekSeq.current += 1;
    setDoc(null);
    setSaving(false);
    setSaveError(null);
    setOpenError(null);
  }, [confirmLeave]);

  const reset = useCallback(() => {
    peekSeq.current += 1;
    setDoc(null);
    setSaving(false);
    setSaveError(null);
    setOpenError(null);
  }, []);

  const setDraft = useCallback((draft: string) => {
    setDoc((d) => (d ? { ...d, draft } : d));
  }, []);

  const openEditor = useCallback(
    async (absPath: string) => {
      if (
        dirty &&
        doc?.kind === "file" &&
        normalizePathKey(doc.absPath) === normalizePathKey(absPath)
      ) {
        if (
          !window.confirm(
            "This file has unsaved edits. Open the on-disk version anyway?",
          )
        ) {
          return;
        }
        try {
          const res = await window.grokDesktop.readFile(absPath);
          setDoc((d) =>
            d && normalizePathKey(d.absPath) === normalizePathKey(absPath)
              ? {
                  ...d,
                  draft: res.text,
                  saved: res.text,
                  binary: res.binary,
                  truncated: res.truncated,
                }
              : d,
          );
        } catch {
          /* still open the editor; next save will error if unreadable */
        }
      }
      setOpenError(null);
      try {
        await window.grokDesktop.openInEditor(absPath);
      } catch (err) {
        setOpenError(err instanceof Error ? err.message : String(err));
      }
    },
    [dirty, doc],
  );

  const savePeek = useCallback(async () => {
    if (!doc || doc.kind !== "file" || !canEdit) return;
    const seq = peekSeq.current;
    const absPath = doc.absPath;
    const written = doc.draft;
    setSaving(true);
    setSaveError(null);
    try {
      await window.grokDesktop.writeFile(absPath, written);
      if (seq !== peekSeq.current) return;
      setDoc((d) => finishSave(d, { seq, currentSeq: peekSeq.current, absPath, written }));
      onAfterSave?.();
    } catch (err) {
      if (seq !== peekSeq.current) return;
      setSaveError(err instanceof Error ? err.message : String(err));
    } finally {
      if (seq === peekSeq.current) setSaving(false);
    }
  }, [doc, canEdit, onAfterSave]);

  useEffect(() => {
    onDirtyChange?.(dirty);
    return () => onDirtyChange?.(false);
  }, [dirty, onDirtyChange]);

  useEffect(() => {
    reset();
  }, [project, reset]);

  return {
    doc,
    dirty,
    canEdit,
    saving,
    saveError,
    openError,
    confirmLeave,
    openPeek,
    closePeek,
    reset,
    setDraft,
    openEditor,
    savePeek,
  };
}
