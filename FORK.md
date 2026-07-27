# Fork / product relationship

## What we forked conceptually

| Layer | Source | Location |
|-------|--------|----------|
| Agent backbone (models, tools, skills, MCP, auth, sandbox) | [xai-org/grok-build](https://github.com/xai-org/grok-build) | Installed `grok` binary + optional local clone `../grok-build` |
| Desktop GUI | **This repo** | Electron + React ACP client |

Upstream Grok Build ships a **TUI** (`xai-grok-pager`). Official docs already describe embedding via:

```bash
grok agent stdio
```

and mention clients such as VS Code and **grok-desktop**. This project is an open desktop shell that takes that same path.

## Local backbone clone

```powershell
git clone https://github.com/xai-org/grok-build.git G:\Development\grok-build
```

Use it for:

- reading ACP / shell implementation
- rebuilding `grok` from source (requires Rust + DotSlash)
- understanding tool / permission behaviour

You do **not** need to rebuild Grok to run Grok Desktop if the official binary is installed.

## Why not patch the monorepo UI?

1. Upstream states external contributions are not accepted.
2. Replacing ratatui with a full desktop toolkit inside that monorepo is a multi-month product effort.
3. ACP already is the supported boundary for alternate UIs.

So the durable approach is:

**Fork the product experience (GUI) · reuse the backbone process.**

## License note

This desktop shell is **MIT**. Upstream Grok Build is **Apache-2.0**. Because this repository does not copy Grok Build source into the tree, the shell can use MIT; the installed `grok` binary stays under its own license.
