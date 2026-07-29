// @ts-nocheck — imports shared pure ESM without package types
import type { TimelineItem } from "../vite-env";
import {
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
