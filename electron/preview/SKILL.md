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

## Read text. The user sends pixels.

You **drive** the window (open, click, fill). You **read** a text snapshot (copy, alerts, HTML controls). That is cheap.

You do **not** capture screenshots. For layout/CSS the **user** frames the issue (Size dropdown, zoom, scroll) and presses **Send screenshot**. That JPEG arrives as a normal user message with an image — then you can talk about spacing, overlap, and color.

1. Call `desktop-preview__preview_open` with the URL. The result **already includes** a text snapshot — read it.
2. Drive the UI in the Preview window (never PowerShell / curl / CSRF POST):
   - `desktop-preview__preview_fill` `{ "ref": "e3", "value": "bad-password" }`
   - `desktop-preview__preview_click` `{ "ref": "e7" }` or `{ "name": "Sign in" }`
   - `desktop-preview__preview_fill_form` `{ "fields": [{ "ref": "e2", "value": "x" }, { "ref": "e3", "value": "y" }] }`
   - `desktop-preview__preview_press` `{ "key": "Enter" }`
3. Click / fill / press / fill_form **already return a fresh text snapshot**. Read that to verify copy, errors, and whether a click worked.
4. Call `desktop-preview__preview_snapshot` if you need another text read without interacting.
5. If you need to *see* layout/CSS, ask the user to **Send screenshot** from Preview (after they pick Size / zoom). Do not call `preview_screenshot`.
6. For loading / lazy-load / missing assets / 404s: `desktop-preview__preview_network`. Pass `{ "afterLoad": true }` for post-load requests.

Grok namespaces MCP tools as `server__tool`. Search for `desktop-preview` if a tool is not listed.

## Do not do this

- Do **not** use PowerShell, `Invoke-WebRequest`, curl, or steal a Yii CSRF token to POST a login. Type into Preview instead.
- Do **not** use cloakbrowser, Docker Chromium, Playwright, Puppeteer, or `web_fetch` to “open a preview” in Grok Desktop.
- Do **not** call `preview_screenshot`. Pixels come from the user’s **Send screenshot** button.
- Do **not** only describe the page in chat without opening Preview when they asked to *see* it.

If `preview_open` is missing, tell them to **Restart agent** (Settings) so Desktop can attach the Preview MCP.

<!-- managed-by: grok-desktop-preview -->
