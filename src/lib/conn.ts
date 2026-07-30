/** Agent connection / turn state shared by App shell + UI chrome. */
export type ConnState = "idle" | "connecting" | "online" | "busy" | "error";

/** True when an error message looks like an auth / sign-in failure. */
export function isAuthError(msg: string): boolean {
  return /auth|login|unauthor|401|credential|sign in|sign-in/i.test(msg);
}
