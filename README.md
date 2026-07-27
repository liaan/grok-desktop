# Grok Desktop

Desktop GUI for the [Grok Build](https://github.com/xai-org/grok-build) coding agent.

## Install for the team (no npm)

**Nobody needs Node or npm to use this app.** Download from the latest
[GitHub Release](https://github.com/liaan/grok-desktop/releases/latest):

| OS | File pattern | What to do |
|----|--------------|------------|
| **Windows** | `GrokDesktop-…-win-…-Setup.exe` | Double-click installer. Or use `…-portable.exe` (no install). |
| **macOS (Apple Silicon)** | `GrokDesktop-…-mac-arm64.dmg` | Open DMG → drag **Grok Desktop** to Applications. First launch: right-click → **Open**. |
| **macOS (Intel)** | `GrokDesktop-…-mac-x64.dmg` | Same as above. |
| **Linux** | `GrokDesktop-…-linux-….AppImage` | `chmod +x GrokDesktop-*.AppImage` then run it. |

Also install the **Grok Build CLI** (`grok`) on each machine — this app is only the GUI and talks to that CLI.

Then: open **Grok Desktop** → **Sign in with browser** → **Open project…**

**Updates:** after the first install (prefer the Windows **Setup** installer, not portable), the app checks GitHub Releases in the background and offers to restart when a new version is ready. You do not need to re-download by hand each time.

> Windows SmartScreen / macOS Gatekeeper may warn once (unsigned internal build). That’s expected — **More info → Run anyway** (Windows) or right-click → **Open** (macOS).

---

This project is **not** a reimplementation of the agent, models, or tools. It is an **Electron + React** app that:

1. Signs you in with the same browser flow as the Grok CLI (`grok login`)
2. Opens a project folder
3. Spawns `grok agent stdio` and talks **Agent Client Protocol (ACP)** over JSON-RPC
4. Reuses your existing `~/.grok` setup — skills, MCP servers, plugins, models, and auth

```text
┌────────────────────────────┐
│  Grok Desktop (this repo)  │  chat · tools · approvals · projects
└─────────────┬──────────────┘
              │ ACP / stdio
┌─────────────▼──────────────┐
│  grok agent (installed CLI)│  models · skills · MCP · auth · tools
└────────────────────────────┘
```

Works on **Windows, macOS, and Linux** (Electron). You need the Grok Build CLI installed on the machine; day-to-day login can be done entirely in the app.

## Features

| Area | Status |
|------|--------|
| In-app browser sign-in / sign-out | Done |
| Optional API key for this session | Done |
| Skills & MCP from `~/.grok` (same as CLI) | Done |
| Open project + recent folders | Done |
| Streaming messages, thoughts, plans, tool cards | Done |
| Tool permission approvals + always-approve | Done |
| Cancel in-flight turn | Done |
| Simple file list peek | Basic |
| Diff review pane | Planned |
| Resume CLI sessions with history | Done (same `~/.grok/sessions`) |
| Multi-session tabs | Basic (sidebar chat list) |
| Settings UI (model / MCP) | Planned |
| Native installers (Windows / macOS / Linux) | Done — [Releases](https://github.com/liaan/grok-desktop/releases) |

## Requirements

1. **Grok Build CLI** installed (`grok` on `PATH`, or `~/.grok/bin/grok` / `grok.exe`)
2. **Sign-in** from the app (browser OAuth), or an API key / `XAI_API_KEY`
3. **Node.js 20+** — only if building/running from source (`npm run dev`)

Install the CLI with the official installer for your OS (see [Grok Build](https://github.com/xai-org/grok-build) / project docs), then start this app and use **Sign in with browser**.

Skills, MCP servers, and plugins are still configured under `~/.grok` (CLI / config files). The desktop loads them automatically; it does not replace that config yet.

Optional environment variables:

| Variable | Purpose |
|----------|---------|
| `GROK_BINARY` | Full path to the `grok` executable |
| `GROK_HOME` | Override config/auth home (default `~/.grok`) |
| `XAI_API_KEY` | API key fallback when no session token is present |

## Quick start (developers)

```bash
git clone https://github.com/liaan/grok-desktop.git
cd grok-desktop
npm install
npm run dev
```

- Vite serves the UI at `http://127.0.0.1:5173`
- Electron opens the window and uses your local `grok` binary

Production-style run from source:

```bash
npm run build
npm start
```

Local installer smoke-test (current OS only):

```bash
npm run pack    # unpacked app under release/
npm run dist    # installer for this machine
```

### First launch

1. If Grok Build is missing, use **Open install guide** in the app.
2. Click **Sign in with browser** (or device code / API key).
3. **Open project…** and chat — the agent uses the same skills and MCP as the CLI.

## Maintainers / agents

How to cut a release, CI, packaging invariants: **`AGENTS.md`** (canonical). Do not duplicate that process here.

## Architecture

```text
grok-desktop/
  electron/
    main.mjs           # window, IPC, auth bridge
    preload.cjs        # renderer ↔ main bridge
    acp-client.mjs     # grok agent stdio + JSON-RPC
    auth.mjs           # login / logout / status (via CLI)
    backbone.mjs       # grok inspect summary (skills, MCP)
    grok-home.mjs      # binary + env discovery
  src/
    App.tsx            # main layout
    components/        # chat timeline, side panel, auth UI
    lib/               # session update helpers
    styles/
```

### ACP (client ↔ agent)

**Client → agent:** `initialize`, `session/new`, `session/prompt`, `session/cancel`

**Agent → client:** `session/update`, `session/request_permission`, optional `fs/*`

`session/new` is called with an empty client `mcpServers` list (same pattern as other embeds). The agent still merges MCP and skills from `~/.grok` and plugins.

## Desktop vs terminal CLI

| | Grok CLI (TUI) | Grok Desktop |
|--|----------------|--------------|
| UI | Terminal | Electron GUI |
| Agent | `grok` binary | Same binary via ACP |
| Auth | `grok login` / env | In-app (same underlying login) |
| Skills / MCP | `~/.grok` | Same `~/.grok` |
| Models | From Grok install | Same |

## Author

**Karman de Lange**

## License

**MIT** — see [`LICENSE`](./LICENSE).

This repository is an independent GUI client. It does **not** ship Grok Build source code. The installed `grok` CLI remains under its own upstream license; using that binary is separate from this MIT-licensed UI.
