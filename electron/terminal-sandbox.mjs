/**
 * OS-level filesystem jail for ACP tool terminals.
 *
 * When enabled (default), agent shells only see the open project (+ system
 * tool roots / temp). Network is allowed. Docker sockets are never exposed.
 *
 * Backends:
 *   darwin  → /usr/bin/sandbox-exec (Seatbelt)
 *   linux   → bwrap (bubblewrap)
 *   win32   → wsl.exe + bwrap, else docker run (project mount only)
 *
 * Fail closed: if sandbox is on and no backend works, throw — never silently
 * spawn on the bare host.
 */
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const SANDBOX_EXEC = "/usr/bin/sandbox-exec";
/**
 * Default Docker sandbox image. Must include git + bash — plain ubuntu:24.04
 * does not ship git, so agent `git` tools fail inside the jail.
 * Override with GROK_DESKTOP_SANDBOX_IMAGE.
 *
 * buildpack-deps:*-scm is the standard "SCM tools" Debian/Ubuntu image.
 */
const DEFAULT_DOCKER_IMAGE =
  process.env.GROK_DESKTOP_SANDBOX_IMAGE || "buildpack-deps:noble-scm";

/**
 * Local image built once when the preferred image has no git.
 * Bump the tag when the embedded Dockerfile recipe changes.
 */
const LOCAL_SANDBOX_IMAGE = "grok-desktop-sandbox:2";

/** Recipe version embedded in local image labels / comments. */
const LOCAL_SANDBOX_RECIPE = "2";

/**
 * Verified ready image only (passed git probe). Never cache unverified refs.
 * @type {string | null}
 */
let readyDockerSandboxImage = null;

/** @type {Promise<string | null> | null} */
let dockerWarmPromise = null;

/** @type {'idle' | 'warming' | 'ready' | 'error'} */
let dockerWarmState = "idle";

/** @type {string | null} */
let dockerWarmError = null;

/** Earliest time another full warm may start after an error (ms epoch). */
let dockerWarmRetryAfter = 0;

/** Cooldown after a failed warm so every tool call does not re-pull/build. */
const DOCKER_WARM_ERROR_COOLDOWN_MS = 60_000;

/**
 * Read-only trees bind-mounted into every bwrap jail (host + WSL).
 * Single source of truth — do not re-list these in WSL scripts.
 */
export const BWRAP_RO_BINDS = [
  "/usr",
  "/bin",
  "/sbin",
  "/lib",
  "/lib64",
  "/lib32",
  "/opt",
  "/etc/resolv.conf",
  "/etc/ssl",
  "/etc/ca-certificates",
  "/etc/passwd",
  "/etc/group",
  "/etc/nsswitch.conf",
  "/etc/hosts",
  "/etc/localtime",
  "/etc/timezone",
];

/** @typedef {'sandbox-exec' | 'bwrap' | 'wsl-bwrap' | 'docker' | 'none'} SandboxBackend */

/**
 * @typedef {{
 *   platform: string,
 *   available: boolean,
 *   backend: SandboxBackend,
 *   detail: string,
 *   dockerImage: string,
 *   bwrapPath?: string,
 *   dockerPath?: string,
 *   wslPath?: string,
 *   wslDistro?: string,
 * }} SandboxProbe
 */

/**
 * @typedef {{
 *   file: string,
 *   fileArgs: string[],
 *   shell: boolean,
 *   cwd: string,
 *   env: Record<string, string | undefined>,
 *   backend: string | null,
 *   cleanup?: () => void,
 * }} SpawnPlan
 */

/** @type {null | SandboxProbe} */
let probeCache = null;

/**
 * @param {string} p
 * @returns {string}
 */
function realpathOrSelf(p) {
  try {
    return fs.realpathSync(p);
  } catch {
    return path.resolve(p);
  }
}

/**
 * Escape a path for embedding in a Seatbelt (scheme) string literal.
 * @param {string} p
 */
