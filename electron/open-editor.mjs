/**
 * Open project files in a real editor — never the OS default app.
 *
 * `shell.openPath` / bare `open file` use Launch Services. HTML, Markdown,
 * and unknown types often land in the default browser (Brave, Chrome, …).
 * Files / Changes "Open in editor" must not do that.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildGrokEnv } from "./grok-home.mjs";

/** Preference ids stored in desktop-state.json (`externalEditor`). */
export const EDITOR_IDS = [
  "auto",
  "cursor",
  "code",
  "code-insiders",
  "zed",
  "windsurf",
  "subl",
  "codium",
  "textedit",
  "notepad",
];

/**
 * @param {unknown} value
 * @returns {string}
 */
export function normalizeExternalEditor(value) {
  const s = String(value ?? "auto")
    .trim()
    .toLowerCase();
  return EDITOR_IDS.includes(s) ? s : "auto";
}

/**
 * @typedef {{
 *   id: string,
 *   label: string,
 *   bins: string[],
 *   darwinApps: string[],
 *   darwinCli: string[],
 *   winRel: string[],
 *   lastResort?: boolean,
 *   platforms?: string[],
 * }} EditorPreset
 */

/** @type {EditorPreset[]} */
const PRESETS = [
  {
    id: "cursor",
    label: "Cursor",
    bins: ["cursor"],
    darwinApps: ["Cursor"],
    darwinCli: [
      "Contents/Resources/app/bin/cursor",
      "Contents/Resources/app/bin/code",
    ],
    winRel: [
      path.join("Programs", "cursor", "resources", "app", "bin", "cursor.cmd"),
      path.join("Programs", "cursor", "Cursor.exe"),
    ],
  },
  {
    id: "code",
    label: "Visual Studio Code",
    bins: ["code"],
    darwinApps: ["Visual Studio Code"],
    darwinCli: ["Contents/Resources/app/bin/code"],
    winRel: [
      path.join(
        "Programs",
        "Microsoft VS Code",
        "bin",
        "code.cmd",
      ),
      path.join("Programs", "Microsoft VS Code", "Code.exe"),
    ],
  },
  {
    id: "code-insiders",
    label: "VS Code Insiders",
    bins: ["code-insiders"],
    darwinApps: ["Visual Studio Code - Insiders"],
    darwinCli: ["Contents/Resources/app/bin/code-insiders"],
    winRel: [
      path.join(
        "Programs",
        "Microsoft VS Code Insiders",
        "bin",
        "code-insiders.cmd",
      ),
    ],
  },
  {
    id: "zed",
    label: "Zed",
    bins: ["zed"],
    darwinApps: ["Zed"],
    darwinCli: ["Contents/MacOS/cli"],
    winRel: [path.join("Programs", "Zed", "zed.exe")],
  },
  {
    id: "windsurf",
    label: "Windsurf",
    bins: ["windsurf"],
    darwinApps: ["Windsurf"],
    darwinCli: ["Contents/Resources/app/bin/windsurf"],
    winRel: [
      path.join(
        "Programs",
        "Windsurf",
        "resources",
        "app",
        "bin",
        "windsurf.cmd",
      ),
    ],
  },
  {
    id: "subl",
    label: "Sublime Text",
    bins: ["subl"],
    darwinApps: ["Sublime Text"],
    darwinCli: ["Contents/SharedSupport/bin/subl"],
    winRel: [path.join("Programs", "Sublime Text", "subl.exe")],
  },
  {
    id: "codium",
    label: "VSCodium",
    bins: ["codium"],
    darwinApps: ["VSCodium"],
    darwinCli: ["Contents/Resources/app/bin/codium"],
    winRel: [
      path.join("Programs", "VSCodium", "bin", "codium.cmd"),
    ],
  },
  {
    id: "textedit",
    label: "TextEdit",
    bins: [],
    darwinApps: ["TextEdit"],
    darwinCli: [],
    winRel: [],
    lastResort: true,
    platforms: ["darwin"],
  },
  {
    id: "notepad",
    label: "Notepad",
    bins: ["notepad"],
    darwinApps: [],
    darwinCli: [],
    winRel: [],
    lastResort: true,
    platforms: ["win32"],
  },
];

/**
 * @param {string} p
 * @returns {boolean}
 */
function defaultExists(p) {
  try {
    return Boolean(p) && fs.existsSync(p);
  } catch {
    return false;
  }
}

/**
 * @param {Record<string, string | undefined>} env
 * @param {string} platform
 * @returns {string[]}
 */
function pathDirs(env, platform) {
  const sep = platform === "win32" ? ";" : ":";
  const raw = env.PATH || env.Path || "";
  return raw.split(sep).filter(Boolean);
}

/**
 * @param {string} name
 * @param {{
 *   platform?: string,
 *   env?: Record<string, string | undefined>,
 *   exists?: (p: string) => boolean,
 * }} [opts]
 * @returns {string | null}
 */
