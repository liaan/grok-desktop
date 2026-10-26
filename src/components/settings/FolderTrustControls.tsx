import { useCallback, useEffect, useState } from "react";
import { needsFolderTrust } from "../../../shared/mcp-status.mjs";
import type { McpServerInfo } from "../../vite-env";
import { useI18n } from "../../lib/i18n";

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
  const { t } = useI18n();

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
      onNote(t("ft.openProjectFirst"));
      return;
    }
    setTrustBusy(true);
    onNote(null);
    try {
      const gates = await window.grokDesktop.listPendingGates();
      const row = Array.isArray(gates?.folderTrust) ? gates.folderTrust[0] : null;
      setParked(row?.reqId ? { reqId: row.reqId } : null);
      if (!row?.reqId) {
        onNote(t("ft.noPrompt"));
        return;
      }
      const ok = await window.grokDesktop.respondFolderTrust(row.reqId, {
        outcome: "trust",
      });
      if (!ok) {
        onNote(t("ft.recordFailed"));
        return;
      }
      setParked(null);
      await onReload(false);
      onNote(t("ft.trusted"));
    } catch (e: unknown) {
      onNote(e instanceof Error ? e.message : String(e));
    } finally {
      setTrustBusy(false);
    }
  }, [hasProject, onNote, onReload, t]);

  return {
    parked,
    trustBusy,
    trustLocked: trustBusy || restarting || !hasProject || !parked,
    onTrustFolder,
  };
}

export function folderTrustButtonTitle(
  t: (key: string) => string,
  hasProject: boolean,
  parked: boolean,
): string {
  if (!hasProject) return t("ft.btnTitleNoProject");
  if (!parked) return t("ft.btnTitleNoPrompt");
  return t("ft.btnTitle");
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
  const { t } = useI18n();
  if (!show) return null;
  return (
    <div className="mcp-trust-banner">
      <p className="settings-desc">
        {parked ? (
          <>{t("ft.bannerParked")}</>
        ) : (
          <>{t("ft.bannerUnparked")}</>
        )}
      </p>
      {parked ? (
        <button
          type="button"
          className="btn btn-sm primary"
          disabled={trustLocked}
          title={folderTrustButtonTitle(t, hasProject, parked)}
          onClick={onTrust}
        >
          {trustBusy ? t("ft.trusting") : t("ft.trustFolder")}
        </button>
      ) : null}
    </div>
  );
}
