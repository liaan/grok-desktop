import { useCallback, useState } from "react";
import { useI18n } from "../lib/i18n";

/** Confirm before leaving the project when the Files peek has unsaved edits. */
export function useUnsavedGuard() {
  const [filesDirty, setFilesDirty] = useState(false);
  const { t } = useI18n();
  const confirmDiscardFiles = useCallback(() => {
    if (!filesDirty) return true;
    return window.confirm(t("files.discardEdits"));
  }, [filesDirty, t]);
  return { filesDirty, setFilesDirty, confirmDiscardFiles };
}
