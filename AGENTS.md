# AGENTS.md — Grok Desktop

Instructions for AI agents (and humans) working in this repo. Read this first.

## Product in one sentence

**Electron + React GUI** that talks to the installed **Grok Build CLI** over ACP (`grok agent stdio`).  
This repo does **not** ship models, tools, skills, or the agent itself — only the desktop shell.

```
User → Grok Desktop (this repo) → grok agent stdio (ACP/JSON-RPC) → ~/.grok skills/MCP/auth
```

Upstream agent: https://github.com/xai-org/grok-build  
This GUI: https://github.com/liaan/grok-desktop  

Team-facing install docs: **`README.md` only** (do not restate them elsewhere).  
Agent/maintainer process: **this file only**.

---

## Ownership model

The human owner (**liaan**) wants agents to **run the show**: package, release, keep docs accurate, ship installers for the team. Do not leave half-finished packaging/docs work for him.

| Who | Does what |
|-----|-----------|
| **Team users** | Download installer from GitHub Releases. No npm. See README. |
| **Agents / maintainers** | Code, CI, bump version, tag, push, verify Release assets. |
| **Human** | Product direction only. |

---

## Layout

```
grok-desktop/
  electron/           # Main process (Node ESM)
    main.mjs          # Window, IPC, agent lifecycle
    preload.cjs       # contextBridge (must stay CJS)
    acp-client.mjs    # spawn grok + JSON-RPC ACP
    auth.mjs          # login / logout via CLI
    backbone.mjs      # grok inspect (skills, MCP summary)
    grok-home.mjs     # resolve grok binary + GROK_HOME
  src/                # Renderer (React + Vite + TS)
  dist/               # Vite build output (gitignored)
  release/            # electron-builder output (gitignored)
  .github/workflows/
    release.yml       # Win/mac/Linux installers → GitHub Releases
```

- **Main** loads UI from Vite in dev (`http://127.0.0.1:5173`); when packaged (`app.isPackaged`) loads `dist/index.html`.
- Vite `base` is `./` so `file://` packaging works.
- Installer filenames: `GrokDesktop-${version}-${os}-${arch}…` (see `package.json` `build.artifactName` / platform overrides). No spaces.

---

## Commands

| Command | Purpose |
|---------|---------|
| `npm install` | Deps (Node 20+) |
| `npm run dev` | Vite + Electron (day-to-day) |
| `npm run build` | Vite production UI → `dist/` |
| `npm start` | Electron against existing `dist/` |
| `npm run preview` | build + start |
| `npm run pack` | build + electron-builder `--dir` (unpacked app) |
| `npm run dist` | build + installer for **current** OS |
| `npm run dist:win` / `dist:mac` / `dist:linux` | Platform-specific (CI ships Win + mac + Linux AppImage) |

**End users never run these.** They use GitHub Release installers.

Runtime dependency: **`grok` CLI** (`GROK_BINARY` / `GROK_HOME` / `XAI_API_KEY` overrides).

---

## Shipping installers (canonical checklist)

Preferred path is **CI**, not local cross-builds. Softprops + multi-OS artifacts own the GitHub Release page — do **not** enable electron-builder `--publish`.

### Cut a release

1. Bump `version` in `package.json` (e.g. `0.1.1` → `0.1.2`). Tag **must** be `v` + that version; CI fails otherwise.
2. Commit all release-related changes on `master` and push.
3. Tag and push:
   ```bash
   git tag v0.1.2
   git push origin master
   git push origin v0.1.2
   ```
4. Wait for **Build & Release** (`.github/workflows/release.yml`).
5. Verify assets at https://github.com/liaan/grok-desktop/releases  
   **Team installers** (what humans download):
   - `GrokDesktop-*-Windows-Setup.exe`
   - `GrokDesktop-*-Mac-AppleSilicon.dmg`
   - `GrokDesktop-*-Mac-Intel.dmg`
   - `GrokDesktop-*-Linux-x64.AppImage`
   **Auto-update metadata** (for Help → Check for updates; not for hand install):
   - `latest.yml` (Windows)
   - `latest-mac.yml` + `GrokDesktop-*-Mac-arm64.zip` / `…-Mac-x64.zip`
   - `latest-linux.yml` (Linux AppImage)
   - optional `*.blockmap`
   No portable Windows / extra Linux noise. CI renames DMGs for friendlier names; **mac zips keep arch names** so yml paths stay valid.
6. Point the team at **Releases → latest**.

### Releases and auto-update

