# Grok Desktop

**Codex-style desktop GUI** on top of the **Grok Build agent backbone**.

This is not a reimplementation of the Grok model or tools. It is a full graphical shell that talks to your installed Grok CLI over the **Agent Client Protocol (ACP)**:

```text
┌──────────────────────────┐
│  Grok Desktop (Electron) │  ← chat, diffs/tools, approvals, projects
└────────────┬─────────────┘
             │ JSON-RPC / stdio (ACP)
┌────────────▼─────────────┐
│   grok agent stdio       │  ← same backbone as TUI / IDE embeds
│   models · skills · MCP  │
│   auth · sandbox · tools │
└──────────────────────────┘
```

## Why this exists

Users who want a **GUI** (like OpenAI Codex’s desktop app) while keeping:

- Grok models (`grok-build`, `grok-4.5`, …)
- `~/.grok` config, skills, plugins, MCP servers
- Existing login / API key auth

…can use this app instead of the terminal TUI.

## Requirements

1. **Node.js 20+**
2. **Grok Build CLI** installed (`grok` on PATH or `~/.grok/bin/grok[.exe]`)
3. Authenticated Grok session (`grok login` or `XAI_API_KEY`)

Optional: set `GROK_BINARY` to a custom path.

## Backbone source (fork reference)

The agent runtime lives in the open-source tree:

- https://github.com/xai-org/grok-build  
- Local clone (if present): `../grok-build`

This desktop repo is the **GUI product layer**. Upstream Grok does not accept external contributions to their monorepo; treat this as your fork/product shell.

## Quick start

```powershell
cd G:\Development\grok-desktop
npm install
npm run dev
```

- Vite serves the UI at `http://127.0.0.1:5173`
- Electron loads it and spawns `grok agent stdio`

Production-ish:

```powershell
npm run build
npm start
```

## Features (v0.1)

| Area | Status |
|------|--------|
| Open project / recent projects | Done |
| ACP session (`initialize`, `session/new`, `session/prompt`) | Done |
| Streaming message / thought / plan / tool cards | Done |
| Tool permission modal (Codex-like approvals) | Done |
| Always-approve toggle | Done |
| Cancel in-flight turn | Done |
| File tree peek | Basic |
| Diff review pane | Planned |
| Multi-session tabs | Planned |
| Settings UI for model / MCP | Planned |
| Native installer (NSIS / dmg) | Planned |

## Architecture

```
grok-desktop/
  electron/
    main.mjs          # window + IPC
    preload.cjs       # safe bridge
    acp-client.mjs    # spawns grok agent stdio, JSON-RPC
  src/
    App.tsx           # Codex-like layout
    components/       # timeline, side panel
    styles/
```

### ACP methods used

Client → Agent:

- `initialize`
- `session/new`
- `session/prompt`
- `session/cancel`

Agent → Client:

- `session/update` (message chunks, thoughts, tools, plan)
- `session/request_permission`
- `fs/read_text_file` / `fs/write_text_file` (optional client FS)

## Relation to Grok TUI

| | TUI (`grok`) | Grok Desktop |
|--|--------------|--------------|
| UI | Terminal (ratatui) | Electron GUI |
| Agent | same binary | same binary via ACP |
| Skills / MCP | `~/.grok` | `~/.grok` (inherited) |
| Models | Grok | Grok |

## License

Apache-2.0 for this desktop shell. Grok Build itself remains under its upstream license (Apache-2.0 for first-party code in `xai-org/grok-build`).
