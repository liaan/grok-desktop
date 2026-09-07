import type { Dispatch, SetStateAction } from "react";
import type { ComposerSubmit } from "../components/Composer";
import type { TimelineItem } from "../vite-env";
import { appendUserMessage } from "./timeline";
import {
  ALREADY_IN_PLAN_NOTICE,
  PLAN_MODE_ID,
  isPlanMode,
  planSlashAction,
  planSlashDisplay,
} from "../../shared/session-mode.mjs";

/**
 * Desktop `/plan`: ACP session/set_mode, then optional first prompt.
 * Remainder is never sent with the `/plan` token.
 */
export async function enterPlanMode(opts: {
  description: string;
  sessionMode: string | null;
  setSessionMode: (id: string | null) => void;
  setError: (msg: string | null) => void;
  appendSystem: (text: string) => void;
  setItems: Dispatch<SetStateAction<TimelineItem[]>>;
  submitFromComposer: (payload: ComposerSubmit) => boolean | Promise<boolean>;
}): Promise<void> {
  const display = planSlashDisplay(opts.description);
  const action = planSlashAction(opts.description, {
    alreadyInPlan: isPlanMode(opts.sessionMode),
  });
  const paintChip = () =>
    opts.setItems((prev) =>
      appendUserMessage(prev, { text: display, optimistic: true }),
    );

  if (action.type === "already-in-plan") {
    const desc = String(opts.description || "").trim();
    if (!desc) {
      opts.appendSystem(ALREADY_IN_PLAN_NOTICE);
      return;
    }
    await opts.submitFromComposer({
      text: desc,
      timelineText: display,
      images: [],
      mode: "auto",
    });
    return;
  }

  const prevMode = opts.sessionMode;
  opts.setSessionMode(PLAN_MODE_ID);
  try {
    const result = await window.grokDesktop.setSessionMode(PLAN_MODE_ID);
    if (!result.agentSynced) {
      opts.setSessionMode(prevMode);
      const msg = result.error || "Could not enter plan mode";
      opts.setError(msg);
      opts.appendSystem(`Plan mode failed: ${msg}`);
      return;
    }
  } catch (e: unknown) {
    opts.setSessionMode(prevMode);
    const msg = e instanceof Error ? e.message : String(e);
    opts.setError(msg || "Could not enter plan mode");
    opts.appendSystem(`Plan mode failed: ${msg}`);
    return;
  }

  if (action.type === "set-mode") {
    paintChip();
    return;
  }

  const accepted = await opts.submitFromComposer({
    text: action.text || "",
    timelineText: display,
    images: [],
    mode: "auto",
  });
  if (!accepted) paintChip();
}