export function seatbeltLiteral(p) {
  return String(p).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/**
 * Windows absolute path → WSL /mnt/<drive>/... form.
 * @param {string} winPath
 * @returns {string | null}
 */
export function winToWslPath(winPath) {
  if (!winPath || typeof winPath !== "string") return null;
  const normalized = winPath.replace(/\\/g, "/");
  const m = normalized.match(/^([A-Za-z]):\/(.*)$/);
  if (!m) {
    if (normalized.startsWith("/")) return normalized;
    return null;
  }
  return `/mnt/${m[1].toLowerCase()}/${m[2]}`;
}

/**
 * Relative path of `cwd` under `projectRoot`, or null if not under root.
 * @param {string} projectRoot
 * @param {string} cwd
 */
export function relUnderProject(projectRoot, cwd) {
  const root = realpathOrSelf(projectRoot);
  const abs = realpathOrSelf(cwd);
  const rel = path.relative(root, abs);
  if (rel.startsWith("..") || path.isAbsolute(rel)) return null;
  return rel === "" ? "." : rel;
}

/**
 * @param {string} cmd
 * @param {string[]} args
 * @param {number} [timeoutMs]
 */
function runQuiet(cmd, args, timeoutMs = 8000) {
  try {
    return spawnSync(cmd, args, {
      encoding: "utf8",
      timeout: timeoutMs,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (err) {
    return {
      status: 1,
      error: err,
      stdout: "",
      stderr: String(err?.message || err),
    };
  }
}

function findOnPath(name) {
  const pathEnv = process.env.PATH || process.env.Path || "";
  const sep = process.platform === "win32" ? ";" : ":";
  const exts =
    process.platform === "win32"
      ? (process.env.PATHEXT || ".EXE;.CMD;.BAT").split(";").filter(Boolean)
      : [""];
  for (const dir of pathEnv.split(sep)) {
    if (!dir) continue;
    for (const ext of exts) {
      const candidate = path.join(dir, name + ext);
      try {
        if (fs.existsSync(candidate)) return candidate;
      } catch {
        /* ignore */
      }
    }
    try {
      const candidate = path.join(dir, name);
      if (fs.existsSync(candidate)) return candidate;
    } catch {
      /* ignore */
    }
  }
  return null;
}

function findBwrapHost() {
  for (const p of ["/usr/bin/bwrap", "/usr/local/bin/bwrap"]) {
    if (fs.existsSync(p)) return p;
  }
  return findOnPath("bwrap");
}

function findDocker() {
  for (const p of [
    "/usr/local/bin/docker",
    "/usr/bin/docker",
    "C:\\Program Files\\Docker\\Docker\\resources\\bin\\docker.exe",
  ]) {
    if (fs.existsSync(p)) return p;
  }
  return findOnPath("docker");
}

/**
 * Async child process (does not block the Electron main event loop like spawnSync).
 * @param {string} cmd
 * @param {string[]} args
 * @param {{ timeoutMs?: number, input?: string }} [opts]
 * @returns {Promise<{ status: number | null, stdout: string, stderr: string }>}
 */
const RUN_ASYNC_OUTPUT_CAP = 64 * 1024;

/**
 * Keep only the last `cap` characters of a growing log buffer.
 * @param {string} cur
 * @param {string} add
 * @param {number} cap
 */
function appendCapped(cur, add, cap = RUN_ASYNC_OUTPUT_CAP) {
  const next = cur + add;
  return next.length > cap ? next.slice(-cap) : next;
}

function runAsync(cmd, args, opts = {}) {
  const timeoutMs = opts.timeoutMs ?? 60_000;
  return new Promise((resolve) => {
    let settled = false;
    /** @type {import('node:child_process').ChildProcess | null} */
    let proc = null;
    let stdout = "";
    let stderr = "";
    /** @type {ReturnType<typeof setTimeout> | null} */
    let timer = null;
    const finish = (status) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      timer = null;
      resolve({ status, stdout, stderr });
    };
    try {
      proc = spawn(cmd, args, {
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"],
      });
    } catch (err) {
      stderr = String(err?.message || err);
      finish(1);
      return;
    }
    timer = setTimeout(() => {
      try {
        if (proc?.pid && process.platform === "win32") {
          spawn("taskkill", ["/pid", String(proc.pid), "/T", "/F"], {
            stdio: "ignore",
            windowsHide: true,
          });
        } else {
          proc?.kill("SIGKILL");
        }
      } catch {
        try {
          proc?.kill();
        } catch {
          /* ignore */
        }
      }
      stderr = appendCapped(stderr, "\n[timeout]\n");
      finish(1);
    }, timeoutMs);
    try {
      if (opts.input != null && proc.stdin) {
        proc.stdin.end(opts.input);
      } else {
        proc.stdin?.end();
      }
    } catch {
      /* ignore closed stdin */
    }
    proc.stdin?.on("error", () => {
      /* ignore EPIPE on closed stdin */
    });
    proc.stdout?.on("data", (d) => {
      stdout = appendCapped(stdout, d.toString());
    });
    proc.stderr?.on("data", (d) => {
      stderr = appendCapped(stderr, d.toString());
    });
    proc.on("error", (err) => {
      stderr = appendCapped(stderr, String(err?.message || err));
      finish(1);
    });
    proc.on("close", (code) => {
      finish(typeof code === "number" ? code : 1);
    });
  });
}

/**
 * True if local image has `git` on PATH. Cheap-ish: no network, short timeout.
 * @param {string} dockerPath
 * @param {string} image
 */
async function dockerImageHasGitAsync(dockerPath, image) {
  const r = await runAsync(
    dockerPath,
    [
      "run",
      "--rm",
      "--network=none",
      "--read-only",
      "--entrypoint",
      "sh",
      image,
      "-c",
      "command -v git >/dev/null 2>&1",
    ],
    { timeoutMs: 20_000 },
  );
  return r.status === 0;
}

/**
 * @param {string} dockerPath
 * @param {string} image
 */
async function dockerImageExistsAsync(dockerPath, image) {
  const r = await runAsync(dockerPath, ["image", "inspect", image], {
    timeoutMs: 15_000,
  });
  return r.status === 0;
}

function markDockerReady(image) {
  readyDockerSandboxImage = image;
  dockerWarmState = "ready";
  dockerWarmError = null;
  return image;
}

function markDockerError(msg) {
  dockerWarmState = "error";
  dockerWarmError = msg;
  dockerWarmRetryAfter = Date.now() + DOCKER_WARM_ERROR_COOLDOWN_MS;
  // Do NOT cache an unverified preferred image — leave ready null for retry
  return null;
}

/**
 * Currently verified Docker sandbox image, or null if not ready.
 * @returns {string | null}
 */
export function getReadyDockerSandboxImage() {
  return readyDockerSandboxImage;
}

/**
 * @returns {{ state: string, image: string | null, error: string | null }}
 */
export function getDockerSandboxWarmStatus() {
  return {
    state: dockerWarmState,
    image: readyDockerSandboxImage,
    error: dockerWarmError,
  };
}

/**
 * Synchronous resolve for the hot `terminal/create` path.
 * Only returns a previously verified image — never pull/build on main.
 * Kicks a background warm if not ready yet.
 *
 * @param {string} dockerPath
 * @param {string} [preferredImage]
 * @returns {string}
 */
export function resolveDockerSandboxImageForSpawn(dockerPath, preferredImage) {
  if (readyDockerSandboxImage) return readyDockerSandboxImage;

  const now = Date.now();
  const inCooldown =
    dockerWarmState === "error" && now < dockerWarmRetryAfter;

  // Kick background prepare when idle / first failure expired (not while cooling down)
  if (!inCooldown) {
    void warmDockerSandboxImage({
      dockerPath,
      preferredImage: preferredImage || DEFAULT_DOCKER_IMAGE,
    });
  }

  let status;
  if (dockerWarmState === "warming") {
    status =
      "Preparing a git-capable sandbox image in the background (first run may pull or build). Retry the tool in a few seconds.";
  } else if (inCooldown && dockerWarmError) {
    const secs = Math.max(1, Math.ceil((dockerWarmRetryAfter - now) / 1000));
    status = `Docker sandbox image not ready: ${dockerWarmError} (retry in ~${secs}s)`;
  } else if (dockerWarmError) {
    status = `Docker sandbox image not ready: ${dockerWarmError}`;
  } else {
    status =
      "Docker sandbox image is not ready yet. Preparing in the background — retry shortly.";
  }

  throw Object.assign(new Error(status), { code: -32000 });
}

/**
 * Ensure a Docker image with git is available (async, non-blocking to callers
 * that fire-and-forget). Only caches images that pass the git probe.
 *
 * Prefers GROK_DESKTOP_SANDBOX_IMAGE / buildpack-deps; falls back to a one-time
 * local build from ubuntu:24.04 + apt git.
 *
 * @param {{ dockerPath?: string, preferredImage?: string, force?: boolean }} [opts]
 * @returns {Promise<string | null>} ready image ref, or null on failure
 */
export async function warmDockerSandboxImage(opts = {}) {
  if (readyDockerSandboxImage && !opts.force) return readyDockerSandboxImage;
  if (dockerWarmPromise && !opts.force) return dockerWarmPromise;
  if (
    !opts.force &&
    dockerWarmState === "error" &&
    Date.now() < dockerWarmRetryAfter
  ) {
    return null;
  }

  const dockerPath = opts.dockerPath || findDocker();
  if (!dockerPath) {
    markDockerError("Docker not found");
    return null;
  }
  const preferred = opts.preferredImage || DEFAULT_DOCKER_IMAGE;

  dockerWarmState = "warming";
  dockerWarmError = null;
  dockerWarmRetryAfter = 0;

  dockerWarmPromise = (async () => {
    try {
      // 1) Preferred already local + has git
      if (await dockerImageExistsAsync(dockerPath, preferred)) {
        if (await dockerImageHasGitAsync(dockerPath, preferred)) {
          return markDockerReady(preferred);
        }
      } else {
        // 2) Pull preferred (may be first run — async so UI stays responsive)
        const pull = await runAsync(dockerPath, ["pull", preferred], {
          timeoutMs: 300_000,
        });
        if (pull.status === 0 && (await dockerImageHasGitAsync(dockerPath, preferred))) {
          return markDockerReady(preferred);
        }
      }

      // 3) Local recipe image from a previous ensure
      if (await dockerImageExistsAsync(dockerPath, LOCAL_SANDBOX_IMAGE)) {
        if (await dockerImageHasGitAsync(dockerPath, LOCAL_SANDBOX_IMAGE)) {
          return markDockerReady(LOCAL_SANDBOX_IMAGE);
        }
      }

      // 4) Build minimal image with git once
      const dockerfile = [
        `# grok-desktop sandbox recipe ${LOCAL_SANDBOX_RECIPE}`,
        "FROM ubuntu:24.04",
        "ENV DEBIAN_FRONTEND=noninteractive",
        "RUN apt-get update \\",
        " && apt-get install -y --no-install-recommends git ca-certificates openssh-client curl \\",
        " && rm -rf /var/lib/apt/lists/*",
      ].join("\n");

      const build = await runAsync(
        dockerPath,
        ["build", "-t", LOCAL_SANDBOX_IMAGE, "-"],
        { timeoutMs: 600_000, input: dockerfile },
      );
      if (build.status === 0) {
        if (await dockerImageHasGitAsync(dockerPath, LOCAL_SANDBOX_IMAGE)) {
          return markDockerReady(LOCAL_SANDBOX_IMAGE);
        }
        return markDockerError(
          `Built ${LOCAL_SANDBOX_IMAGE} but git probe failed`,
        );
      }
      const detail = (build.stderr || build.stdout || "docker build failed")
        .trim()
        .slice(-500);
      return markDockerError(`docker build failed: ${detail}`);
    } catch (err) {
      return markDockerError(String(err?.message || err));
    } finally {
      dockerWarmPromise = null;
    }
  })();

  return dockerWarmPromise;
}

/**
 * @deprecated use warmDockerSandboxImage / resolveDockerSandboxImageForSpawn
 * Sync wrapper kept for any external callers; never pull/build on the hot path.
 * @param {string} dockerPath
 * @param {string} preferredImage
 * @returns {string}
 */
export function ensureDockerSandboxImage(dockerPath, preferredImage) {
  return resolveDockerSandboxImageForSpawn(dockerPath, preferredImage);
}

function findWsl() {
  for (const p of [
    "C:\\Windows\\System32\\wsl.exe",
    "C:\\Windows\\Sysnative\\wsl.exe",
  ]) {
    if (fs.existsSync(p)) return p;
  }
  return findOnPath("wsl") || findOnPath("wsl.exe");
}

/**
 * @param {string} wslPath
 * @returns {string[]}
 */
function listWslDistros(wslPath) {
  const r = runQuiet(wslPath, ["-l", "-q"], 10000);
  const out = `${r.stdout || ""}${r.stderr || ""}`;
  let text = out;
  if (out.includes("\u0000")) {
    try {
      text = Buffer.from(out, "utf16le").toString("utf8");
    } catch {
      text = out.replace(/\u0000/g, "");
    }
  }
  return text
    .split(/\r?\n/)
    .map((s) => s.replace(/\u0000/g, "").trim())
    .filter((s) => s && !s.startsWith("Windows Subsystem"));
}

/**
 * @param {string} wslPath
 * @param {string} distro
 */
function wslHasBwrap(wslPath, distro) {
  const r = runQuiet(
    wslPath,
    ["-d", distro, "--", "sh", "-c", "command -v bwrap"],
    12000,
  );
  return r.status === 0 && String(r.stdout || "").trim().length > 0;
}

/**
 * Shared bwrap jail recipe (no docker.sock, no $HOME).
 * Used by host Linux and WSL backends so bind policy has one owner.
 *
 * @param {object} opts
 * @param {string} opts.projectRoot
 * @param {string} opts.cwd
 * @param {boolean} [opts.assumeLinuxPaths] skip host existsSync (WSL path space)
 * @returns {{ projectRoot: string, cwd: string, roBinds: string[] }}
 */
export function bwrapJailSpec(opts) {
  const assume = Boolean(opts.assumeLinuxPaths);
  // WSL path space must not be realpath'd on the Windows host
  const projectRoot = assume
    ? String(opts.projectRoot)
    : realpathOrSelf(opts.projectRoot);
  const cwd = assume ? String(opts.cwd) : realpathOrSelf(opts.cwd);

  /** @type {string[]} */
  const roBinds = [];
  for (const p of BWRAP_RO_BINDS) {
    if (assume) {
      roBinds.push(p);
      continue;
    }
    try {
      if (fs.existsSync(p)) roBinds.push(p);
    } catch {
      /* ignore */
    }
  }

  return { projectRoot, cwd, roBinds };
}

/**
 * bwrap argv: [bwrapPath, ...flags, '--', ...inner] without the inner command.
 * @param {{
 *   projectRoot: string,
 *   cwd: string,
 *   bwrapPath?: string,
 *   assumeLinuxPaths?: boolean,
 * }} opts
 * @returns {string[]} full argv including bwrap binary as [0]
 */
export function buildBwrapArgv(opts) {
  const spec = bwrapJailSpec(opts);
  const bwrap = opts.bwrapPath || "bwrap";
  /** @type {string[]} */
  const args = [
    bwrap,
    "--die-with-parent",
    "--dev",
    "/dev",
    "--proc",
    "/proc",
    "--tmpfs",
    "/tmp",
  ];
  for (const p of spec.roBinds) {
    // --ro-bind-try: skip missing paths without failing the jail
    args.push("--ro-bind-try", p, p);
  }
  args.push("--bind", spec.projectRoot, spec.projectRoot);
  args.push("--chdir", spec.cwd);
  args.push("--");
  return args;
}

/** @deprecated use buildBwrapArgv — kept as alias for call sites / tests */
export function buildBwrapPrefix(opts) {
  return buildBwrapArgv(opts);
}

/**
 * Seatbelt profile for ACP tool shells.
 *
 * `(allow default)` then deny $HOME outside the open project + docker sockets.
 * Pure `(deny default)` allowlists SIGABRT on modern macOS (dyld paths).
 *
 * @param {{ projectRoot: string, tmpDir?: string, homeDir?: string }} opts
 */
export function buildSeatbeltProfile(opts) {
  const projectRoot = realpathOrSelf(opts.projectRoot);
  const tmpDir = realpathOrSelf(opts.tmpDir || os.tmpdir());
  let home = opts.homeDir || os.homedir();
  try {
    home = fs.realpathSync(home);
  } catch {
    home = path.resolve(home);
  }

  const projectLit = seatbeltLiteral(projectRoot);
  const tmpLit = seatbeltLiteral(tmpDir);
  const homeLit = seatbeltLiteral(home);

  return `(version 1)
(allow default)

; Block the user home tree except the open project (lexical subpath match).
(deny file-read* file-write* file-ioctl file-write-data
  (require-all
    (subpath "${homeLit}")
    (require-not (subpath "${projectLit}"))
  )
)

; Host Docker daemon sockets (not under $HOME on some installs)
(deny file-read* file-write* file-ioctl
  (literal "/var/run/docker.sock")
  (literal "/private/var/run/docker.sock")
  (literal "/var/run/docker.sock.raw")
)

; TMPDIR / system temps remain usable
(allow file-read* file-write*
  (subpath "${tmpLit}")
  (subpath "/private/tmp")
  (subpath "/tmp")
  (subpath "/private/var/folders")
)
`;
}

/**
 * @param {{ refresh?: boolean }} [opts]
 * @returns {SandboxProbe}
 */
export function probeSandbox(opts = {}) {
  if (!opts.refresh && probeCache) return probeCache;
  probeCache = probeSandboxUncached();
  return probeCache;
}

/** @returns {SandboxProbe} */
function probeSandboxUncached() {
  const platform = process.platform;
  const dockerImage = DEFAULT_DOCKER_IMAGE;

  /** @param {Partial<SandboxProbe> & Pick<SandboxProbe, 'available' | 'backend' | 'detail'>} p */
  const result = (p) => ({
    platform,
    dockerImage,
    ...p,
  });

  if (platform === "darwin") {
    const ok = fs.existsSync(SANDBOX_EXEC);
    return result({
      available: ok,
      backend: ok ? "sandbox-exec" : "none",
      detail: ok
        ? "macOS Seatbelt (sandbox-exec)"
        : "sandbox-exec not found",
    });
  }

  if (platform === "linux") {
    const bwrap = findBwrapHost();
    if (bwrap) {
      return result({
        available: true,
        backend: "bwrap",
        detail: `bubblewrap (${bwrap})`,
        bwrapPath: bwrap,
      });
    }
    const docker = findDocker();
    if (docker) {
      return result({
        available: true,
        backend: "docker",
        detail: `Docker fallback (${docker}) — no host docker.sock`,
        dockerPath: docker,
      });
    }
    return result({
      available: false,
      backend: "none",
      detail: "Install bubblewrap (bwrap) or Docker",
    });
  }

  if (platform === "win32") {
    const wsl = findWsl();
    if (wsl) {
      const distros = listWslDistros(wsl);
      const preferred =
        process.env.GROK_DESKTOP_WSL_DISTRO ||
        process.env.WSL_DISTRO_NAME ||
        distros[0] ||
        null;
      const candidates = preferred
        ? [preferred, ...distros.filter((d) => d !== preferred)]
        : distros;
      for (const d of candidates) {
        if (wslHasBwrap(wsl, d)) {
          return result({
            available: true,
            backend: "wsl-bwrap",
            detail: `WSL + bwrap (distro: ${d})`,
            wslPath: wsl,
            wslDistro: d,
          });
        }
      }
    }

    const docker = findDocker();
    if (docker) {
      return result({
        available: true,
        backend: "docker",
        detail: `Docker fallback (${docker}) — no host docker.sock`,
        dockerPath: docker,
      });
    }

    return result({
      available: false,
      backend: "none",
      detail:
        "Install WSL with bubblewrap (bwrap), or Docker Desktop. No sandbox backend found.",
    });
  }

  return result({
    available: false,
    backend: "none",
    detail: `Unsupported platform: ${platform}`,
  });
}

/**
 * @param {{ file: string, fileArgs: string[], shell?: boolean }} inner
 * @returns {{ file: string, fileArgs: string[] }}
 */
function materializeInnerCommand(inner) {
  const file = inner.file;
  const fileArgs = Array.isArray(inner.fileArgs)
    ? inner.fileArgs.map(String)
    : [];
  if (inner.shell) {
    // Host shell:true (Windows .cmd shims) → real argv inside the jail
    const line = [file, ...fileArgs].join(" ");
    return { file: "/bin/bash", fileArgs: ["-lc", line] };
  }
  return { file, fileArgs };
}

/**
 * Map a host inner command into paths valid inside a Docker container
 * that bind-mounts the project at /work.
 *
 * Explicit rules (no substring magic):
 * 1. /bin/bash, /usr/bin/bash, "bash", *.exe bash → /bin/bash
 * 2. Absolute path under projectRoot → /work/<relative>
 * 3. Other absolute host paths left as-is only if POSIX system paths
 *    (/bin, /usr, /lib, /opt, /etc, /dev, /tmp); else force bash -lc of joined line
 * 4. Relative / bare names passed through (resolved via container PATH)
 *
 * @param {{ file: string, fileArgs: string[] }} inner
 * @param {string} projectRoot
 * @returns {{ file: string, fileArgs: string[] }}
 */
export function mapInnerCommandForDocker(inner, projectRoot) {
  const file = String(inner.file);
  const fileArgs = Array.isArray(inner.fileArgs)
    ? inner.fileArgs.map(String)
    : [];
  const rootReal = realpathOrSelf(projectRoot);

  const base = path.basename(file).toLowerCase();
  const isBash =
    file === "/bin/bash" ||
    file === "/usr/bin/bash" ||
    file === "bash" ||
    base === "bash" ||
    base === "bash.exe";

  if (isBash) {
    return { file: "/bin/bash", fileArgs };
  }

  const isWinAbs = /^[A-Za-z]:[\\/]/.test(file);
  const isPosixAbs = file.startsWith("/");
  if (!isWinAbs && !isPosixAbs) {
    // Relative / bare command — container PATH
    return { file, fileArgs };
  }

  // Project-absolute host path → /work/...
  if (!isWinAbs) {
    const fileResolved = realpathOrSelf(file);
    const rel = path.relative(rootReal, fileResolved);
    if (rel && !rel.startsWith("..") && !path.isAbsolute(rel)) {
      return {
        file: `/work/${rel.split(path.sep).join("/")}`,
        fileArgs,
      };
    }
    // Known POSIX system roots usable as-is in a Linux container
    if (
      /^\/(bin|usr|lib|lib64|opt|etc|dev|tmp|sbin)(\/|$)/.test(fileResolved)
    ) {
      return { file: fileResolved, fileArgs };
    }
  }

  // Windows host path or other absolute — re-pack as bash -lc
  const line = [file, ...fileArgs].join(" ");
  return { file: "/bin/bash", fileArgs: ["-lc", line] };
}

/**
 * Plan a sandboxed spawn. Throws if sandbox cannot be applied.
 *
 * @param {{
 *   file: string,
 *   fileArgs: string[],
 *   shell?: boolean,
 *   cwd: string,
 *   env: NodeJS.ProcessEnv | Record<string, string | undefined>,
 *   projectRoot: string,
 * }} opts
 * @returns {SpawnPlan}
 */
export function planSandboxedSpawn(opts) {
  const projectRoot = realpathOrSelf(opts.projectRoot);
  const cwd = realpathOrSelf(opts.cwd || projectRoot);
  const env = { ...(opts.env || {}) };
  const probe = probeSandbox();

  if (!probe.available) {
    throw Object.assign(
      new Error(
        `Terminal sandbox is enabled but no backend is available (${probe.detail}). ` +
          `Install the required tools or disable “Sandbox terminal” in Settings.`,
      ),
      { code: -32000 },
    );
  }

  const inner = materializeInnerCommand({
    file: opts.file,
    fileArgs: opts.fileArgs,
    shell: Boolean(opts.shell),
  });

  if (probe.backend === "sandbox-exec") {
    const profile = buildSeatbeltProfile({ projectRoot });
    return {
      file: SANDBOX_EXEC,
      fileArgs: ["-p", profile, "--", inner.file, ...inner.fileArgs],
      shell: false,
      cwd,
      env,
      backend: "sandbox-exec",
    };
  }

  if (probe.backend === "bwrap") {
    const prefix = buildBwrapArgv({
      projectRoot,
      cwd,
      bwrapPath: probe.bwrapPath || "bwrap",
    });
    return {
      file: prefix[0],
      fileArgs: [...prefix.slice(1), inner.file, ...inner.fileArgs],
      shell: false,
      cwd: projectRoot,
      env,
      backend: "bwrap",
    };
  }

  if (probe.backend === "wsl-bwrap") {
    return planWslBwrap({ probe, projectRoot, cwd, env, inner });
  }

  if (probe.backend === "docker") {
    return planDocker({ probe, projectRoot, cwd, env, inner });
  }

  throw Object.assign(
    new Error(`Terminal sandbox backend not implemented: ${probe.backend}`),
    { code: -32000 },
  );
}

/**
 * WSL + bwrap via direct argv (no project temp scripts).
 * Host spawn: wsl.exe -d <distro> -- bwrap ... -- <inner>
 *
 * @param {{
 *   probe: SandboxProbe,
 *   projectRoot: string,
 *   cwd: string,
 *   env: Record<string, string | undefined>,
 *   inner: { file: string, fileArgs: string[] },
 * }} p
 * @returns {SpawnPlan}
 */
function planWslBwrap(p) {
  const wslPath = p.probe.wslPath;
  const distro = p.probe.wslDistro;
  if (!wslPath || !distro) {
    throw Object.assign(new Error("WSL sandbox misconfigured"), {
      code: -32000,
    });
  }

  const projectWsl =
    process.platform === "win32"
      ? winToWslPath(p.projectRoot)
      : p.projectRoot;
  const cwdWsl =
    process.platform === "win32" ? winToWslPath(p.cwd) : p.cwd;

  if (!projectWsl || !cwdWsl) {
    throw Object.assign(
      new Error(
        `Cannot map project path to WSL: ${p.projectRoot}. Open a project on a fixed drive path.`,
      ),
      { code: -32000 },
    );
  }

  // Jail recipe in WSL path space (assume standard Linux layout in distro)
  const bwrapArgv = buildBwrapArgv({
    projectRoot: projectWsl,
    cwd: cwdWsl,
    bwrapPath: "bwrap",
    assumeLinuxPaths: true,
  });

  // Map common host bash → WSL bash
  let innerFile = p.inner.file;
  let innerArgs = p.inner.fileArgs;
  const base = path.basename(innerFile).toLowerCase();
  if (
    innerFile === "bash" ||
    base === "bash" ||
    base === "bash.exe" ||
    /^[A-Za-z]:[\\/]/.test(innerFile)
  ) {
    // Host Windows path executable — run via bash -lc of the original line
    if (/^[A-Za-z]:[\\/]/.test(innerFile) && base !== "bash" && base !== "bash.exe") {
      const line = [innerFile, ...innerArgs].join(" ");
      innerFile = "/bin/bash";
      innerArgs = ["-lc", line];
    } else {
      innerFile = "/bin/bash";
    }
  } else if (innerFile === "/bin/bash" || innerFile === "/usr/bin/bash") {
    innerFile = "/bin/bash";
  } else if (process.platform === "win32") {
    const asWsl = winToWslPath(innerFile);
    if (asWsl && asWsl.startsWith(projectWsl)) {
      innerFile = asWsl;
    }
  }

  return {
    file: wslPath,
    fileArgs: [
      "-d",
      distro,
      "--",
      ...bwrapArgv,
      innerFile,
      ...innerArgs,
    ],
    shell: false,
    cwd: p.projectRoot,
    env: p.env,
    backend: "wsl-bwrap",
  };
}

/**
 * @param {{
 *   probe: SandboxProbe,
 *   projectRoot: string,
 *   cwd: string,
 *   env: Record<string, string | undefined>,
 *   inner: { file: string, fileArgs: string[] },
 * }} p
 * @returns {SpawnPlan}
 */
function planDocker(p) {
  const docker = p.probe.dockerPath || findDocker();
  if (!docker) {
    throw Object.assign(new Error("Docker not found for sandbox fallback"), {
      code: -32000,
    });
  }
  const preferred = p.probe.dockerImage || DEFAULT_DOCKER_IMAGE;
  // Hot path: only a previously verified image. Never pull/build on main.
  // Background warm is kicked from resolve if needed.
  const image = resolveDockerSandboxImageForSpawn(docker, preferred);
  const rel = relUnderProject(p.projectRoot, p.cwd);
  if (rel == null) {
    throw Object.assign(
      new Error("Terminal cwd is outside project; refused by sandbox"),
      { code: -32000 },
    );
  }
  const workdir =
    rel === "." ? "/work" : `/work/${rel.split(path.sep).join("/")}`;

  const mapped = mapInnerCommandForDocker(p.inner, p.projectRoot);
  const vol = `${p.projectRoot}:/work`;

  // Non-interactive git inside the container (no TTY, no editor hang).
  const envFlags = [
    "-e",
    "DEBIAN_FRONTEND=noninteractive",
    "-e",
    "GIT_EDITOR=true",
    "-e",
    "EDITOR=true",
    "-e",
    "VISUAL=true",
    "-e",
    "GIT_TERMINAL_PROMPT=0",
    "-e",
    "GIT_PAGER=cat",
    "-e",
    "PAGER=cat",
    "-e",
    // Ephemeral container: accept-new is OK (no durable host known_hosts)
    "GIT_SSH_COMMAND=ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new -o ConnectTimeout=15",
    "-e",
    "GCM_INTERACTIVE=never",
    "-e",
    "GPG_TTY=",
  ];

  return {
    file: docker,
    fileArgs: [
      "run",
      "--rm",
      // Do NOT use -i: Electron stdio stdin is "ignore"; docker -i then often
      // hangs after the command exits waiting on a dead interactive stdin
      // (tools stuck on "pending" forever).
      "--init",
      "-v",
      vol,
      "-w",
      workdir,
      ...envFlags,
      // No --privileged, no docker.sock
      image,
      mapped.file,
      ...mapped.fileArgs,
    ],
    shell: false,
    cwd: p.projectRoot,
    env: p.env,
    backend: "docker",
  };
}

/**
 * Human-readable one-liner for Settings.
 * @param {{ refresh?: boolean }} [opts]
 */
export function sandboxStatusLabel(opts = {}) {
  const p = probeSandbox(opts);
  if (!p.available) return `Unavailable — ${p.detail}`;
  if (p.backend === "docker") {
    const warm = getDockerSandboxWarmStatus();
    if (warm.state === "ready" && warm.image) {
      return `${p.detail} · image ${warm.image}`;
    }
    if (warm.state === "warming") {
      return `${p.detail} · preparing image…`;
    }
    if (warm.state === "error" && warm.error) {
      return `${p.detail} · image error: ${warm.error}`;
    }
    return `${p.detail} · image not ready`;
  }
  return p.detail;
}

/**
 * Fire-and-forget warm when Docker is the sandbox backend.
 * Safe to call often; coalesces concurrent warms.
 */
export function maybeWarmDockerSandbox() {
  const p = probeSandbox();
  if (!p.available || p.backend !== "docker") return;
  void warmDockerSandboxImage({
    dockerPath: p.dockerPath,
    preferredImage: p.dockerImage || DEFAULT_DOCKER_IMAGE,
  });
}
