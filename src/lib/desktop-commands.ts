/**
 * Desktop-local slash command dispatch (never sent to the agent).
 */
import type { PermissionMode } from "./permission-mode";
import type { SlashCommand } from "./commands";

export type DesktopCommandHandlers = {
  newChat: () => void;
  toggleAlwaysApprove: () => void | Promise<void>;
  preview?: (args: string) => void | Promise<void>;
  compact?: (hint?: string) => void | Promise<void>;
};

/** Resolve next mode when toggling Always-approve. */
export function nextAlwaysApproveMode(
  current: PermissionMode,
): PermissionMode {
  return current === "always-approve" ? "ask" : "always-approve";
}

/**
 * Run a desktop-local command by name.
 * @returns true if handled
 */
export function runDesktopCommand(
  name: string,
  handlers: DesktopCommandHandlers,
  args = "",
): boolean {
  const key = name.toLowerCase().replace(/^\//, "");
  if (key === "new" || key === "clear") {
    handlers.newChat();
    return true;
  }
  if (key === "always-approve") {
    void handlers.toggleAlwaysApprove();
    return true;
  }
  if (key === "preview") {
    void handlers.preview?.(args);
    return true;
  }
  if (key === "compact") {
    void handlers.compact?.(args);
    return true;
  }
  return false;
}

/** True when this slash entry is handled in-app. */
export function isLocalDesktopCommand(cmd: SlashCommand): boolean {
  return Boolean(cmd.local);
}