export function whichBin(name, opts = {}) {
  if (!name) return null;
  const platform = opts.platform || process.platform;
  const env = opts.env || process.env;
  const exists = opts.exists || defaultExists;
  const exts =
    platform === "win32"
      ? (env.PATHEXT || ".EXE;.CMD;.BAT;.COM").split(";").filter(Boolean)
      : [""];
  const names =
    platform === "win32" && !path.extname(name)
      ? [name, ...exts.map((e) => name + e)]
      : [name];
  for (const dir of pathDirs(env, platform)) {
    for (const n of names) {
      const candidate = path.join(dir, n);
      if (exists(candidate)) return candidate;
    }
  }
  return null;
}

/**
 * @param {string} appName
 * @param {string} home
 * @param {(p: string) => boolean} exists
 * @returns {string | null}
 */
function darwinAppPath(appName, home, exists) {
  const candidates = [
    `/Applications/${appName}.app`,
    path.join(home, "Applications", `${appName}.app`),
  ];
  for (const p of candidates) {
    if (exists(p)) return p;
  }
  return null;
}

/**
 * Extra dirs so Dock-launched Electron still finds `code` / `cursor`.
 * @param {string} platform
 * @param {string} home
 * @param {Record<string, string | undefined>} env
 * @returns {string[]}
 */
function editorSearchDirs(platform, home, env) {
  if (platform === "win32") {
    const local = env.LOCALAPPDATA || path.join(home, "AppData", "Local");
    return [
      path.join(local, "Programs", "cursor", "resources", "app", "bin"),
      path.join(local, "Programs", "Microsoft VS Code", "bin"),
      path.join(local, "Programs", "Microsoft VS Code Insiders", "bin"),
      path.join(local, "Programs", "Windsurf", "resources", "app", "bin"),
    ];
  }
  return [
    path.join(home, ".local", "bin"),
    "/usr/local/bin",
    "/opt/homebrew/bin",
    "/Applications/Cursor.app/Contents/Resources/app/bin",
    "/Applications/Visual Studio Code.app/Contents/Resources/app/bin",
    "/Applications/Visual Studio Code - Insiders.app/Contents/Resources/app/bin",
    "/Applications/Zed.app/Contents/MacOS",
    "/Applications/Windsurf.app/Contents/Resources/app/bin",
    "/Applications/Sublime Text.app/Contents/SharedSupport/bin",
    "/Applications/VSCodium.app/Contents/Resources/app/bin",
    path.join(home, "Applications", "Cursor.app", "Contents", "Resources", "app", "bin"),
    path.join(
      home,
      "Applications",
      "Visual Studio Code.app",
      "Contents",
      "Resources",
      "app",
      "bin",
    ),
  ];
}

/**
 * @param {{
 *   platform?: string,
 *   env?: Record<string, string | undefined>,
 *   exists?: (p: string) => boolean,
 *   home?: string,
 * }} [opts]
 */
function resolveCtx(opts = {}) {
  const platform = opts.platform || process.platform;
  const home = opts.home || os.homedir();
  const baseEnv = opts.env || buildGrokEnv();
  const extra = editorSearchDirs(platform, home, baseEnv);
  const sep = platform === "win32" ? ";" : ":";
  const current = baseEnv.PATH || baseEnv.Path || "";
  const parts = [...extra, ...current.split(sep).filter(Boolean)];
  const seen = new Set();
  const pathValue = parts
    .filter((p) => {
      if (!p || seen.has(p)) return false;
      seen.add(p);
      return true;
    })
    .join(sep);
  const env = { ...baseEnv, PATH: pathValue, Path: pathValue };
  return {
    platform,
    home,
    env,
    exists: opts.exists || defaultExists,
  };
}

/**
 * @param {EditorPreset} preset
 * @param {ReturnType<typeof resolveCtx>} ctx
 * @returns {{ kind: 'cli' | 'app' | 'system', path?: string, app?: string } | null}
 */
function locatePreset(preset, ctx) {
  const { platform, home, env, exists } = ctx;
  if (preset.platforms && !preset.platforms.includes(platform)) return null;

  if (preset.id === "notepad" && platform === "win32") {
    return { kind: "system", path: "notepad.exe" };
  }
  if (preset.id === "textedit" && platform === "darwin") {
    return { kind: "system", app: "TextEdit" };
  }

  for (const bin of preset.bins) {
    const found = whichBin(bin, { platform, env, exists });
    if (found) return { kind: "cli", path: found };
  }

  if (platform === "darwin") {
    for (const appName of preset.darwinApps) {
      const appPath = darwinAppPath(appName, home, exists);
      if (!appPath) continue;
      for (const rel of preset.darwinCli) {
        const cli = path.join(appPath, rel);
        if (exists(cli)) return { kind: "cli", path: cli };
      }
      return { kind: "app", app: appName };
    }
  }

  if (platform === "win32") {
    const local = env.LOCALAPPDATA || path.join(home, "AppData", "Local");
    for (const rel of preset.winRel) {
      const p = path.join(local, rel);
      if (exists(p)) return { kind: "cli", path: p };
    }
  }

  return null;
}

/**
 * @param {{
 *   platform?: string,
 *   env?: Record<string, string | undefined>,
 *   exists?: (p: string) => boolean,
 *   home?: string,
 * }} [opts]
 * @returns {Array<{ id: string, label: string, available: boolean, lastResort: boolean }>}
 */
