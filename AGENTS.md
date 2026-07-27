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

See also: `FORK.md`, `README.md`.

---

## Ownership model

The human owner (**liaan**) wants agents to **run the show**: package, release, keep docs accurate, ship installers for the team. Do not leave half-finished packaging/docs work for him.

| Who | Does what |
|-----|-----------|
| **Team users** | Download installer from GitHub Releases. No npm. |
| **Agents / maintainers** | Code, `npm run dist` / CI, bump version, tag, push, verify Release assets. |
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
    App.tsx
    components/
    lib/
    styles/
  dist/               # Vite build output (gitignored)
  release/            # electron-builder output (gitignored)
  .github/workflows/
    release.yml       # Win/mac/Linux installers → GitHub Releases
```

- **Main** loads UI from Vite in dev (`http://127.0.0.1:5173`); when packaged (`app.isPackaged`) loads `dist/index.html`.
- Vite `base` is `./` so `file://` packaging works.

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

Runtime dependency (all environments): **`grok` CLI** on PATH or known install paths (`~/.grok/bin/…`), override with `GROK_BINARY` / `GROK_HOME` / `XAI_API_KEY`.

---

## Shipping installers (agent checklist)

Preferred path is **CI**, not local cross-builds.

### Cut a release

1. Ensure `package.json` `version` matches the tag you will push (e.g. `0.1.0` → tag `v0.1.0`).
2. Commit all release-related changes on `master`.
3. Push `master`.
4. Create and push an annotated or lightweight tag:
   ```bash
   git tag v0.1.0
   git push origin master
   git push origin v0.1.0
   ```
5. Workflow **Build & Release** (`.github/workflows/release.yml`) builds:
   - Windows: NSIS setup + portable `.exe`
   - macOS: `.dmg` (x64 + arm64)
   - Linux: `.AppImage` (x64)
6. On tag `v*`, the workflow publishes a **GitHub Release** with those assets.
7. Verify: https://github.com/liaan/grok-desktop/releases  
8. Point the team at **Releases → latest**. They need Grok CLI separately.

### Manual / test build without a release

- GitHub → **Actions → Build & Release → Run workflow**  
  Artifacts upload; no Release page unless ref is a `v*` tag.

### Local packaging notes

- Build Windows installers on Windows (or CI). Do not rely on macOS cross-compile for shipping.
- Builds are **unsigned** by design for now (`CSC_IDENTITY_AUTO_DISCOVERY=false` in CI). Expect SmartScreen / Gatekeeper one-time warnings; document that for users (already in release body + README).
- Never commit `dist/`, `release/`, or `node_modules/`.

---

## Coding conventions

- **Electron main**: ESM (`.mjs`). Keep `preload` as **`.cjs`** (Electron preload constraints).
- **Renderer**: React function components + TypeScript. Prefer small focused components under `src/components/`.
- Do **not** reimplement the agent, tools, or skill runner inside this repo. Extend the GUI / ACP client only.
- Prefer reusing CLI behavior via spawn + IPC over duplicating auth or config parsing.
- Match existing style: plain JSDoc where useful in main process; TS in renderer.
- No drive-by refactors. No new deps unless needed for the task.
- Keep README user-facing install section accurate whenever packaging changes.
- Keep this `AGENTS.md` accurate when architecture or release process changes.

---

## ACP surface (do not break casually)

Client → agent: `initialize`, `session/new`, `session/prompt`, `session/cancel`  
Agent → client: `session/update`, `session/request_permission`, optional `fs/*`

`session/new` uses empty client `mcpServers`; agent still loads MCP/skills from `~/.grok`.

---

## Security / product boundaries

- `contextIsolation: true`, `nodeIntegration: false` in the BrowserWindow — keep it that way.
- External links open via `shell.openExternal`, not in-app.
- Auth is delegated to the Grok CLI flows; do not invent a parallel token store unless product requires it.
- This app is MIT; the `grok` binary has its own license — do not vendor agent source here.

---

## What “done” looks like for packaging work

- [ ] `npm run pack` (or CI matrix) succeeds for the platforms you claim
- [ ] README “Install for the team” points at GitHub Releases
- [ ] Tag `vX.Y.Z` exists, matches `package.json` version, Release has Win/mac/Linux assets
- [ ] `AGENTS.md` still describes the real release path