- Softprops still owns the Release page — **do not** enable electron-builder `--publish`.
- CI **does** upload `latest*.yml` + mac zip so `electron-updater` works in packaged apps.
- Help → **Check for updates…** runs `checkForUpdatesInteractive()` (download + restart dialog). **Open Releases page** is the manual fallback.
- First install after enabling auto-update still needs a normal installer once; later upgrades can be in-app.
- **macOS install path:** builds are ad-hoc signed. Do **not** rely on Squirrel.Mac/`quitAndInstall` alone — `electron/auto-update.mjs` replaces the `.app` from the downloaded zip via a detached helper (then relaunches). Failures log to `~/Library/Logs/grok-desktop-update.log`.

### Manual / test build without a release

GitHub → **Actions → Build & Release → Run workflow**  
Artifacts only; no Release page unless ref is a `v*` tag.

### Local packaging notes

- Ship Windows installers via CI (or a Windows machine). Do not rely on macOS cross-compile.
- Builds are **unsigned** (`CSC_IDENTITY_AUTO_DISCOVERY=false` in CI).
- Never commit `dist/`, `release/`, or `node_modules/`.
- If you change installer naming or platforms, update **README** team-install table and `artifactName` together.

---

## Coding conventions

- **Electron main**: ESM (`.mjs`). Keep `preload` as **`.cjs`**.
- **Renderer**: React function components + TypeScript under `src/`.
- Do **not** reimplement the agent, tools, or skill runner here. GUI / ACP client only.
- Prefer CLI via spawn + IPC over duplicating auth or config parsing.
- Match existing style. No drive-by refactors. No new deps unless needed.
- Keep **README** accurate for team install. Keep **this file** accurate for release process. Do not duplicate those sections into the workflow or release body beyond a short pointer.

---

## ACP surface (do not break casually)

Client → agent: `initialize`, `session/new`, `session/load`, `session/prompt`, `session/cancel`  
Agent → client: `session/update`, `session/request_permission`, `fs/*`, `terminal/*`

`session/new` / `session/load` use empty client `mcpServers`; agent still loads MCP/skills from `~/.grok`.

### Agent config inheritance (do not reimplement in the GUI)

Desktop is a shell. Config ownership:

| Source | What | Desktop role |
|--------|------|----------------|
| Open project path | Session + spawn **cwd** | Pass folder into `session/new` / `load` / `spawn` |
| Project tree (`AGENTS.md`, `CLAUDE.md`, rules, …) | Agent instruction files | **None** — agent loads from cwd (same as CLI) |
| `GROK_HOME` / `~/.grok` | Skills, MCP, plugins, auth, models | Env via `buildGrokEnv`; never edit `config.toml` in-app |
| Client `mcpServers: []` | Embed contract | Always empty; agent merges its own MCP (upstream Grok Build) |
| `grok inspect --json` | Skill/MCP/plugin **names** for UI | Slash menu + AuthGate counts + Settings skills list — not the runtime loader |
| `grok mcp list/add/enable/disable/remove/doctor` | Settings → MCP | Dedicated IPC only; never parse or write `config.toml` |
| `grok plugin list/enable/disable/install` | Settings → Plugins | Dedicated IPC only; install uses `--trust` after UI confirm |
| Runtime skills | `/name` as `session/prompt` | Same as CLI; no separate skill runner here |

**Outstanding / not in GUI (document for team):**

- No settings UI for models or skill authoring (README: Planned). MCP and plugin list/toggle are in Settings; skills are listed read-only.
- No in-app editor for project `AGENTS.md` (edit in the repo)
- No plugin marketplace browser (install from git URL only)
- Config changes under `~/.grok` need a **new agent process** (Settings → Restart agent) to bind into the live session. MCP/plugin writes already restart.

### Client capabilities

| Capability | Status | Notes |
|------------|--------|--------|
| `fs.readTextFile` / `fs.writeTextFile` | Implemented | `electron/acp-client.mjs` |
| `terminal` | Implemented | `electron/acp-terminals.mjs` — create / output / wait_for_exit / kill / release |
| Permissions | Implemented | UI + optional always-approve |
| Slash commands | Implemented | Composer `/` menu — ACP `available_commands_update` + skills from `grok inspect` + desktop `/new` `/clear` `/always-approve` |

Terminals spawn in the project `cwd` (or the path the agent passes). Output is buffered (default 1 MiB, truncated from the start). Dispose / cwd change releases all terminals.

**Shell packaging / quotes:** Agents often send `command: "/bin/bash -lc '…'"` as one string (or freeform lines with nested quotes). The client **must never** spawn a multi-word string as the executable (ENOENT). Normalization lives in `electron/terminal-spawn.mjs` + `electron/shell-argv.mjs` (wired from `acp-terminals.mjs`):

