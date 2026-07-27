/**
 * electron-builder afterPack hook.
 * On Apple Silicon CI, binaries often get a partial linker ad-hoc signature that
 * macOS reports as "damaged". Re-sign the whole .app deeply with a clean ad-hoc
 * signature so xattr + open works for the team (until Developer ID notarization).
 */
const { execSync } = require("node:child_process");
const path = require("node:path");
const fs = require("node:fs");

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== "darwin") return;

  const appName = context.packager.appInfo.productFilename;
  const appPath = path.join(context.appOutDir, `${appName}.app`);
  if (!fs.existsSync(appPath)) {
    console.warn("[afterPack] app not found:", appPath);
    return;
  }

  console.log("[afterPack] ad-hoc deep codesign:", appPath);
  // Remove any broken partial signatures first, then deep ad-hoc sign
  try {
    execSync(`xattr -cr ${JSON.stringify(appPath)}`, { stdio: "inherit" });
  } catch {
    /* optional */
  }
  execSync(
    `codesign --force --deep --sign - ${JSON.stringify(appPath)}`,
    { stdio: "inherit" },
  );
  execSync(
    `codesign --verify --deep --strict ${JSON.stringify(appPath)}`,
    { stdio: "inherit" },
  );
  console.log("[afterPack] codesign ok");
};
