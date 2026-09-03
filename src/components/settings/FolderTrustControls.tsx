import { useCallback, useEffect, useState } from "react";
import { needsFolderTrust } from "../../../shared/mcp-status.mjs";
import type { McpServerInfo } from "../../vite-env";

type DoctorView = {
  error?: string | null;
  checks?: Array<{ passed: boolean; label: string; detail?: string | null }>;
};

type ParkedTrust = {
  reqId: string;
};

/**
 * Settings recovery for `x.ai/folder_trust/request`.
 * Settles a parked gate when present; otherwise points at `/hooks-trust` in chat.
 */
export function useFolderTrustAction({
  hasProject,
  restarting,
  onNote,
  onReload,
}: {
  hasProject: boolean;
  restarting: boolean;
  onNote: (note: string | null) => void;
  onReload: (cache?: boolean) => Promise<unknown>;
}) {
  const [parked, setParked] = useState<ParkedTrust | null>(null);
  const [trustBusy, setTrustBusy] = useState(false);

  const refreshParked = useCallback(async () => {
    try {
      const gates = await window.grokDesktop.listPendingGates();
      const row = Array.isArray(gates?.folderTrust) ? gates.folderTrust[0] : null;
      setParked(row?.reqId ? { reqId: row.reqId } : null);
    } catch {
      setParked(null);
    }
  }, []);

  useEffect(() => {
    void refreshParked();
    const offs = [
      window.grokDesktop.on("agent:folder-trust-request", (payload) => {
        const reqId = (payload as { reqId?: string })?.reqId;
        setParked(reqId ? { reqId } : null);
      }),
      window.grokDesktop.on("agent:folder-trust-dismiss", (payload) => {
        const reqId = (payload as { reqId?: string })?.reqId;
        setParked((cur) => {
          if (!cur) return null;
          if (reqId && cur.reqId !== reqId) return cur;
          return null;
        });
      }),
    ];
    return () => offs.forEach((off) => off());
  }, [refreshParked]);

  const onTrustFolder = useCallback(async () => {
    if (!hasProject) {
      onNote("Open a project first, then trust the folder.");
      return;
    }
    setTrustBusy(true);
    onNote(null);
    try {
      const gates = await window.grokDesktop.listPendingGates();
      const row = Array.isArray(gates?.folderTrust) ? gates.folderTrust[0] : null;
      setParked(row?.reqId ? { reqId: row.reqId } : null);
      if (!row?.reqId) {
        onNote(
          "No trust prompt is waiting. Type /hooks-trust in chat to be asked again.",
        );
        return;
      }
      const ok = await window.grokDesktop.respondFolderTrust(row.reqId, {
        outcome: "trust",
      });
      if (!ok) {
        onNote("Could not record folder trust. Try again.");
        return;
      }
      setParked(null);
      await onReload(false);
      onNote("Folder trusted.");
    } catch (e: unknown) {
      onNote(e instanceof Error ? e.message : String(e));
    } finally {
      setTrustBusy(false);
    }
  }, [hasProject, onNote, onReload]);

  return {
    parked,
    trustBusy,
    trustLocked: trustBusy || restarting || !hasProject || !parked,
    onTrustFolder,
  };
}

export function folderTrustButtonTitle(
  hasProject: boolean,
  parked: boolean,
): string {
  if (!hasProject) return "Open a project first";
  if (!parked) return "No waiting prompt — type /hooks-trust in chat";
  return "Trust this workspace for project MCP, hooks, and LSP";
}

export function folderTrustBannerVisible(
  parked: boolean,
  servers: McpServerInfo[],
  reports: Record<string, DoctorView | undefined>,
): boolean {
  if (parked) return true;
  return servers.some((s) => needsFolderTrust(s, reports[s.name]));
}

export function FolderTrustBanner({
  show,
  parked,
  trustBusy,
  trustLocked,
  hasProject,
  onTrust,
}: {
  show: boolean;
  parked: boolean;
  trustBusy: boolean;
  trustLocked: boolean;
  hasProject: boolean;
  onTrust: () => void;
}) {
  if (!show) return null;
  return (
    <div className="mcp-trust-banner">
      <p className="settings-desc">
        {parked ? (
          <>
            Project MCP stays unloaded until this folder is trusted — same as
            TUI <code>/hooks-trust</code>.
          </>
        ) : (
          <>
            This folder is not trusted. Type <code>/hooks-trust</code> in chat
            to get the Trust dialog again.
          </>
        )}
      </p>
      {parked ? (
        <button
          type="button"
          className="btn btn-sm primary"
          disabled={trustLocked}
          title={folderTrustButtonTitle(hasProject, parked)}
          onClick={onTrust}
        >
          {trustBusy ? "Trusting…" : "Trust folder"}
        </button>
      ) : null}
    </div>
  );
}