1. **Real argv** (`command` = single token, `args` = list) → `spawn(cmd, args)` — no re-quoting (preserves `don't` in commit messages).
2. **Packed shell line** → tokenize with `shellSplit` (POSIX quotes), extract `-c` script body, then `spawn(bash, ["-lc", script])`. Never regex-strip outer quotes.
3. **Split packing** (`command: "bash -lc"`, `args: [script]`) → same as (2); glue script from args.
4. **Freeform** → `spawn(bash, ["-lc", originalString])` as **one** argv element so the agent's quotes stay intact.
5. **Multi-line / heredoc** → write a temp `run.sh` and `spawn(bash, [file])` (avoids ENAMETOOLONG).
6. When re-packing argv into a shell line (sandbox Docker/WSL path mapping, freeform glue), use `shellJoin` / `shellEscape` — **never** `args.join(" ")` (that breaks spaces and apostrophes).

PATH is enriched via `buildGrokEnv` (macOS Dock launches have a thin PATH). **Electron main does not hot-reload** — quit the app fully after changing `acp-terminals.mjs` / `terminal-spawn.mjs` / `shell-argv.mjs` / `terminal-sandbox.mjs`.

**Slash commands:** Type `/` in the composer. Agent skills (`/review`, `/code-review`, `/design`, `/implement`, …) are sent as normal `session/prompt` text (same as CLI). Desktop-local commands are handled in the GUI and never reach the agent.

**Mid-turn interject (CLI-style):** While a turn is running, **Enter** queues a follow-up (shown above the composer). **Ctrl/⌘+Enter** or **Send now** cancels the current turn and sends that message next. Empty Enter with a non-empty queue force-sends the top item. Queue drains FIFO when each turn ends.

### Session continuity (same as CLI)

- Sessions live under `~/.grok/sessions/<encoded-cwd>/<session-id>/` (shared with TUI).
- Desktop **continues** the latest session on open (`session/load` + history from `updates.jsonl`).
- **New chat** → `session/new`. Sidebar lists chats from disk (`electron/sessions.mjs`).
- Do not invent a parallel chat store; always use the CLI session layout.

---

## Security / product boundaries

- `contextIsolation: true`, `nodeIntegration: false` — keep it that way.
- External links via `shell.openExternal` (http/s only from markdown).
- Auth via Grok CLI flows; no parallel token store unless product requires it.
- MIT GUI; do not vendor agent source here.

### Project-root safety gate (default on)

Canonical helpers: `electron/path-safety.mjs` (`assertPathInProject`, `resolveProjectPath`). Paths are checked **lexically** and with **`realpath`** (symlinks inside the project that point outside are rejected). New write targets realpath the nearest existing ancestor.

**Linked git worktrees** of the open project’s repository are also allowed when the gate is on (via `git worktree list` — see `electron/git-worktrees.mjs`). Sibling checkouts from `git worktree add ../foo` therefore work for ACP `fs/*` and terminal cwd without enabling full host access. Unrelated paths still need **Allow outside project**.

| Surface | Gated by “Allow outside project”? | Behavior |
|---------|-----------------------------------|----------|
| ACP `fs/read_text_file` / `fs/write_text_file` | Yes (default off = blocked) | `resolveProjectPath(..., { allowOutside, allowGrokHome: true })` — **project + worktrees + `GROK_HOME` (`~/.grok` skills/agents/personas/sessions) always OK**; other host paths need Allow outside |
| ACP `terminal/create` cwd | Yes | Same helper (project / worktrees / `GROK_HOME`) |
| Terminal **sandbox** jail | Independent | Home jail **except** open project + **`GROK_HOME` bind** (skills still readable); rest of `$HOME` blocked |
| Renderer IPC (`fs:read-file`, `fs:list-dir`, shell open/show) | **No — always project-scoped** | Requires an open project; cannot leave the folder even if the agent may |

Stored in `desktop-state.json` as `allowOutsideProject`. UI confirm when turning on.

**Note:** Terminal **sandbox** (Host shell chip) is independent — it jails shell processes. Turning sandbox off does **not** allow ACP file tools outside the project/worktrees.

### Tool permission mode (Ask / Auto / Always approve)

Desktop stores `permissionMode` in `desktop-state.json` (`ask` default; migrates legacy `alwaysApprove: true` → `always-approve`).

| Mode | Client | Agent |
|------|--------|--------|
| `ask` | Show every `session/request_permission` | `_meta.permissionMode: default` |
| `auto` | Show only escalations the agent still requests | `_meta.permissionMode: auto` |
| `always-approve` | Auto-respond allow-once (except plan exit formality) | `_meta.yoloMode: true` + `permissionMode: bypassPermissions` |

Live changes call `session/set_mode` when available, else slash `/always-approve on|off` or `/auto`. UI: topbar **Perms** select + Settings dropdown.

### Reasoning effort (topbar Effort)

