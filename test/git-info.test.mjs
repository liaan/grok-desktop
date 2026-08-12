/**
 * Porcelain parse + never-throw git helpers (fixture stdout, no real repo).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  getGitDiff,
  getGitStatus,
  parsePorcelain,
  parsePorcelainLine,
  porcelainStatusLetter,
  unquoteGitPath,
} from "../electron/git-info.mjs";

const FIXTURE = [
  " M src/foo.ts",
  "M  staged.ts",
  "MM both.ts",
  "A  added.ts",
  " D gone.ts",
  "?? scratch.txt",
  "R  old.ts -> new.ts",
  '?? "file with spaces.txt"',
  'R  "old name.ts" -> "new name.ts"',
  '?? "quote\\"d.txt"',
  "UU conflict.ts",
  "!! ignored.log",
  "",
  "not-porcelain",
].join("\n");

test("parsePorcelain: dirty list M/A/D/? plus rename and unmerged", () => {
  const files = parsePorcelain(FIXTURE);
  const byPath = Object.fromEntries(files.map((f) => [f.path, f]));

  assert.equal(files.length, 11);
  assert.ok(!byPath["ignored.log"]);
  assert.ok(!files.some((f) => f.path === "not-porcelain"));

  assert.deepEqual(byPath["src/foo.ts"], {
    path: "src/foo.ts",
    origPath: null,
    index: " ",
    worktree: "M",
    status: "M",
    untracked: false,
    staged: false,
    unstaged: true,
  });

  assert.equal(byPath["staged.ts"].status, "M");
  assert.equal(byPath["staged.ts"].staged, true);
  assert.equal(byPath["staged.ts"].unstaged, false);

  assert.equal(byPath["both.ts"].status, "M");
  assert.equal(byPath["both.ts"].staged, true);
  assert.equal(byPath["both.ts"].unstaged, true);

  assert.equal(byPath["added.ts"].status, "A");
  assert.equal(byPath["added.ts"].staged, true);

  assert.equal(byPath["gone.ts"].status, "D");
  assert.equal(byPath["gone.ts"].unstaged, true);

  assert.equal(byPath["scratch.txt"].status, "?");
  assert.equal(byPath["scratch.txt"].untracked, true);
  assert.equal(byPath["scratch.txt"].staged, false);
  assert.equal(byPath["scratch.txt"].unstaged, true);

  assert.equal(byPath["new.ts"].status, "R");
  assert.equal(byPath["new.ts"].origPath, "old.ts");
  assert.equal(byPath["new.ts"].staged, true);

  assert.equal(byPath["file with spaces.txt"].untracked, true);
  assert.equal(byPath["new name.ts"].origPath, "old name.ts");
  assert.equal(byPath['quote"d.txt'].untracked, true);

  assert.equal(byPath["conflict.ts"].status, "U");
});

test("parsePorcelain: CRLF and empty stdout", () => {
  assert.deepEqual(parsePorcelain(""), []);
  const files = parsePorcelain(" M a.ts\r\n?? b.ts\r\n");
  assert.equal(files.length, 2);
  assert.equal(files[0].path, "a.ts");
  assert.equal(files[1].path, "b.ts");
});

test("parsePorcelainLine: rejects short / malformed lines", () => {
  assert.equal(parsePorcelainLine(""), null);
  assert.equal(parsePorcelainLine("M"), null);
  assert.equal(parsePorcelainLine("MM"), null);
  assert.equal(parsePorcelainLine("MMno-space"), null);
});

test("unquoteGitPath: C-style escapes and leftover after close", () => {
  assert.deepEqual(unquoteGitPath("plain"), { value: "plain", rest: "" });
  assert.deepEqual(unquoteGitPath('"a b"'), { value: "a b", rest: "" });
  assert.deepEqual(unquoteGitPath('"a\\tb\\n"'), { value: "a\tb\n", rest: "" });
  assert.deepEqual(unquoteGitPath('"old" -> "new"'), {
    value: "old",
    rest: ' -> "new"',
  });
  assert.equal(unquoteGitPath('"\\141"').value, "a");
});

test("porcelainStatusLetter: prefer D/A over M", () => {
  assert.equal(porcelainStatusLetter("?", "?"), "?");
  assert.equal(porcelainStatusLetter("M", "D"), "D");
  assert.equal(porcelainStatusLetter("A", "M"), "A");
  assert.equal(porcelainStatusLetter("R", "M"), "R");
  assert.equal(porcelainStatusLetter(" ", "M"), "M");
});

test("getGitStatus never throws on missing cwd / non-repo", async () => {
  assert.deepEqual(await getGitStatus(""), { files: [] });
  assert.deepEqual(await getGitStatus(null), { files: [] });
  const missing = await getGitStatus(
    "/tmp/grok-desktop-definitely-not-a-git-repo",
  );
  assert.deepEqual(missing, { files: [] });
});

test("getGitDiff never throws on missing cwd / path / non-repo", async () => {
  assert.deepEqual(await getGitDiff("", "a.ts"), {
    path: "a.ts",
    staged: false,
    diff: null,
  });
  assert.deepEqual(await getGitDiff("/tmp", ""), {
    path: "",
    staged: false,
    diff: null,
  });
  const missing = await getGitDiff(
    "/tmp/grok-desktop-definitely-not-a-git-repo",
    "a.ts",
    { staged: true },
  );
  assert.deepEqual(missing, { path: "a.ts", staged: true, diff: null });
});
