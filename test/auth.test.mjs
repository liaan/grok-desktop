/**
 * Login progress parsing — URL / device code / loopback finish-code.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildLoginProgress,
  buildLoopbackFinishUrl,
  extractLoopbackCallback,
  isCompleteLoginUrl,
  isLoopbackHttpUrl,
  isRemoteLoginUrl,
  mergeUrlPrefixes,
  parseLoginProgress,
  submitLoginInput,
} from "../electron/auth.mjs";

test("parseLoginProgress extracts a remote OAuth URL", () => {
  const parsed = parseLoginProgress(
    "Open this URL to authenticate:\nhttps://auth.x.ai/authorize?client_id=abc&redirect_uri=http://127.0.0.1:8765/callback\nWaiting for browser…",
  );
  assert.equal(
    parsed.url,
    "https://auth.x.ai/authorize?client_id=abc&redirect_uri=http://127.0.0.1:8765/callback",
  );
  assert.equal(parsed.userCode, null);
});

test("parseLoginProgress prefers a remote URL over loopback", () => {
  const parsed = parseLoginProgress(
    "callback http://127.0.0.1:4242/callback\nvisit https://accounts.x.ai/sign-in?redirect=oauth2-provider\n",
  );
  assert.equal(
    parsed.url,
    "https://accounts.x.ai/sign-in?redirect=oauth2-provider",
  );
  assert.ok(parsed.urls.some((u) => u.startsWith("http://127.0.0.1:4242/")));
});

test("parseLoginProgress ignores a truncated URL at the buffer end", () => {
  assert.equal(parseLoginProgress("Opening https://auth").url, null);
  assert.equal(
    parseLoginProgress("Opening https://auth.x.ai/oauth2/auth?client_id=abc")
      .url,
    null,
  );
});

test("parseLoginProgress upgrades a prefix URL when the rest arrives", () => {
  const first = parseLoginProgress(
    "https://auth.x.ai/oauth2/auth?client_id=abc",
  );
  assert.equal(first.url, null);
  const full =
    "https://auth.x.ai/oauth2/auth?client_id=abc&redirect_uri=http://127.0.0.1:9/callback&state=s\n";
  const parsed = parseLoginProgress(full);
  assert.equal(
    parsed.url,
    "https://auth.x.ai/oauth2/auth?client_id=abc&redirect_uri=http://127.0.0.1:9/callback&state=s",
  );
});

test("parseLoginProgress reads a device user code", () => {
  const parsed = parseLoginProgress(
    "Visit https://accounts.x.ai/device\nEnter code: ABCD-EFGH\n",
  );
  assert.equal(parsed.url, "https://accounts.x.ai/device");
  assert.equal(parsed.userCode, "ABCD-EFGH");
});

test("parseLoginProgress flags a paste-the-code prompt", () => {
  const parsed = parseLoginProgress(
    "Copy the code below into Grok Build to finish signing in.",
  );
  assert.equal(parsed.needsPaste, true);
});

test("buildLoginProgress marks oauth as needsPaste and device-auth as not", () => {
  const oauth = buildLoginProgress("https://auth.x.ai/login\n", "", {
    deviceAuth: false,
  });
  assert.equal(oauth.needsPaste, true);
  assert.equal(oauth.deviceAuth, false);
  const device = buildLoginProgress(
    "Visit https://accounts.x.ai/device\nEnter code: ABCD-EFGH\n",
    "",
    { deviceAuth: true },
  );
  assert.equal(device.needsPaste, false);
  assert.equal(device.deviceAuth, true);
});

test("isRemoteLoginUrl rejects loopback", () => {
  assert.equal(isRemoteLoginUrl("https://auth.x.ai/login"), true);
  assert.equal(isRemoteLoginUrl("http://127.0.0.1:9/cb"), false);
  assert.equal(isRemoteLoginUrl("http://localhost:9/cb"), false);
  assert.equal(isRemoteLoginUrl("not-a-url"), false);
});

test("isLoopbackHttpUrl allows only http loopback", () => {
  assert.equal(isLoopbackHttpUrl("http://127.0.0.1:8765/callback"), true);
  assert.equal(isLoopbackHttpUrl("https://127.0.0.1:8765/callback"), false);
  assert.equal(isLoopbackHttpUrl("https://auth.x.ai/login"), false);
});

test("isCompleteLoginUrl waits for redirect_uri on a trailing authorize URL", () => {
  assert.equal(
    isCompleteLoginUrl("https://auth.x.ai/oauth2/auth?client_id=abc", true),
    false,
  );
  assert.equal(
    isCompleteLoginUrl(
      "https://auth.x.ai/oauth2/auth?client_id=abc&redirect_uri=http://127.0.0.1:1/callback",
      true,
    ),
    true,
  );
  assert.equal(
    isCompleteLoginUrl("https://auth.x.ai/oauth2/auth?client_id=abc", false),
    true,
  );
});

test("mergeUrlPrefixes keeps the longest extension", () => {
  assert.deepEqual(
    mergeUrlPrefixes([
      "https://auth.x.ai/oauth2/auth?client_id=abc",
      "https://auth.x.ai/oauth2/auth?client_id=abc&redirect_uri=http://127.0.0.1:1/callback",
    ]),
    [
      "https://auth.x.ai/oauth2/auth?client_id=abc&redirect_uri=http://127.0.0.1:1/callback",
    ],
  );
});

test("extractLoopbackCallback reads redirect_uri from the authorize URL", () => {
  const cb = extractLoopbackCallback([
    "https://auth.x.ai/oauth2/auth?client_id=abc&redirect_uri=http://127.0.0.1:8765/callback&state=s1",
  ]);
  assert.equal(cb, "http://127.0.0.1:8765/callback");
});

test("buildLoopbackFinishUrl attaches code and authorize state", () => {
  const url = buildLoopbackFinishUrl(
    "http://127.0.0.1:8765/callback",
    "KH8sOmgCode",
    "https://auth.x.ai/oauth2/auth?state=s1&redirect_uri=http://127.0.0.1:8765/callback",
  );
  assert.ok(url);
  const parsed = new URL(url);
  assert.equal(parsed.origin, "http://127.0.0.1:8765");
  assert.equal(parsed.pathname, "/callback");
  assert.equal(parsed.searchParams.get("code"), "KH8sOmgCode");
  assert.equal(parsed.searchParams.get("state"), "s1");
});

test("buildLoopbackFinishUrl uses a pasted loopback URL as-is", () => {
  const pasted = "http://127.0.0.1:8765/callback?code=abc&state=zz";
  assert.equal(
    buildLoopbackFinishUrl("http://127.0.0.1:1/callback", pasted, null),
    pasted,
  );
});

test("buildLoginProgress strips JWT-looking blobs from output", () => {
  const progress = buildLoginProgress(
    "https://auth.x.ai/login\nlogin eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.aaa.bbb",
    "",
  );
  assert.equal(progress.url, "https://auth.x.ai/login");
  assert.match(progress.output, /\[token\]/);
  assert.doesNotMatch(progress.output, /eyJhbGci/);
});

test("submitLoginInput fails when no login is running", async () => {
  const result = await submitLoginInput("KH8sOmg");
  assert.equal(result.ok, false);
  assert.match(result.error || "", /no login/i);
});

test("submitLoginInput rejects an empty code", async () => {
  const result = await submitLoginInput("   ");
  assert.equal(result.ok, false);
  assert.match(result.error || "", /empty/i);
});