export function listEditors(opts = {}) {
  const ctx = resolveCtx(opts);
  return PRESETS.filter((p) => {
    if (!p.platforms) return true;
    return p.platforms.includes(ctx.platform);
  }).map((p) => ({
    id: p.id,
    label: p.label,
    available: locatePreset(p, ctx) != null,
    lastResort: Boolean(p.lastResort),
  }));
}

/**
 * @param {string} [preference]
 * @param {{
 *   platform?: string,
 *   env?: Record<string, string | undefined>,
 *   exists?: (p: string) => boolean,
 *   home?: string,
 * }} [opts]
 */
export function resolvePreferredEditor(preference, opts = {}) {
  const wanted = normalizeExternalEditor(preference);
  const ctx = resolveCtx(opts);
  const byId = Object.fromEntries(PRESETS.map((p) => [p.id, p]));

  if (wanted !== "auto") {
    const preset = byId[wanted];
    if (preset) {
      const loc = locatePreset(preset, ctx);
      if (loc) return { id: preset.id, label: preset.label, loc };
    }
  }

  for (const preset of PRESETS) {
    if (preset.lastResort) continue;
    if (preset.platforms && !preset.platforms.includes(ctx.platform)) continue;
    const loc = locatePreset(preset, ctx);
    if (loc) return { id: preset.id, label: preset.label, loc };
  }

  if (ctx.platform === "darwin") {
    return {
      id: "textedit",
      label: "TextEdit",
      loc: { kind: "system", app: "TextEdit" },
    };
  }
  if (ctx.platform === "win32") {
    return {
      id: "notepad",
      label: "Notepad",
      loc: { kind: "system", path: "notepad.exe" },
    };
  }
  return null;
}

/**
 * Build a spawn plan. Never returns a bare `open <file>` / `xdg-open` /
 * `shell.openPath` — those hand the file to the browser.
 *
 * @param {string} filePath
 * @param {{
 *   preference?: string,
 *   platform?: string,
 *   env?: Record<string, string | undefined>,
 *   exists?: (p: string) => boolean,
 *   home?: string,
 * }} [opts]
 * @returns {{
 *   ok: true,
 *   editor: string,
 *   label: string,
 *   cmd: string,
 *   args: string[],
 *   shell?: boolean,
 * } | { ok: false, error: string }}
 */
export function planOpenInEditor(filePath, opts = {}) {
  const target = String(filePath || "");
  if (!target.trim()) {
    return { ok: false, error: "No file path" };
  }
  const resolved = resolvePreferredEditor(opts.preference, opts);
  if (!resolved) {
    return {
      ok: false,
      error:
        "No code editor found. Install VS Code, Cursor, or Zed — or pick one in Settings.",
    };
  }

  const platform = opts.platform || process.platform;
  const { id, label, loc } = resolved;

  if (loc.kind === "cli" && loc.path) {
    const shell =
      platform === "win32" && /\.(cmd|bat)$/i.test(loc.path);
    return {
      ok: true,
      editor: id,
      label,
      cmd: loc.path,
      args: [target],
      shell,
    };
  }

  if (platform === "darwin" && (loc.kind === "app" || loc.kind === "system")) {
    // `open -a App -- file` — never `open file` (that is the Brave path).
    // TextEdit: `open -e` is the dedicated text-editor role, still not a browser.
    if (id === "textedit") {
      return {
        ok: true,
        editor: id,
        label,
        cmd: "open",
        args: ["-e", "--", target],
      };
    }
    return {
      ok: true,
      editor: id,
      label,
      cmd: "open",
      args: ["-a", loc.app || label, "--", target],
    };
  }

  if (platform === "win32" && id === "notepad") {
    return {
      ok: true,
      editor: id,
      label,
      cmd: "notepad.exe",
      args: [target],
    };
  }

  return {
    ok: false,
    error: `Could not launch ${label}`,
  };
}

/**
 * @param {string} filePath
 * @param {{
 *   preference?: string,
 *   platform?: string,
 *   env?: Record<string, string | undefined>,
 *   spawn?: typeof spawn,
 * }} [opts]
 * @returns {Promise<{ ok: true, editor: string, label: string }>}
 */
export async function openInEditor(filePath, opts = {}) {
  const plan = planOpenInEditor(filePath, opts);
  if (!plan.ok) throw new Error(plan.error);
  const run = opts.spawn || spawn;
  await new Promise((resolve, reject) => {
    let settled = false;
    const child = run(plan.cmd, plan.args, {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
      env: opts.env || buildGrokEnv(),
      shell: Boolean(plan.shell),
    });
    child.once("error", (err) => {
      if (settled) return;
      settled = true;
      reject(err);
    });
    // Detached GUI editors should not keep this process waiting.
    try {
      child.unref();
    } catch {
      /* ignore */
    }
    // `open` / notepad spawn succeeds even if the app later fails; treat
    // spawn-without-error as success after a short tick.
    setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve(undefined);
    }, 50);
  });
  return { ok: true, editor: plan.editor, label: plan.label };
}
