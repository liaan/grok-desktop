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
      path.join("Programs", "cursor", "Cursor.exe"),
      path.join("Programs", "cursor", "resources", "app", "bin", "cursor.cmd"),
    ],
  },
  {
    id: "code",
    label: "Visual Studio Code",
    bins: ["code"],
    darwinApps: ["Visual Studio Code"],
    darwinCli: ["Contents/Resources/app/bin/code"],
    winRel: [
      path.join("Programs", "Microsoft VS Code", "Code.exe"),
      path.join(
        "Programs",
        "Microsoft VS Code",
        "bin",
        "code.cmd",
      ),
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
        "Code - Insiders.exe",
      ),
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
      path.join("Programs", "Windsurf", "Windsurf.exe"),
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
      path.join("Programs", "VSCodium", "VSCodium.exe"),
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
/**
 * Every PATH hit for `name` (one per directory). Callers must keep scanning
 * after rejecting a foreign editor's shim.
 * @param {string} name
 * @param {{
 *   platform?: string,
 *   env?: Record<string, string | undefined>,
 *   exists?: (p: string) => boolean,
 * }} [opts]
 * @returns {string[]}
 */
export function whichBinAll(name, opts = {}) {
  if (!name) return [];
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
  /** @type {string[]} */
  const out = [];
  for (const dir of pathDirs(env, platform)) {
    for (const n of names) {
      const candidate = path.join(dir, n);
      if (exists(candidate)) {
        out.push(candidate);
        break;
      }
    }
  }
  return out;
}

export function whichBin(name, opts = {}) {
  return whichBinAll(name, opts)[0] || null;
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
 * Install-folder name from a `winRel` path (`Programs/Microsoft VS Code/…`
 * → `microsoft vs code`). Matched with `/folder/` boundaries so Insiders
 * does not count as stable VS Code.
 * @param {string} rel
 */
function winInstallFolder(rel) {
  const parts = String(rel).replace(/\\/g, "/").split("/").filter(Boolean);
  if (parts.length === 0) return "";
  if (parts[0].toLowerCase() === "programs" && parts[1]) {
    return parts[1].toLowerCase();
  }
  return parts[0].toLowerCase();
}

function pathHasFolder(posixLower, folder) {
  if (!folder) return false;
  return (
    posixLower.includes(`/${folder}/`) || posixLower.endsWith(`/${folder}`)
  );
}

/**
 * Cursor / Windsurf / VSCodium ship a `code` shim. A PATH hit inside another
 * editor's install must not count as VS Code (or vice versa).
 * @param {string} found
 * @param {EditorPreset} preset
 */
function binBelongsToOtherEditor(found, preset) {
  const lower = String(found).replace(/\\/g, "/").toLowerCase();
  for (const other of PRESETS) {
    if (other.id === preset.id) continue;
    for (const app of other.darwinApps) {
      if (lower.includes(`/${app.toLowerCase()}.app/`)) return true;
    }
    /** @type {Set<string>} */
    const folders = new Set();
    for (const rel of other.winRel) {
      const folder = winInstallFolder(rel);
      if (folder) folders.add(folder);
    }
    for (const folder of folders) {
      if (pathHasFolder(lower, folder)) return true;
    }
  }
  return false;
}

const SYSTEM_BIN_DIRS = new Set([
  "/usr/bin",
  "/usr/local/bin",
  "/bin",
  "/opt/homebrew/bin",
  "/opt/local/bin",
]);

/**
 * User-local `code` next to `cursor` is usually a shim. Official packages
 * share `/usr/bin` — do not hide real VS Code there.
 * @param {string} found
 * @param {EditorPreset} preset
 * @param {ReturnType<typeof resolveCtx>} ctx
 */
function binHasForeignSibling(found, preset, ctx) {
  if (preset.id !== "code") return false;
  const dir = path.dirname(found).replace(/\\/g, "/").replace(/\/+$/, "");
  if (SYSTEM_BIN_DIRS.has(dir)) return false;
  const names = ["cursor", "windsurf", "codium", "code-insiders"];
  const extras =
    ctx.platform === "win32"
      ? names.flatMap((n) => [n, `${n}.exe`, `${n}.cmd`, `${n}.EXE`, `${n}.CMD`])
      : names;
  return extras.some((n) => ctx.exists(path.join(path.dirname(found), n)));
}

function binOwnedByPreset(found, preset, ctx) {
  if (binBelongsToOtherEditor(found, preset)) return false;
  if (binHasForeignSibling(found, preset, ctx)) return false;
  return true;
}

/**
 * @param {Record<string, string | undefined>} env
 * @param {string} home
 * @returns {string[]}
 */
function winProbeBases(env, home) {
  const local = env.LOCALAPPDATA || path.join(home, "AppData", "Local");
  const pfs = [
    env.PROGRAMFILES,
    env["PROGRAMFILES(X86)"],
    env.ProgramFiles,
    env["ProgramFiles(x86)"],
  ].filter(Boolean);
  return [local, ...pfs];
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

  // App-specific installs first — PATH `code` is ambiguous (Cursor ships one).
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
    for (const base of winProbeBases(env, home)) {
      const isPf = base !== local;
      for (const rel of preset.winRel) {
        const parts = String(rel).split(/[/\\]/).filter(Boolean);
        const rest =
          isPf && parts[0] && parts[0].toLowerCase() === "programs"
            ? parts.slice(1)
            : parts;
        const p = path.join(base, ...rest);
        if (exists(p)) return { kind: "cli", path: p };
      }
    }
  }

  for (const bin of preset.bins) {
    for (const found of whichBinAll(bin, { platform, env, exists })) {
      if (binOwnedByPreset(found, preset, ctx)) {
        return { kind: "cli", path: found };
      }
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
      // Fail closed — do not silently open Cursor/TextEdit as "VS Code".
      return null;
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
 * Quote one cmd.exe word (`""` escapes a quote). `%` / `!` are escaped so
 * `notes%PATH%.md` is not expanded when launched via `cmd /c`.
 * @param {string} s
 */
export function quoteWinCmdArg(s) {
  let str = String(s).replace(/%/g, "%%").replace(/!/g, "^!");
  if (str === "") return '""';
  if (!/[\s"&<>|^()]/.test(str)) return str;
  return `"${str.replace(/"/g, '""')}"`;
}

/**
 * `.cmd` plans use `cmd.exe /d /s /c call …` with `shell: false` so Node
 * does not re-join argv and `%`/`!` are not expanded by a second shell.
 * @param {{ ok: true, cmd: string, args: string[], shell?: boolean }} plan
 * @param {{ comspec?: string }} [opts]
 * @returns {{
 *   cmd: string,
 *   args: string[],
 *   shell: boolean,
 *   windowsVerbatimArguments?: boolean,
 * }}
 */
export function spawnArgsForPlan(plan, opts = {}) {
  if (!plan.shell) {
    return { cmd: plan.cmd, args: plan.args, shell: false };
  }
  const comspec = opts.comspec || "cmd.exe";
  const line = [
    "call",
    quoteWinCmdArg(plan.cmd),
    ...plan.args.map(quoteWinCmdArg),
  ].join(" ");
  // cmd /s /c "<line>" — verbatim so Node does not re-escape the quotes.
  return {
    cmd: comspec,
    args: ["/d", "/s", "/c", `"${line}"`],
    shell: false,
    windowsVerbatimArguments: true,
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
  const spawnSpec = spawnArgsForPlan(plan);
  await new Promise((resolve, reject) => {
    let settled = false;
    const child = run(spawnSpec.cmd, spawnSpec.args, {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
      env: opts.env || buildGrokEnv(),
      shell: spawnSpec.shell,
      windowsVerbatimArguments: Boolean(spawnSpec.windowsVerbatimArguments),
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
