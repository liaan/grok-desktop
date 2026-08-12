/**
 * ACP fs/read_text_file content shaping: binary sniff + honest non-text replies.
 *
 * ACP only has a text read. Images/binaries get a short metadata message —
 * we do not smuggle multi‑MB base64 through a text API (that is not vision).
 * Path expansion lives in path-safety.mjs.
 */
import fs from "node:fs";
import path from "node:path";

/**
 * @param {Buffer} buf
 * @returns {string | null} mime type if known image magic
 */
export function sniffImageMime(buf) {
  if (!buf || buf.length < 4) return null;
  if (
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47
  ) {
    return "image/png";
  }
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    buf.length >= 6 &&
    buf[0] === 0x47 &&
    buf[1] === 0x49 &&
    buf[2] === 0x46
  ) {
    return "image/gif";
  }
  if (
    buf.length >= 12 &&
    buf[0] === 0x52 &&
    buf[1] === 0x49 &&
    buf[2] === 0x46 &&
    buf[3] === 0x46 &&
    buf[8] === 0x57 &&
    buf[9] === 0x45 &&
    buf[10] === 0x42 &&
    buf[11] === 0x50
  ) {
    return "image/webp";
  }
  if (buf[0] === 0x42 && buf[1] === 0x4d) return "image/bmp";
  return null;
}

/**
 * @param {string} filePath
 * @returns {string | null}
 */
export function mimeFromExtension(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const map = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".bmp": "image/bmp",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon",
  };
  return map[ext] || null;
}

/**
 * Heuristic: NUL in the first 8KiB ⇒ binary.
 * @param {Buffer} buf
 */
export function isLikelyBinary(buf) {
  if (!buf || buf.length === 0) return false;
  const n = Math.min(buf.length, 8192);
  for (let i = 0; i < n; i++) {
    if (buf[i] === 0) return true;
  }
  return false;
}

/** Renderer file peek: never slurp more than this. */
export const PEEK_READ_CAP = 256 * 1024;

/** In-panel edit: refuse files larger than this (open them in an external editor). */
export const EDIT_READ_CAP = 1_000_000;

/** Renderer write cap — matches a generous in-panel edit. */
export const EDIT_WRITE_CAP = 2 * 1024 * 1024;

/**
 * Read a project file for the side-panel editor.
 * Does not append a truncation marker (that would be saved back).
 * @param {string} filePath Absolute path (already resolved)
 * @param {{ cap?: number }} [opts]
 * @returns {Promise<{ text: string, binary: boolean, truncated: boolean, size: number }>}
 */
export async function readFileForEdit(filePath, opts = {}) {
  const cap =
    Number.isFinite(opts.cap) && opts.cap >= 0
      ? Math.floor(opts.cap)
      : EDIT_READ_CAP;
  const st = await fs.promises.stat(filePath);
  if (!st.isFile()) {
    throw new Error("Not a file");
  }
  const toRead = Math.min(st.size, cap);
  const fh = await fs.promises.open(filePath, "r");
  try {
    const buf = Buffer.alloc(toRead);
    const { bytesRead } = await fh.read(buf, 0, toRead, 0);
    const slice = buf.subarray(0, bytesRead);
    if (isLikelyBinary(slice)) {
      return { text: "", binary: true, truncated: false, size: st.size };
    }
    return {
      text: slice.toString("utf8"),
      binary: false,
      truncated: st.size > cap,
      size: st.size,
    };
  } finally {
    await fh.close();
  }
}

/**
 * Write UTF-8 text from the side-panel editor. Project gate lives in the IPC
 * handler — this only refuses binary / oversized payloads.
 * @param {string} filePath Absolute path (already resolved)
 * @param {string} content
 */
export async function writeFileForEdit(filePath, content) {
  const text = content == null ? "" : String(content);
  if (text.includes("\u0000")) {
    throw new Error("Refusing to write binary content");
  }
  const bytes = Buffer.byteLength(text, "utf8");
  if (bytes > EDIT_WRITE_CAP) {
    throw new Error("File too large to save here — open it in an editor");
  }
  const st = await fs.promises.stat(filePath);
  if (!st.isFile()) {
    throw new Error("Not a file");
  }
  await fs.promises.writeFile(filePath, text, "utf8");
}

