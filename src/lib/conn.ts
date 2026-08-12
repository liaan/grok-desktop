/** Agent connection / turn state shared by App shell + UI chrome. */
export type ConnState = "idle" | "connecting" | "online" | "busy" | "error";

/** True when an error message looks like an auth / sign-in failure. */
export function isAuthError(msg: string): boolean {
  return /auth|login|unauthor|401|credential|sign in|sign-in/i.test(msg);
}

/** True when spawn/login failed because the grok binary is missing. */
export function isMissingBinaryError(msg: string): boolean {
  return (
    /\bENOENT\b/i.test(msg) ||
    /Grok CLI not found/i.test(msg) ||
    /spawn .*(enoent|not found)/i.test(msg)
  );
}
