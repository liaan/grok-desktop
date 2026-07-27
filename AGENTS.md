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
| `npm run dist:win` / `dist:mac` / `dist:linux` | Platform-specific |

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
   **Only** these should appear (plus GitHub’s automatic Source code zip/tar):
   - `GrokDesktop-*-Windows-Setup.exe`
   - `GrokDesktop-*-Mac-AppleSilicon.dmg`
   - `GrokDesktop-*-Mac-Intel.dmg`
   No blockmaps, yml, AppImage, portable, or updater zips. CI renames/strips noise on purpose.
6. Point the team at **Releases → latest**.

### Releases stay simple

- Ship **installers only**. Auto-update metadata (blockmap / latest.yml / mac zip) is intentionally **not** published — it confuses non-dev users. Manual download of new releases is fine for the team.
- `electron/auto-update.mjs` may still run in packaged apps; without `latest*.yml` on the Release it quietly no-ops (safe).

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

### Client capabilities

| Capability | Status | Notes |
|------------|--------|--------|
| `fs.readTextFile` / `fs.writeTextFile` | Implemented | `electron/acp-client.mjs` |
| `terminal` | Implemented | `electron/acp-terminals.mjs` — create / output / wait_for_exit / kill / release |
| Permissions | Implemented | UI + optional always-approve |
| Slash commands | Implemented | Composer `/` menu — ACP `available_commands_update` + skills from `grok inspect` + desktop `/new` `/clear` `/always-approve` |

Terminals spawn in the project `cwd` (or the path the agent passes). Output is buffered (default 1 MiB, truncated from the start). Dispose / cwd change releases all terminals.

**Shell packaging:** Agents often send `command: "/bin/bash -lc '…'"` as one string. The client **must** unwrap that into `spawn("/bin/bash", ["-lc", script])` — never spawn the multi-word string as an executable (ENOENT). PATH is enriched via `buildGrokEnv` (macOS Dock launches have a thin PATH). **Electron main does not hot-reload** — quit the app fully after changing `acp-terminals.mjs`.

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
- External links via `shell.openExternal`.
- Auth via Grok CLI flows; no parallel token store unless product requires it.
- MIT GUI; do not vendor agent source here.

---

## What “done” looks like for packaging work

- [ ] CI matrix builds Win / mac / Linux installers
- [ ] Tag `vX.Y.Z` matches `package.json` version (CI enforces)
- [ ] Release assets use `GrokDesktop-…` names (no spaces)
- [ ] README team install still points at Releases with correct name patterns
- [ ] Release assets are only Setup.exe + two DMGs (no blockmap/yml/AppImage noise)
