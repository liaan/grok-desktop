import type { AutoCompactAt } from "../../../shared/auto-compact.mjs";
import type { PermissionMode } from "../../lib/permission-mode";

export type SettingsPageId =
  | "general"
  | "engine"
  | "agent"
  | "coding-data"
  | "mcp"
  | "plugins"
  | "skills"
  | "updates"
  | "diagnostics";

export type SettingsNavItem = {
  id: SettingsPageId;
  label: string;
};

export type SettingsNavGroup = {
  label: string;
  items: SettingsNavItem[];
};

export const SETTINGS_NAV: SettingsNavGroup[] = [
  {
    label: "nav.app",
    items: [
      { id: "general", label: "nav.general" },
      { id: "engine", label: "nav.engine" },
    ],
  },
  {
    label: "nav.agent",
    items: [
      { id: "agent", label: "nav.safety" },
      { id: "coding-data", label: "nav.codingData" },
    ],
  },
  {
    label: "nav.extensions",
    items: [
      { id: "mcp", label: "nav.mcp" },
      { id: "plugins", label: "nav.plugins" },
      { id: "skills", label: "nav.skills" },
    ],
  },
  {
    label: "nav.advanced",
    items: [
      { id: "updates", label: "nav.updates" },
      { id: "diagnostics", label: "nav.diagnostics" },
    ],
  },
];

export const PAGE_TITLES: Record<SettingsPageId, string> = {
  general: "nav.general",
  engine: "nav.engine",
  agent: "nav.safety",
  "coding-data": "nav.codingData",
  mcp: "page.mcp",
  plugins: "nav.plugins",
  skills: "nav.skills",
  updates: "nav.updates",
  diagnostics: "nav.diagnostics",
};

export function pageFromFocus(
  focus: "mcp" | "plugins" | "skills" | null | undefined,
): SettingsPageId {
  if (focus === "mcp" || focus === "plugins" || focus === "skills") return focus;
  return "general";
}

export type SettingsFocusSection = "mcp" | "plugins" | "skills" | null;

export type SettingsSharedProps = {
  theme: "dark" | "light";
  privacyMode: boolean;
  codingDataOptIn: boolean;
  codingDataNote?: string;
  permissionMode: PermissionMode;
  allowOutsideProject: boolean;
  sandboxTerminal: boolean;
  sandboxStatus: string;
  debugLogging: boolean;
  debugLogPath: string;
  crashLogPath: string;
  onOpenCrashLog: () => void;
  allowPrerelease: boolean;
  autoCompactAt: AutoCompactAt;
  onSetTheme: (theme: "dark" | "light") => void;
  onSetPrivacyMode: (next: boolean) => void;
  onSetCodingDataOptIn: (next: boolean) => void;
  onSetPermissionMode: (mode: PermissionMode) => void;
  onToggleAllowOutside: () => void;
  onSetSandboxTerminal: (next: boolean) => void;
  onSetDebugLogging: (next: boolean) => void;
  onSetAllowPrerelease: (next: boolean) => void;
  onSetAutoCompactAt: (next: AutoCompactAt) => void;
  onOpenDebugLog: () => void;
  onRestartAgent: () => void;
  onRestartAfterWrite?: () => Promise<void> | void;
  restarting?: boolean;
  offerRestart?: boolean;
  grokBinary?: string;
  hasProject?: boolean;
  skills?: Array<{ name: string; description?: string; source?: string }>;
  skillsError?: string | null;
  skillsLoading?: boolean;
  focusSection?: SettingsFocusSection;
};
