// @ts-nocheck — imports shared pure ESM without package types
import type { TimelineImage, TimelineItem } from "../vite-env";
import {
  appendUserMessage as appendShared,
  applySessionInterjection as applyInterjectShared,
  removeUserInterjection as removeShared,
  shouldApplySessionInterjection as shouldApplyShared,
  applySessionUpdate as applyShared,
  finalizeOpenTools as finalizeShared,
  uid as sharedUid,
  formatOptionLabel as formatShared,
} from "../../shared/session-timeline.mjs";

export function uid(prefix = "id") {
  return sharedUid(prefix);
}

export function applySessionUpdate(
  items: TimelineItem[],
  params: any,
): TimelineItem[] {
  return applyShared(items, params);
}

export function appendUserMessage(
  items: TimelineItem[],
  payload: {
    text?: string;
    images?: TimelineImage[];
    optimistic?: boolean;
    at?: number;
    id?: string;
    interjectionId?: string;
  },
): TimelineItem[] {
  return appendShared(items, payload);
}

export function applySessionInterjection(
  items: TimelineItem[],
  payload: { text?: string; interjectionId?: string },
): TimelineItem[] {
  return applyInterjectShared(items, payload);
}

export function removeUserInterjection(
  items: TimelineItem[],
  interjectionId: string,
): TimelineItem[] {
  return removeShared(items, interjectionId);
}

export function shouldApplySessionInterjection(
  payload?: { sessionId?: string } | null,
  opts?: { opening?: boolean; sessionId?: string | null },
): boolean {
  return shouldApplyShared(payload, opts);
}

/** Close open tool cards when session/prompt returns or the user cancels. */
export function finalizeOpenTools(
  items: TimelineItem[],
  status: string = "completed",
): TimelineItem[] {
  return finalizeShared(items, status);
}

export function formatOptionLabel(optionId: string, name?: string) {
  return formatShared(optionId, name);
}
