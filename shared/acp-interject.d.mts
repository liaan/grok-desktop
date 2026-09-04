export const INTERJECT_UNSUPPORTED_REASON: "unsupported";

export type SessionInterjection = {
  sessionId: string;
  text: string;
  interjectionId: string;
};

export type InterjectUnsupportedResult = {
  ok: false;
  reason: "unsupported";
  interjectionId: string;
};

export type InterjectAcceptedResult = {
  ok: true;
  status: string;
  interjectionId: string;
};

export function interjectUnsupportedResult(
  interjectionId?: string,
): InterjectUnsupportedResult;

export function interjectAcceptedResult(
  interjectionId: string,
  status?: unknown,
): InterjectAcceptedResult;

export function isInterjectMethodMissing(err: unknown): boolean;

export function mapInterjectIpcError(
  err: unknown,
  interjectionId?: string,
): InterjectUnsupportedResult | null;

export function interjectFromAttemptErrors(
  errors: unknown[],
  interjectionId: string,
): InterjectUnsupportedResult;

export function interjectRequestParams(opts: {
  sessionId: string;
  text: string;
  interjectionId: string;
  images?: { data: string; mimeType?: string }[];
}): Record<string, unknown>;

export function interjectAttempts(opts: {
  sessionId: string;
  text: string;
  interjectionId: string;
  images?: { data: string; mimeType?: string }[];
}): { method: string; params: object }[];

export function isSessionInterjectionMethod(method: unknown): boolean;

export function unwrapSessionInterjection(
  method: unknown,
  params: unknown,
): SessionInterjection | null;
