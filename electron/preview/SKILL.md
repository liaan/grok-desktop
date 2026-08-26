---
name: desktop-preview
description: >
  Open Grok Desktop's in-app Preview window so the user can see a site.
  Use whenever the user is in Grok Desktop and asks to preview, show, open,
  visually check, or test a URL, localhost app, or frontend ticket.
  Prefer this over cloakbrowser, playwright, puppeteer, docker browsers,
  web_fetch, and curl.
---

# Grok Desktop Preview

You are running inside **Grok Desktop**. The user can see a detachable Preview window (they can drag it to another screen).

## Do this

1. Call `desktop-preview__preview_open` with the URL.
2. Call `desktop-preview__preview_snapshot`. Controls look like `[e3] input/password "Password"`.
3. Drive the UI in the Preview window (never PowerShell / curl / CSRF POST):
   - `desktop-preview__preview_fill` `{ "ref": "e3", "value": "bad-password" }`
   - `desktop-preview__preview_click` `{ "ref": "e7" }` or `{ "name": "Sign in" }`
   - `desktop-preview__preview_fill_form` `{ "fields": [{ "ref": "e2", "value": "x" }, { "ref": "e3", "value": "y" }] }`
   - `desktop-preview__preview_interact` `{ "action": "fill", "ref": "e3", "value": "x" }`
   - `desktop-preview__preview_press` `{ "key": "Enter" }`
4. Snapshot again to read the result. Use `preview_screenshot` only for layout/CSS.
5. For loading / lazy-load / missing assets / 404s: `desktop-preview__preview_network`. Pass `{ "afterLoad": true }` to see only requests that started after window load (the lazy ones). Filter with `{ "filter": "img" }` (or js / css / xhr).

Grok namespaces MCP tools as `server__tool`. Search for `desktop-preview` if a tool is not listed.

## Do not do this

- Do **not** use PowerShell, `Invoke-WebRequest`, curl, or steal a Yii CSRF token to POST a login. Type into Preview instead.
- Do **not** use cloakbrowser, Docker Chromium, Playwright, Puppeteer, or `web_fetch` to “open a preview” in Grok Desktop.
- Do **not** dump full-page screenshots every step.
- Do **not** only describe the page in chat without opening Preview when they asked to *see* it.

If `preview_open` is missing, tell them to **Restart agent** (Settings) so Desktop can attach the Preview MCP.
