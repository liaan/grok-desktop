/**
 * Shell argv helpers for ACP terminal spawn normalization.
 *
 * Goal: stop quote bugs at the source.
 *
 * Agent packing is inconsistent:
 *   - command = "/bin/bash -lc 'git status'"   (one string)
 *   - command = "git", args = ["status"]      (real argv)
 *   - command = "echo 'hello world'"          (freeform line)
 *
 * Rules:
 *   1. Prefer real argv (spawn without a shell) when command is a single token.
 *   2. When the whole line is a shell invocation, *tokenize* it (do not regex-strip
 *      outer quotes) so the -c script body is the literal script string.
 *   3. Otherwise run the *original* freeform string via bash -lc as one argv
 *      element — never re-join argv with spaces, never spawn a multi-word path.
 *   4. If we must re-pack argv into a shell line, shell-escape each word.
 */

/**
 * Escape a string so it is safe as a single shell word (POSIX single-quote form).
 * @param {string} s
 * @returns {string}
 */
export function shellEscape(s) {
  const str = String(s);
  // Empty → two single quotes (one empty word)
  if (str.length === 0) return "''";
  // 'foo'bar' → 'foo'\''bar'
  return `'${str.replace(/'/g, `'\\''`)}'`;
}

/**
 * True if a word needs quoting when embedded in a shell line.
 * @param {string} s
 */
export function needsShellEscape(s) {
  const str = String(s);
  if (str.length === 0) return true;
  // Alphanumeric, @%+=:,./_- and common path chars without whitespace/meta
  return /[^A-Za-z0-9_@%+=:,.\/-]/.test(str);
}

/**
 * Join argv into a shell-safe command line (each arg escaped as needed).
 * @param {string[]} argv
 * @returns {string}
 */
export function shellJoin(argv) {
  return argv
    .map((a) => (needsShellEscape(a) ? shellEscape(a) : String(a)))
    .join(" ");
}

/**
 * POSIX-ish shell word split (no expansion, no globbing).
 * Handles single quotes, double quotes, and backslash outside single quotes.
 *
 * Returns null if quotes are unclosed (caller should fall back to freeform).
 *
 * @param {string} input
 * @returns {string[] | null}
 */
export function shellSplit(input) {
  const s = String(input ?? "");
  /** @type {string[]} */
  const words = [];
  let cur = "";
  let i = 0;
  let inSingle = false;
  let inDouble = false;
  /** Whether current word consumed any quoted empty segment ("" or '') */
  let sawQuote = false;

  const flush = () => {
    if (cur.length > 0 || sawQuote) {
      words.push(cur);
    }
    cur = "";
    sawQuote = false;
  };

  while (i < s.length) {
    const c = s[i];

    if (inSingle) {
      if (c === "'") {
        inSingle = false;
        sawQuote = true;
      } else {
        cur += c;
      }
      i++;
      continue;
    }

    if (inDouble) {
      if (c === '"') {
        inDouble = false;
        sawQuote = true;
        i++;
        continue;
      }
      if (c === "\\" && i + 1 < s.length) {
        const n = s[i + 1];
        // Inside double quotes, \ only escapes $ ` " \ and newline
        if (n === "$" || n === "`" || n === '"' || n === "\\" || n === "\n") {
          cur += n;
          i += 2;
          continue;
        }
      }
      cur += c;
      i++;
      continue;
    }

    // Unquoted
    if (c === "'") {
      inSingle = true;
      i++;
      continue;
    }
    if (c === '"') {
      inDouble = true;
      i++;
      continue;
    }
    if (c === "\\" && i + 1 < s.length) {
      cur += s[i + 1];
      i += 2;
      continue;
    }
    if (c === " " || c === "\t" || c === "\n" || c === "\r") {
      flush();
      while (i < s.length && /[ \t\n\r]/.test(s[i])) i++;
      continue;
    }

    cur += c;
    i++;
  }

  if (inSingle || inDouble) {
    // Unclosed quote — do not pretend we understood the line
    return null;
  }
  flush();
  return words;
}

/**
 * Basename of a shell executable word (strip path + .exe).
 * @param {string} word
 */
export function shellBaseName(word) {
  const w = String(word).replace(/\\/g, "/");
  const base = w.includes("/") ? w.slice(w.lastIndexOf("/") + 1) : w;
  return base.toLowerCase().replace(/\.exe$/i, "");
}

/**
 * True when a string is a shell *script body*, not a single executable path.
 * Multi-line / heredoc / very large payloads must never be used as argv0 or as
 * a bare `bash <this>` filename (ENAMETOOLONG / "File name too long").
 *
 * @param {string} s
 */
export function looksLikeScriptBody(s) {
  const t = String(s ?? "");
  if (!t) return false;
  if (/[\r\n]/.test(t)) return true;
  // Heredoc even if somehow flattened with spaces
  if (/<<-?\s*['"]?\w+['"]?/.test(t)) return true;
  // Huge one-liners exceed practical path / safe -c limits
  if (t.length > 4000) return true;
  return false;
}

/**
 * If argv is a clean `shell [flags…] -c script` form, extract it.
 * Returns null when packing is ambiguous (trailing words, no -c, etc.).
 *
 * @param {string[]} words
 * @returns {{ shellName: string, flag: string, script: string } | null}
 */
export function extractShellCInvocation(words) {
  if (!Array.isArray(words) || words.length < 2) return null;

  let i = 0;
  // Optional: env bash -lc '…'
  const firstBase = shellBaseName(words[0]);
  if (firstBase === "env") {
    i = 1;
    if (i >= words.length) return null;
  }

  const shellWord = words[i];
  const shellName = shellBaseName(shellWord);
  if (!["bash", "sh", "zsh"].includes(shellName)) return null;
  i++;

  let hasC = false;
  let hasL = false;

  while (i < words.length) {
    const w = words[i];
    if (w === "--") {
      i++;
      break;
    }
    // Flag cluster: -c, -l, -lc, -e, …
    if (!w.startsWith("-") || w === "-" || w.startsWith("--")) break;
    const flags = w.slice(1);
    if (!/^[A-Za-z]+$/.test(flags)) break;
    if (flags.includes("c") || flags.includes("C")) hasC = true;
    if (flags.includes("l") || flags.includes("L")) hasL = true;
    i++;
    if (hasC) {
      // Next word is the script body (already unquoted by shellSplit)
      if (i >= words.length) return null;
      const script = words[i];
      i++;
      // Trailing words become $0/$1 for bash -c — agent almost never means this.
      // Treat as ambiguous so caller falls back to freeform bash -lc of original.
      if (i < words.length) return null;
      return {
        shellName,
        flag: hasL ? "-lc" : "-c",
        script: String(script),
      };
    }
  }
  return null;
}
