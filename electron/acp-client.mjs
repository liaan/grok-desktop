/**
 * Minimal ACP (Agent Client Protocol) client over `grok agent stdio`.
 * Backbone: Grok Build agent runtime via ACP (same path as other embeds).
 *
 * Skills, MCP servers, plugins, and auth all come from the installed Grok CLI
 * (`~/.grok`). We pass `mcpServers: []` on session/new the same way VS Code /
 * official embeds do — the agent merges config.toml + plugins itself.
 */
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import path from "node:path";
import { agentEnv } from "./auth.mjs";
import { resolveGrokBinary } from "./grok-home.mjs";

export class GrokAcpClient extends EventEmitter {
  constructor({ cwd, grokPath, alwaysApprove = false } = {}) {
    super();
    this.cwd = cwd || process.cwd();
    this.grokPath = grokPath || resolveGrokBinary();
    this.alwaysApprove = alwaysApprove;
    this.proc = null;
    this.rl = null;
    this.nextId = 1;
    this.pending = new Map();
    this.sessionId = null;
    this.ready = false;
    this.stderrBuf = "";
  }

  async start() {
    if (this.proc) return this;

    // Same entrypoint as the CLI agent; inherits ~/.grok skills, MCP, auth.
    const args = ["agent", "stdio"];
    this.proc = spawn(this.grokPath, args, {
      cwd: this.cwd,
      env: agentEnv(),
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });

    this.proc.on("error", (err) => {
      this.emit("error", err);
    });

    this.proc.on("exit", (code, signal) => {
      this.ready = false;
      for (const [, p] of this.pending) {
        p.reject(new Error(`Agent exited (code=${code}, signal=${signal})`));
      }
      this.pending.clear();
      this.emit("exit", { code, signal });
    });

    this.proc.stderr.on("data", (chunk) => {
      const text = chunk.toString();
      this.stderrBuf += text;
      this.emit("stderr", text);
    });

    this.rl = createInterface({ input: this.proc.stdout });
    this.rl.on("line", (line) => this._onLine(line));

    await this.request("initialize", {
      protocolVersion: 1,
      clientInfo: {
        name: "grok-desktop",
        version: "0.1.0",
      },
      clientCapabilities: {
        fs: { readTextFile: true, writeTextFile: true },
        terminal: true,
      },
    });

    // Empty mcpServers = client adds none; agent still loads ~/.grok config + plugins.
    const session = await this.request("session/new", {
      cwd: this.cwd,
      mcpServers: [],
    });
    this.sessionId = session.sessionId;
    this.ready = true;
    this.emit("ready", {
      sessionId: this.sessionId,
      cwd: this.cwd,
      grokBinary: this.grokPath,
    });
    return this;
  }

  _onLine(line) {
    const trimmed = line.trim();
    if (!trimmed) return;
    let msg;
    try {
      msg = JSON.parse(trimmed);
    } catch {
      this.emit("parse-error", trimmed);
      return;
    }

    // Server request to client (permission / fs / terminal)
    if (msg.method && msg.id !== undefined && !msg.result && !msg.error) {
      this._handleServerRequest(msg).catch((err) => {
        this._respond(msg.id, null, {
          code: -32000,
          message: err?.message || String(err),
        });
      });
      return;
    }

    // Notification
    if (msg.method && msg.id === undefined) {
      if (msg.method === "session/update") {
        this.emit("session-update", msg.params);
      } else {
        this.emit("notification", msg);
      }
      return;
    }

    // Response to our request
    if (msg.id !== undefined && this.pending.has(msg.id)) {
      const p = this.pending.get(msg.id);
      this.pending.delete(msg.id);
      if (msg.error) p.reject(Object.assign(new Error(msg.error.message || "ACP error"), msg.error));
      else p.resolve(msg.result);
    }
  }

  async _handleServerRequest(msg) {
    const { method, params, id } = msg;

    if (method === "session/request_permission") {
      if (this.alwaysApprove) {
        this._respond(id, {
          outcome: { outcome: "selected", optionId: "allow-once" },
        });
        return;
      }

      const decision = await new Promise((resolve) => {
        const timeout = setTimeout(
          () =>
            resolve({
              outcome: { outcome: "cancelled" },
            }),
          120_000,
        );
        this.emit("permission-request", {
          params,
          respond: (outcome) => {
            clearTimeout(timeout);
            resolve(outcome);
          },
        });
      });
      this._respond(id, decision);
      return;
    }

    if (method === "fs/read_text_file") {
      const filePath = params.path;
      const text = await fs.promises.readFile(filePath, "utf8");
      this._respond(id, { content: text });
      return;
    }

    if (method === "fs/write_text_file") {
      await fs.promises.mkdir(path.dirname(params.path), { recursive: true });
      await fs.promises.writeFile(params.path, params.content ?? "", "utf8");
      this._respond(id, {});
      return;
    }

    // Terminal methods — stub with not-supported for v0.1 (agent can still use shell tools server-side)
    if (method?.startsWith("terminal/")) {
      this._respond(id, null, {
        code: -32601,
        message: `Method not implemented in desktop client yet: ${method}`,
      });
      return;
    }

    this._respond(id, null, {
      code: -32601,
      message: `Unhandled client method: ${method}`,
    });
  }

  _respond(id, result, error) {
    const msg = error
      ? { jsonrpc: "2.0", id, error }
      : { jsonrpc: "2.0", id, result: result ?? {} };
    this._write(msg);
  }

  _write(obj) {
    if (!this.proc?.stdin?.writable) throw new Error("Agent stdin not writable");
    this.proc.stdin.write(JSON.stringify(obj) + "\n");
  }

  request(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this._write({ jsonrpc: "2.0", id, method, params });
    });
  }

  notify(method, params = {}) {
    this._write({ jsonrpc: "2.0", method, params });
  }

  async prompt(text, { images = [] } = {}) {
    if (!this.sessionId) throw new Error("No ACP session");
    const prompt = [{ type: "text", text }];
    for (const img of images) {
      prompt.push({
        type: "image",
        data: img.data,
        mimeType: img.mimeType || "image/png",
      });
    }
    return this.request("session/prompt", {
      sessionId: this.sessionId,
      prompt,
    });
  }

  cancel() {
    if (!this.sessionId) return;
    this.notify("session/cancel", { sessionId: this.sessionId });
  }

  setAlwaysApprove(value) {
    this.alwaysApprove = Boolean(value);
  }

  async setCwd(cwd) {
    this.cwd = cwd;
    // New session in new workspace (ACP sessions are cwd-scoped at creation)
    const session = await this.request("session/new", {
      cwd: this.cwd,
      mcpServers: [],
    });
    this.sessionId = session.sessionId;
    this.emit("ready", {
      sessionId: this.sessionId,
      cwd: this.cwd,
      grokBinary: this.grokPath,
    });
    return this.sessionId;
  }

  async dispose() {
    try {
      this.rl?.close();
    } catch {
      /* ignore */
    }
    if (this.proc && !this.proc.killed) {
      this.proc.kill();
    }
    this.proc = null;
    this.ready = false;
  }
}

export { resolveGrokBinary } from "./grok-home.mjs";
