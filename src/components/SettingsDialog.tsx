import { useEffect, useRef, useState } from "react";
import { CodingDataPage } from "./settings/CodingDataPage";
import { DiagnosticsPage } from "./settings/DiagnosticsPage";
import { EnginePage } from "./settings/EnginePage";
import { GeneralPage } from "./settings/GeneralPage";
import { McpPage } from "./settings/McpPage";
import { PluginsPage } from "./settings/PluginsPage";
import { SafetyPage } from "./settings/SafetyPage";
import { SkillsPage } from "./settings/SkillsPage";
import { UpdatesPage } from "./settings/UpdatesPage";
import {
  PAGE_TITLES,
  SETTINGS_NAV,
  pageFromFocus,
  type SettingsPageId,
  type SettingsSharedProps,
} from "./settings/types";

/**
 * Full-screen settings: nav tree on the left, one page on the right.
 */
export function SettingsDialog({
  open,
  onClose,
  theme,
  privacyMode,
  codingDataOptIn,
  codingDataNote,
  permissionMode,
  allowOutsideProject,
  sandboxTerminal,
  sandboxStatus,
  debugLogging,
  debugLogPath,
  allowPrerelease,
  autoCompactAt,
  onSetTheme,
  onSetPrivacyMode,
  onSetCodingDataOptIn,
  onSetPermissionMode,
  onToggleAllowOutside,
  onSetSandboxTerminal,
  onSetDebugLogging,
  onSetAllowPrerelease,
  onSetAutoCompactAt,
  onOpenDebugLog,
  onRestartAgent,
  onRestartAfterWrite,
  restarting,
  offerRestart,
  grokBinary,
  hasProject,
  skills,
  skillsError,
  skillsLoading,
  focusSection,
  inert: overlayInert,
}: {
  open: boolean;
  onClose: () => void;
  /** True when Plan/Ask is stacked on top. */
  inert?: boolean;
} & SettingsSharedProps) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const pageRootRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const [page, setPage] = useState<SettingsPageId>("general");

  useEffect(() => {
    if (!open) {
      setPage("general");
      return;
    }
    setPage(pageFromFocus(focusSection));
  }, [open, focusSection]);

  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    const root = pageRootRef.current;
    if (!root) return;
    const onKey = (e: KeyboardEvent) => {
      if (root.inert) return;
      if (
        e.target instanceof Element &&
        e.target.closest("[data-modal-layer]")
      ) {
        return;
      }
      if (e.key === "Escape") {
        onCloseRef.current();
        return;
      }
      if (e.key !== "Tab") return;
      const nodes = root.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      const list = Array.from(nodes).filter(
        (el) => el.tabIndex !== -1 && !el.closest("[disabled]"),
      );
      if (list.length === 0) return;
      const first = list[0];
      const last = list[list.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  if (!open) return null;

  return (
    <div
      ref={pageRootRef}
      className="settings-page"
      role="dialog"
      aria-modal="true"
      aria-labelledby="settings-title"
      tabIndex={-1}
      inert={overlayInert || undefined}
    >
      <div className="settings-page-header">
        <h2 id="settings-title">Settings</h2>
        <button
          ref={closeRef}
          type="button"
          className="btn ghost btn-sm"
          onClick={onClose}
          aria-label="Close settings"
        >
          Done
        </button>
      </div>

      <div className="settings-page-body">
        <nav className="settings-nav" aria-label="Settings">
          {SETTINGS_NAV.map((group) => (
            <div className="settings-nav-group" key={group.label}>
              <div className="settings-nav-heading">{group.label}</div>
              {group.items.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  aria-current={page === item.id ? "page" : undefined}
                  className={
                    page === item.id
                      ? "settings-nav-item active"
                      : "settings-nav-item"
                  }
                  onClick={() => setPage(item.id)}
                >
                  {item.label}
                </button>
              ))}
            </div>
          ))}
        </nav>

        <div className="settings-content">
          <div className="settings-content-inner">
            <h3 className="settings-page-title">{PAGE_TITLES[page]}</h3>
            <SettingsPageBody
              page={page}
              theme={theme}
              privacyMode={privacyMode}
              codingDataOptIn={codingDataOptIn}
              codingDataNote={codingDataNote}
              permissionMode={permissionMode}
              allowOutsideProject={allowOutsideProject}
              sandboxTerminal={sandboxTerminal}
              sandboxStatus={sandboxStatus}
              debugLogging={debugLogging}
              debugLogPath={debugLogPath}
              allowPrerelease={allowPrerelease}
              autoCompactAt={autoCompactAt}
              onSetTheme={onSetTheme}
              onSetPrivacyMode={onSetPrivacyMode}
              onSetCodingDataOptIn={onSetCodingDataOptIn}
              onSetPermissionMode={onSetPermissionMode}
              onToggleAllowOutside={onToggleAllowOutside}
              onSetSandboxTerminal={onSetSandboxTerminal}
              onSetDebugLogging={onSetDebugLogging}
              onSetAllowPrerelease={onSetAllowPrerelease}
              onSetAutoCompactAt={onSetAutoCompactAt}
              onOpenDebugLog={onOpenDebugLog}
              onRestartAgent={onRestartAgent}
              onRestartAfterWrite={onRestartAfterWrite}
              restarting={restarting}
              offerRestart={offerRestart}
              grokBinary={grokBinary}
              hasProject={hasProject}
              skills={skills}
              skillsError={skillsError}
              skillsLoading={skillsLoading}
              focusSection={focusSection}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function SettingsPageBody({
  page,
  ...props
}: { page: SettingsPageId } & SettingsSharedProps) {
  switch (page) {
    case "general":
      return (
        <GeneralPage
          theme={props.theme}
          privacyMode={props.privacyMode}
          onSetTheme={props.onSetTheme}
          onSetPrivacyMode={props.onSetPrivacyMode}
        />
      );
    case "engine":
      return (
        <EnginePage
          grokBinary={props.grokBinary}
          restarting={props.restarting}
          autoCompactAt={props.autoCompactAt}
          onSetAutoCompactAt={props.onSetAutoCompactAt}
          onRestartAgent={props.onRestartAgent}
        />
      );
    case "agent":
      return (
        <SafetyPage
          permissionMode={props.permissionMode}
          sandboxTerminal={props.sandboxTerminal}
          sandboxStatus={props.sandboxStatus}
          allowOutsideProject={props.allowOutsideProject}
          onSetPermissionMode={props.onSetPermissionMode}
          onSetSandboxTerminal={props.onSetSandboxTerminal}
          onToggleAllowOutside={props.onToggleAllowOutside}
        />
      );
    case "coding-data":
      return (
        <CodingDataPage
          codingDataOptIn={props.codingDataOptIn}
          codingDataNote={props.codingDataNote}
          offerRestart={props.offerRestart}
          restarting={props.restarting}
          onSetCodingDataOptIn={props.onSetCodingDataOptIn}
          onRestartAgent={props.onRestartAgent}
        />
      );
    case "mcp":
      return (
        <McpPage
          open
          restarting={Boolean(props.restarting)}
          hasProject={Boolean(props.hasProject)}
          focus={props.focusSection === "mcp"}
          onRestartAfterWrite={props.onRestartAfterWrite}
        />
      );
    case "plugins":
      return (
        <PluginsPage
          open
          restarting={Boolean(props.restarting)}
          focus={props.focusSection === "plugins"}
          onRestartAfterWrite={props.onRestartAfterWrite}
        />
      );
    case "skills":
      return (
        <SkillsPage
          open
          skills={props.skills || []}
          error={props.skillsError}
          loading={Boolean(props.skillsLoading)}
          focus={props.focusSection === "skills"}
        />
      );
    case "updates":
      return (
        <UpdatesPage
          allowPrerelease={props.allowPrerelease}
          onSetAllowPrerelease={props.onSetAllowPrerelease}
        />
      );
    case "diagnostics":
      return (
        <DiagnosticsPage
          debugLogging={props.debugLogging}
          debugLogPath={props.debugLogPath}
          onSetDebugLogging={props.onSetDebugLogging}
          onOpenDebugLog={props.onOpenDebugLog}
        />
      );
  }
}
