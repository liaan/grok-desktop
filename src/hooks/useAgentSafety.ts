import { useCallback, useRef, useState } from "react";
import {
  normalizePermissionMode,
  type PermissionMode,
} from "../lib/permission-mode";

/**
 * Permission mode, sandbox terminal, allow-outside-project.
 */
export function useAgentSafety(opts: {
  setError: (msg: string | null) => void;
  appendSystem?: (text: string) => void;
}) {
  const { setError, appendSystem } = opts;
  const [permissionMode, setPermissionMode] =
    useState<PermissionMode>("ask");
  const [allowOutsideProject, setAllowOutsideProject] = useState(false);
  const [sandboxTerminal, setSandboxTerminal] = useState(true);
  const [sandboxStatus, setSandboxStatus] = useState("");
  const sandboxApplyLock = useRef(false);

  const hydrateFromInfo = useCallback(
    (i: {
      permissionMode?: string;
      alwaysApprove?: boolean;
      allowOutsideProject?: boolean;
      sandboxTerminal?: boolean;
      sandboxStatus?: string;
    }) => {
      setPermissionMode(
        normalizePermissionMode(i.permissionMode, i.alwaysApprove),
      );
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
        !window.confirm(
          "Enable Always approve?\n\nTools will run without the Approvals panel. Deny rules and plan-mode edit gates still apply.",
        )
      ) {
        return;
      }
      try {
        const result = await window.grokDesktop.setPermissionMode(next);
        const mode = normalizePermissionMode(result.mode);
        setPermissionMode(mode);
        if (result.agentSynced === false && result.error) {
          setError(
            `Permission mode set to ${mode} on the client, but the agent did not sync (${result.error}). New chats will pick up the mode from session meta.`,
          );
        } else {
          setError(null);
        }
        appendSystem?.(`Tool permission mode: ${mode}`);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        setError(`Failed to set permission mode: ${msg}`);
      }
    },
    [permissionMode, setError, appendSystem],
  );

  const toggleAllowOutside = useCallback(async () => {
    const next = !allowOutsideProject;
    if (
      next &&
      !window.confirm(
        "Allow the agent to read/write files and use working directories outside this project?\n\nThis reduces safety. Prefer leaving it off unless you need it.",
      )
    ) {
      return;
    }
    const value = await window.grokDesktop.setAllowOutsideProject(next);
    setAllowOutsideProject(value);
  }, [allowOutsideProject]);

  const applySandboxTerminal = useCallback(
    async (next: boolean) => {
      if (sandboxApplyLock.current) return;
      if (next === sandboxTerminal) return;
      if (
        next === false &&
        !window.confirm(
          "Disable terminal sandbox?\n\nTool shells will run with your full user account on the host. The agent can read ~/.ssh, talk to Docker, and wipe containers.\n\nLeave sandbox on unless you need unrestricted host access.",
        )
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
    [sandboxTerminal],
  );

  return {
    permissionMode,
    allowOutsideProject,
    sandboxTerminal,
    sandboxStatus,
    hydrateFromInfo,
    applyPermissionMode,
    toggleAllowOutside,
    applySandboxTerminal,
  };
}
