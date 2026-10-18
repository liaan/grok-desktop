import { useCallback, useEffect, useRef, useState } from "react";
import { useI18n } from "../lib/i18n";
import {
  normalizePermissionMode,
  type PermissionMode,
} from "../lib/permission-mode";
import {
  DEFAULT_REASONING_EFFORT,
  normalizeReasoningEffort,
  reasoningEffortLabel,
  type ReasoningEffort,
} from "../lib/reasoning-effort";

/**
 * Permission mode, reasoning effort, sandbox terminal, allow-outside-project.
 */
export function useAgentSafety(opts: {
  setError: (msg: string | null) => void;
  appendSystem?: (text: string) => void;
}) {
  const { setError, appendSystem } = opts;
  const { t } = useI18n();
  const [permissionMode, setPermissionMode] =
    useState<PermissionMode>("ask");
  const [reasoningEffort, setReasoningEffort] = useState<ReasoningEffort>(
    DEFAULT_REASONING_EFFORT,
  );
  const [allowOutsideProject, setAllowOutsideProject] = useState(false);
  const [sandboxTerminal, setSandboxTerminal] = useState(true);
  const [sandboxStatus, setSandboxStatus] = useState("");
  const sandboxApplyLock = useRef(false);

  useEffect(() => {
    const off = window.grokDesktop.on("agent:permission-mode", (payload) => {
      const mode = normalizePermissionMode(
        (payload as { mode?: string })?.mode,
      );
      setPermissionMode(mode);
    });
    return () => off();
  }, []);

  const hydrateFromInfo = useCallback(
    (i: {
      permissionMode?: string;
      alwaysApprove?: boolean;
      reasoningEffort?: string;
      allowOutsideProject?: boolean;
      sandboxTerminal?: boolean;
      sandboxStatus?: string;
    }) => {
      setPermissionMode(
        normalizePermissionMode(i.permissionMode, i.alwaysApprove),
      );
      setReasoningEffort(normalizeReasoningEffort(i.reasoningEffort));
      setAllowOutsideProject(Boolean(i.allowOutsideProject));
      setSandboxTerminal(i.sandboxTerminal !== false);
      setSandboxStatus(i.sandboxStatus || "");
    },
    [],
  );

  const applyPermissionMode = useCallback(
    async (next: PermissionMode) => {
      if (
        next === "always-approve" &&
        permissionMode !== "always-approve" &&
        !window.confirm(t("safety.confirmAlways"))
      ) {
        return;
      }
      try {
        const result = await window.grokDesktop.setPermissionMode(next);
        const mode = normalizePermissionMode(result.mode);
        setPermissionMode(mode);
        if (result.agentSynced === false && result.error) {
          setError(
            t("err.permissionModeNotSynced", {
              mode,
              error: result.error,
            }),
          );
        } else {
          setError(null);
        }
        appendSystem?.(t("sys.permMode", { mode }));
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        setError(t("err.setPermissionModeFailed", { msg }));
      }
    },
    [permissionMode, setError, appendSystem, t],
  );

  const applyReasoningEffort = useCallback(
    async (next: ReasoningEffort) => {
      try {
        const result = await window.grokDesktop.setReasoningEffort(next);
        const effort = normalizeReasoningEffort(result.effort);
        setReasoningEffort(effort);
        if (result.agentSynced === false && result.error) {
          setError(
            t("err.effortNotSynced", { effort, error: result.error }),
          );
        } else {
          setError(null);
        }
        appendSystem?.(
          t("sys.reasoningEffort", {
            label: reasoningEffortLabel(effort),
            effort,
          }),
        );
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        setError(t("err.setReasoningEffortFailed", { msg }));
      }
    },
    [setError, appendSystem, t],
  );

  const toggleAllowOutside = useCallback(async () => {
    const next = !allowOutsideProject;
    if (
      next &&
      !window.confirm(t("safety.confirmOutside"))
    ) {
      return;
    }
    const value = await window.grokDesktop.setAllowOutsideProject(next);
    setAllowOutsideProject(value);
  }, [allowOutsideProject, t]);

  const applySandboxTerminal = useCallback(
    async (next: boolean) => {
      if (sandboxApplyLock.current) return;
      if (next === sandboxTerminal) return;
      if (
        next === false &&
        !window.confirm(t("safety.confirmNoSandbox"))
      ) {
        return;
      }
      sandboxApplyLock.current = true;
      try {
        const value = await window.grokDesktop.setSandboxTerminal(next);
        setSandboxTerminal(value);
      } finally {
        sandboxApplyLock.current = false;
      }
    },
    [sandboxTerminal, t],
  );

  return {
    permissionMode,
    reasoningEffort,
    allowOutsideProject,
    sandboxTerminal,
    sandboxStatus,
    hydrateFromInfo,
    applyPermissionMode,
    applyReasoningEffort,
    toggleAllowOutside,
    applySandboxTerminal,
  };
}
