/**
 * Desktop Preview MCP descriptor for session/new|load.
 * Grok merges client mcpServers with ~/.grok — empty array means
 * "no extra client servers", not "wipe user MCP".
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { app } from "electron";
import { grokHomeDir } from "./grok-home.mjs";
import { previewApiAddress } from "./preview-api.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SKILL_MARKER = "managed-by: grok-desktop-preview";

export function previewMcpScriptPath() {
  const bundled = path.join(__dirname, "preview-mcp-server.mjs");
  try {
    if (app?.isPackaged) {
      const dest = path.join(app.getPath("userData"), "preview-mcp-server.mjs");
      fs.copyFileSync(bundled, dest);
      return dest;
    }
  } catch {
    /* fall through */
  }
  return bundled;
}

function stdioCommand() {
  const node =
    process.env.npm_node_execpath ||
    process.env.NODE_BINARY ||
    "";
  if (node && fs.existsSync(node)) {
    return { command: node, extraEnv: [] };
  }
  return {
    command: process.execPath,
    extraEnv: [{ name: "ELECTRON_RUN_AS_NODE", value: "1" }],
  };
}

/**
 * ACP MCP entries. Empty when the loopback API is not up yet.
 * HTTP is in-process (no spawn). Stdio is a fallback the agent can still start.
 * @returns {object[]}
 */
export function desktopPreviewMcpServers() {
  const api = previewApiAddress();
  if (!api) return [];
  const script = previewMcpScriptPath();
  const stdio = stdioCommand();
  const apiEnv = [
    { name: "GROK_DESKTOP_PREVIEW_API", value: api.url },
    { name: "GROK_DESKTOP_PREVIEW_TOKEN", value: api.token },
    ...stdio.extraEnv,
  ];
  return [
    {
      type: "http",
      name: "desktop-preview",
      url: `${api.url}/mcp`,
      headers: [
        { name: "Authorization", value: `Bearer ${api.token}` },
      ],
    },
    {
      type: "stdio",
      name: "desktop-preview-stdio",
      command: stdio.command,
      args: [script],
      env: apiEnv,
    },
  ];
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
