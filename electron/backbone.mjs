/**
 * Summarize skills / MCP / plugins from the same discovery the CLI uses
 * (`grok inspect --json`). Config stays in ~/.grok — we only report names.
 */
import { spawn } from "node:child_process";
import { agentEnv } from "./auth.mjs";
import { resolveGrokBinary } from "./grok-home.mjs";

/**
 * @param {string} [cwd]
 * @returns {Promise<{
 *   ok: boolean;
 *   skills: Array<{ name: string; source?: string }>;
 *   mcpServers: Array<{ name: string; transport?: string; source?: string }>;
 *   plugins: Array<{ name: string }>;
 *   grokVersion?: string;
 *   error?: string;
 * }>}
 */
export function inspectBackbone(cwd = process.cwd()) {
  const bin = resolveGrokBinary();

  return new Promise((resolve) => {
    const proc = spawn(bin, ["inspect", "--json"], {
      cwd,
      env: agentEnv(),
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });

    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      try {
        proc.kill();
      } catch {
        /* ignore */
      }
    }, 20_000);

    proc.stdout?.on("data", (c) => {
      stdout += c.toString();
    });
    proc.stderr?.on("data", (c) => {
      stderr += c.toString();
    });

    proc.on("error", (err) => {
      clearTimeout(timer);
      resolve({
        ok: false,
        skills: [],
        mcpServers: [],
        plugins: [],
        error: err?.message || String(err),
      });
    });

    proc.on("exit", (code) => {
      clearTimeout(timer);
      if (code !== 0 && !stdout.trim()) {
        resolve({
          ok: false,
          skills: [],
          mcpServers: [],
          plugins: [],
          error: stderr.trim() || `grok inspect exited ${code}`,
        });
        return;
      }
      try {
        const data = JSON.parse(stdout);
        resolve({
          ok: true,
          grokVersion: data.grokVersion || data.version,
          skills: (data.skills || []).map((s) => ({
            name: s.name,
            source: s.source?.type || s.source || undefined,
          })),
          mcpServers: (data.mcpServers || []).map((m) => ({
            name: m.name,
            transport: m.transport,
            source: m.source?.type || m.source || undefined,
          })),
          plugins: (data.plugins || []).map((p) => ({
            name: p.name || p.id || String(p),
          })),
        });
      } catch (e) {
        resolve({
          ok: false,
          skills: [],
          mcpServers: [],
          plugins: [],
          error: e?.message || "Failed to parse grok inspect --json",
        });
      }
    });
  });
}
