# Screenshots

Product shots for the GitHub README (theme-matched HTML mocks of the real UI).

| File | Use |
|------|-----|
| `main.png` | Hero — full app (sidebar, chat, tools, files, Preview button) |
| `welcome.png` | Sign-in / welcome |
| `approvals.png` | Tool permission card |
| `preview.png` | Detachable Preview window (address bar + guest page) |
| `worktree.png` | Same-checkout prompt — switch, reuse, or create a Grok worktree |
| `zh-dark.png` | Night theme, Simplified Chinese main window (real app capture, not a mock) |

## Regenerate

Requires Brave, Chrome, or Edge (macOS or Windows). `zh-dark.png` is a real window capture and is not produced by this script.

```bash
node docs/screenshots/render.mjs
```

Edit the `mock-*.html` sources if the UI changes, then re-render.