/**
 * Project-scoped peek for the side panel. Stats first, reads at most `cap`
 * bytes, and refuses binaries after a prefix sniff (does not load the rest).
 * @param {string} filePath Absolute path (already resolved)
 * @param {{ cap?: number }} [opts]
 * @returns {Promise<string>}
 */
export async function readFileForPeek(filePath, opts = {}) {
  const cap = Number.isFinite(opts.cap) && opts.cap >= 0
    ? Math.floor(opts.cap)
    : PEEK_READ_CAP;
  const st = await fs.promises.stat(filePath);
  if (!st.isFile()) {
    throw new Error("Not a file");
  }
  const toRead = Math.min(st.size, cap);
  const fh = await fs.promises.open(filePath, "r");
  try {
    const buf = Buffer.alloc(toRead);
    const { bytesRead } = await fh.read(buf, 0, toRead, 0);
    const slice = buf.subarray(0, bytesRead);
    if (isLikelyBinary(slice)) {
      throw new Error("Binary file");
    }
    let text = slice.toString("utf8");
    if (st.size > cap) text += "\n… (truncated)";
    return text;
  } finally {
    await fh.close();
  }
}

/**
 * Build the ACP fs/read_text_file `content` string for a file on disk.
 *
 * @param {string} filePath Absolute path (already resolved)
 * @param {{ line?: number, limit?: number }} [opts]
 * @returns {Promise<{ content: string, kind: 'text' | 'image' | 'binary', mime?: string }>}
 */
export async function readFileForAcp(filePath, opts = {}) {
  const buf = await fs.promises.readFile(filePath);
  const magicMime = sniffImageMime(buf);
  const extMime = mimeFromExtension(filePath);

  // SVG is text
  if (extMime === "image/svg+xml" && !isLikelyBinary(buf)) {
    return applyLineLimit(buf.toString("utf8"), opts, "text", extMime);
  }

  if (
    magicMime ||
    (extMime &&
      extMime.startsWith("image/") &&
      extMime !== "image/svg+xml" &&
      isLikelyBinary(buf))
  ) {
    const imageMime = magicMime || extMime || "application/octet-stream";
    // Metadata only — vision belongs on attach / agent image embed, not text smuggling
    return {
      kind: "image",
      mime: imageMime,
      content:
        `[binary image ${imageMime}, ${buf.length} bytes — not UTF-8 text]\n` +
        `path: ${filePath}\n` +
        `Attach the image in the composer for vision, or open it in a viewer. ` +
        `ACP fs/read_text_file cannot return pixels.`,
    };
  }

  if (isLikelyBinary(buf)) {
    const label = extMime || "application/octet-stream";
    return {
      kind: "binary",
      mime: label,
      content:
        `[binary file ${label}, ${buf.length} bytes — not UTF-8 text]\n` +
        `path: ${filePath}\n` +
        `Use a shell tool (file, xxd, …) for binary inspection.`,
    };
  }

  // Invalid UTF-8 without NULs: Buffer.toString replaces bad bytes with U+FFFD
  // and may change byte length when re-encoded.
  const text = buf.toString("utf8");
  const reencodedLen = Buffer.byteLength(text, "utf8");
  const replacementCount = (text.match(/\uFFFD/g) || []).length;
  if (reencodedLen !== buf.length || replacementCount > 0) {
    return {
      kind: "binary",
      content:
        `[binary file, ${buf.length} bytes — not valid UTF-8 text]\n` +
        `path: ${filePath}\n`,
    };
  }
  return applyLineLimit(text, opts, "text", undefined);
}

/**
 * @param {string} text
 * @param {{ line?: number, limit?: number }} opts
 * @param {'text' | 'image' | 'binary'} kind
 * @param {string | undefined} mime
 */
function applyLineLimit(text, opts, kind, mime) {
  const line = Number(opts?.line);
  const limit = Number(opts?.limit);
  if (Number.isFinite(line) && line >= 1) {
    const lines = text.split("\n");
    const start = Math.max(0, Math.floor(line) - 1);
    const take =
      Number.isFinite(limit) && limit >= 0
        ? Math.floor(limit)
        : lines.length - start;
    text = lines.slice(start, start + take).join("\n");
  }
  return { content: text, kind, mime };
}
