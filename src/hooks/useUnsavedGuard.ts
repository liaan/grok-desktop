import { useCallback, useState } from "react";

/** Confirm before leaving the project when the Files peek has unsaved edits. */
export function useUnsavedGuard() {
  const [filesDirty, setFilesDirty] = useState(false);
  const confirmDiscardFiles = useCallback(() => {
    if (!filesDirty) return true;
    return window.confirm("Discard unsaved edits?");
  }, [filesDirty]);
  return { filesDirty, setFilesDirty, confirmDiscardFiles };
}
