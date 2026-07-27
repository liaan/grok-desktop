/** Slash commands: ACP agent list + skills + desktop-local handlers. */

export type SlashCommand = {
  /** Without leading slash, e.g. "review" */
  name: string;
  description: string;
  /** Where the command came from */
  source: "agent" | "skill" | "desktop";
  /** Optional arg hint (ACP input.hint or skill argument-hint) */
  inputHint?: string;
  /** Handled in the desktop shell instead of session/prompt */
  local?: boolean;
};

/** Desktop-only commands (GUI actions). */
export const DESKTOP_COMMANDS: SlashCommand[] = [
  {
    name: "new",
    description: "Start a new chat (same as CLI /new)",
    source: "desktop",
    local: true,
  },
  {
    name: "clear",
    description: "Start a new chat (alias of /new)",
    source: "desktop",
    local: true,
  },
  {
    name: "always-approve",
    description: "Toggle Always-approve permission mode (or use Settings / Perms)",
    source: "desktop",
    local: true,
  },
  {
    name: "plan",
    description: "Enter plan mode (explore + design before coding)",
    source: "desktop",
    inputHint: "description",
    // Not local: sent to the agent as `/plan …` (same as CLI)
  },
  {
    name: "view-plan",
    description: "Ask the agent to show the current plan",
    source: "desktop",
    // Sent to agent
  },
];

/**
 * Prefer agent-advertised commands, then skills, then desktop.
 * Same name: agent > skill > desktop.
 */
export function mergeCommands(parts: {
  agent?: SlashCommand[];
  skills?: SlashCommand[];
  desktop?: SlashCommand[];
}): SlashCommand[] {
  const byName = new Map<string, SlashCommand>();
  const order: SlashCommand[] = [];

  const add = (list: SlashCommand[] | undefined, priority: number) => {
    if (!list) return;
    for (const cmd of list) {
      const key = cmd.name.toLowerCase();
      if (!key) continue;
      const existing = byName.get(key);
      if (existing) {
        // Lower priority number wins; only replace if higher priority
        const existingPri =
          existing.source === "agent" ? 0 : existing.source === "skill" ? 1 : 2;
        if (priority >= existingPri) continue;
        byName.set(key, cmd);
        const idx = order.findIndex((c) => c.name.toLowerCase() === key);
        if (idx >= 0) order[idx] = cmd;
      } else {
        byName.set(key, cmd);
        order.push(cmd);
      }
    }
  };

  // Desktop first so they exist; agent/skill overwrite when present
  add(parts.desktop ?? DESKTOP_COMMANDS, 2);
  add(parts.skills, 1);
  add(parts.agent, 0);

  // Stable-ish: desktop first, then skills (alpha), then agent-only (alpha)
  return order.sort((a, b) => {
    const rank = (s: SlashCommand["source"]) =>
      s === "desktop" ? 0 : s === "skill" ? 1 : 2;
    const d = rank(a.source) - rank(b.source);
    if (d !== 0) return d;
    return a.name.localeCompare(b.name);
  });
}

export function skillsToCommands(
  skills: Array<{ name: string; description?: string; source?: string }>,
): SlashCommand[] {
  return skills
    .map((s) => {
      const name = String(s.name || "")
        .trim()
        .replace(/^\//, "");
      if (!name) return null;
      return {
        name,
        description: s.description?.trim() || `Skill: ${name}`,
        source: "skill" as const,
      };
    })
    .filter(Boolean) as SlashCommand[];
}

/** Parse ACP available_commands_update payload. */
export function agentCommandsFromUpdate(update: any): SlashCommand[] {
  const list = update?.availableCommands ?? update?.available_commands ?? [];
  if (!Array.isArray(list)) return [];
  return list
    .map((c: any) => {
      const name = String(c?.name || "")
        .trim()
        .replace(/^\//, "");
      if (!name) return null;
      const hint =
        c?.input?.hint ||
        c?.inputHint ||
        c?.argumentHint ||
        c?.argument_hint ||
        undefined;
      return {
        name,
        description: String(c?.description || name),
        source: "agent" as const,
        inputHint: hint ? String(hint) : undefined,
      };
    })
    .filter(Boolean) as SlashCommand[];
}

/**
 * True while the composer is mid-command name (`/` or `/rev`).
 * Hide the menu once the user types args (`/review --local`).
 */
export function isSlashMenuOpen(input: string): boolean {
  return /^\/[^\s]*$/.test(input);
}

export function slashQuery(input: string): string {
  if (!isSlashMenuOpen(input)) return "";
  return input.slice(1).toLowerCase();
}

/** Fuzzy-ish filter: prefix first, then substring. */
export function filterCommands(
  commands: SlashCommand[],
  query: string,
): SlashCommand[] {
  const q = query.trim().toLowerCase();
  if (!q) return commands;
  const prefix: SlashCommand[] = [];
  const mid: SlashCommand[] = [];
  for (const c of commands) {
    const n = c.name.toLowerCase();
    const d = c.description.toLowerCase();
    if (n.startsWith(q)) prefix.push(c);
    else if (n.includes(q) || d.includes(q)) mid.push(c);
  }
  return [...prefix, ...mid];
}

/** Insert `/name` or `/name ` (trailing space when args are expected). */
export function formatCommandInsert(cmd: SlashCommand): string {
  if (cmd.inputHint) return `/${cmd.name} `;
  // Skills often take optional args — leave a space for convenience
  if (cmd.source === "skill" || cmd.source === "agent") return `/${cmd.name} `;
  return `/${cmd.name}`;
}

/**
 * Detect a slash invocation in a user message (first line only).
 * `/review code stack` → { name: "review", args: "code stack" }
 */
export function parseSlashInvocation(text: string): {
  name: string;
  args: string;
  raw: string;
} | null {
  const first = String(text || "")
    .split(/\r?\n/, 1)[0]
    .trim();
  const m = first.match(/^\/([a-zA-Z][\w:-]*)(?:\s+(.*))?$/);
  if (!m) return null;
  return {
    name: m[1],
    args: (m[2] || "").trim(),
    raw: first,
  };
}

/** Resolve a slash name against known commands (case-insensitive). */
export function matchSlashCommand(
  name: string,
  commands: SlashCommand[],
): SlashCommand | undefined {
  const key = name.toLowerCase();
  return commands.find((c) => c.name.toLowerCase() === key);
}