Desktop stores `reasoningEffort` in `desktop-state.json` (`high` default). Spawn uses `grok agent --reasoning-effort <level> stdio` (flag must be before the transport subcommand). Live changes call `session/set_model` with `modelId` + `_meta.reasoningEffort` (same surface as CLI `/effort`). Levels: `low` | `medium` | `high` | `xhigh` — a model only accepts tiers it advertises.

### Plan mode & background tasks (GUI)

| Surface | Behavior |
|---------|----------|
| `x.ai/exit_plan_mode` | Client extension — Desktop shows **Plan approval** modal (approve / request changes / abandon). Must not be no-op (agent reports “client disconnected”). |
| `x.ai/ask_user_question` | Client extension — multi-choice **Ask user** modal |
| ACP `fs/*` under session dir | Always allowed for the current session folder (`~/.grok/sessions/<encoded-cwd>/<session-id>/`) so `plan.md` can be written while project path gate stays on |
| `task_backgrounded` / `task_completed` / `subagent_*` | Right panel **Tasks** bottom dock (agent often sends these on `_x.ai/session/update`, which Desktop must forward like `session/update`) |
| `current_mode_update` | Plan-mode banner when `currentModeId === "plan"` |
| `/plan` slash | Advertised in composer menu; sent to agent as normal prompt text |

### Terminal process sandbox (default on)

Path gates alone do **not** stop a shell started *inside* the project from opening host paths (`python -c "open('/etc/passwd')"`, `cat ~/.ssh/id_rsa`, `docker system prune`). Desktop therefore wraps ACP **tool terminals** in an OS filesystem jail when **Sandbox terminal** is on (default).

| Field | Default | Meaning |
|-------|---------|---------|
| `sandboxTerminal` | `true` | Jail ACP `terminal/*` spawns (independent of `allowOutsideProject`) |

Implementation: `electron/terminal-sandbox.mjs`, hooked in `AcpTerminalManager` `spawnOnce` (`electron/acp-terminals.mjs`).

| Platform | Backend | Notes |
|----------|---------|--------|
| macOS | `sandbox-exec` (Seatbelt) | `(allow default)` then **deny `$HOME` except project** + deny docker sockets; network allowed |
| Linux | `bwrap` (bubblewrap); Docker fallback | No host `$HOME` bind; **no docker.sock** |
| Windows | WSL + `bwrap` if present; else **host shell** (`win-host`); Docker **opt-in only** (`GROK_DESKTOP_ALLOW_DOCKER_SANDBOX=1`) | Docker/WSL bind-mounts often hang on Windows volumes — default avoids them |

Policy highlights:

- **Fail closed** — if sandbox is on and no backend is available, `terminal/create` errors (does not silently spawn on the bare host).
- **Network allowed** — `npm install` / `git fetch` still work.
- **Home jail** — tool shells cannot read/write the rest of `$HOME` (`.ssh`, sibling repos, Docker config). **`GROK_HOME` (`~/.grok`) is always bound** so skills, agents, personas, and sessions work with sandbox on. Other global host paths still need sandbox off or “Allow outside project”.
- **Does not sandbox** the `grok agent stdio` process, MCP servers under `~/.grok`, or Electron itself.
- UI: Settings toggle (confirm when turning **off**); topbar chips for **Host shell** / **Outside project** / **Auto-approve**.
- **Docker image must include git** — default `buildpack-deps:noble-scm` (not plain `ubuntu:24.04`). If the chosen image has no `git`, Desktop builds a local `grok-desktop-sandbox:2` once. Warm runs **async at app start / sandbox enable** — never pull/build on the `terminal/create` hot path (fail fast with “preparing… retry” until ready). Only **git-verified** images are cached.
- **Windows host shells** prefer **Git for Windows bash** over `System32\bash.exe` (WSL launcher); PATH enrichment shares the same install roots. Tool env sets `GIT_EDITOR=true` / `GIT_TERMINAL_PROMPT=0` / `GIT_SSH_COMMAND=ssh -o BatchMode=yes…` so commits never hang on an editor or credential TTY (ACP stdin is not interactive). Docker runs **without** `-i` so tools do not stick on “pending” after exit.

Env overrides: `GROK_DESKTOP_SANDBOX_IMAGE` (Docker image, default `buildpack-deps:noble-scm`), `GROK_DESKTOP_WSL_DISTRO` (preferred WSL distro).

---

## What “done” looks like for packaging work

- [ ] CI matrix builds Win / mac / Linux installers
- [ ] Tag `vX.Y.Z` matches `package.json` version (CI enforces)
- [ ] Release assets use `GrokDesktop-…` names (no spaces)
- [ ] README team install still points at Releases with correct name patterns
- [ ] Team installers: Setup.exe + two DMGs + Linux AppImage; auto-update assets (latest*.yml, mac zip) also present
- [ ] Help → Check for updates uses electron-updater (not only a browser link)
