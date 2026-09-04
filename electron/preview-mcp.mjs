/**
 * Desktop Preview MCP descriptor for session/new|load.
 * Grok merges client mcpServers with ~/.grok — empty array means
 * "no extra client servers", not "wipe user MCP".
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { grokHomeDir } from "./grok-home.mjs";
import { previewApiAddress } from "./preview-api.mjs";
import { previewMcpHttpServers } from "./preview-mcp-tools.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SKILL_MARKER = "managed-by: grok-desktop-preview";

/**
 * ACP MCP entries. Empty when the loopback API is not up yet. HTTP only.
 * @param {unknown} [windowId] BrowserWindow id of the chat that owns this agent.
 * @returns {object[]}
 */
export function desktopPreviewMcpServers(windowId) {
  return previewMcpHttpServers(previewApiAddress(), windowId);
}

/**
 * Teach the agent about Preview on every project (user skill).
 * Updates only files we manage; never overwrites a hand-edited copy.
 */
export function installDesktopPreviewSkill() {
  const src = path.join(__dirname, "preview", "SKILL.md");
  if (!fs.existsSync(src)) return;
  const destDir = path.join(grokHomeDir(), "skills", "desktop-preview");
  const dest = path.join(destDir, "SKILL.md");
  const body = fs.readFileSync(src, "utf8");
  const stamped = body.includes(SKILL_MARKER)
    ? body
    : `${body.trimEnd()}\n\n<!-- ${SKILL_MARKER} -->\n`;
  try {
    if (fs.existsSync(dest)) {
      const existing = fs.readFileSync(dest, "utf8");
      if (!existing.includes(SKILL_MARKER)) return;
      if (existing === stamped) return;
    }
    fs.mkdirSync(destDir, { recursive: true });
    fs.writeFileSync(dest, stamped);
  } catch {
    /* ~/.grok may be locked */
  }
}
