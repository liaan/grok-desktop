#!/usr/bin/env node
/**
 * Render HTML mockups to PNG via Brave/Chrome headless.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const local = process.env.LOCALAPPDATA || "";
const pf = process.env["ProgramFiles"] || "C:\\Program Files";
const pf86 = process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)";
const candidates = [
  "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  path.join(pf, "Google", "Chrome", "Application", "chrome.exe"),
  path.join(pf86, "Google", "Chrome", "Application", "chrome.exe"),
  path.join(pf, "BraveSoftware", "Brave-Browser", "Application", "brave.exe"),
  path.join(pf, "Microsoft", "Edge", "Application", "msedge.exe"),
  path.join(pf86, "Microsoft", "Edge", "Application", "msedge.exe"),
  local
    ? path.join(local, "Google", "Chrome", "Application", "chrome.exe")
    : "",
].filter(Boolean);
const browser = candidates.find((p) => {
  try {
    return fs.existsSync(p);
  } catch {
    return false;
  }
});

if (!browser) {
  console.error("No Brave/Chrome found for headless screenshots");
  process.exit(1);
}

const shots = [
  { html: "mock-main.html", out: "main.png", w: 1400, h: 900 },
  { html: "mock-approvals.html", out: "approvals.png", w: 1200, h: 800 },
  { html: "mock-welcome.html", out: "welcome.png", w: 1100, h: 860 },
  { html: "mock-preview.html", out: "preview.png", w: 1240, h: 840 },
  { html: "mock-worktree.html", out: "worktree.png", w: 1240, h: 840 },
];

for (const s of shots) {
  const htmlPath = path.join(__dirname, s.html);
  const outPath = path.join(__dirname, s.out);
  const url = pathToFileURL(htmlPath).href;
  // Chrome headless --screenshot writes to cwd
  const r = spawnSync(
    browser,
    [
      "--headless=new",
      "--disable-gpu",
      "--hide-scrollbars",
      "--force-device-scale-factor=2",
      `--window-size=${s.w},${s.h}`,
      `--screenshot=${outPath}`,
      url,
    ],
    { encoding: "utf8", timeout: 60000 },
  );
  if (r.status !== 0) {
    console.error(s.html, r.stderr || r.stdout || r.error);
    process.exit(r.status || 1);
  }
  const st = fs.statSync(outPath);
  console.log("wrote", s.out, st.size, "bytes");
}
