/**
 * Pure helpers for GUI agent:restart (no Electron import — unit-tested).
 */

/**
 * Resolve cwd + session to resume. Null means refuse (no project on window).
 * @param {{ cwd?: string | null, sessionId?: string | null } | null | undefined} agent
 * @returns {{ cwd: string, resumeSessionId: string | null } | null}
 */
export function restartTargetFromAgent(agent) {
  const cwd = typeof agent?.cwd === "string" ? agent.cwd.trim() : "";
  if (!cwd) return null;
  return {
    cwd,
    resumeSessionId: agent.sessionId || null,
  };
}

/**
 * Live agent first; remembered lastCwd/lastSessionId if the client was
 * disposed after a failed spawn (retry must still work).
 * @param {{ cwd?: string | null, sessionId?: string | null } | null | undefined} live
 * @param {{ cwd?: string | null, sessionId?: string | null } | null | undefined} remembered
 */
export function restartTargetFromSources(live, remembered) {
  return restartTargetFromAgent(live) || restartTargetFromAgent(remembered);
}

/**
 * Attach inspectBackbone to the openProject-shaped restart payload.
 * Inspect `ok` stays on `backbone` — a failed inspect is not a failed restart.
 * @param {{
 *   cwd?: string,
 *   sessionId?: string | null,
 *   grokBinary?: string | null,
 *   resumed?: boolean,
 *   modelId?: string | null,
 *   modelName?: string | null,
 *   history?: unknown[],
 *   backgroundTasks?: unknown[],
 *   usage?: unknown,
 *   sessions?: unknown[],
 *   warning?: string | null,
 * }} session
 * @param {{
 *   ok?: boolean,
 *   skills?: unknown[],
 *   mcpServers?: unknown[],
 *   plugins?: unknown[],
 *   grokVersion?: string,
 *   error?: string,
 * } | null | undefined} backbone
 */
export function mergeRestartResult(session, backbone) {
  /** @type {Record<string, unknown>} */
  const result = {
    cwd: session.cwd,
    sessionId: session.sessionId,
    grokBinary: session.grokBinary,
    resumed: Boolean(session.resumed),
    modelId: session.modelId ?? null,
    modelName: session.modelName ?? null,
    history: session.history || [],
    backgroundTasks: session.backgroundTasks || [],
    usage: session.usage ?? null,
    sessions: session.sessions || [],
    warning: session.warning ?? null,
  };
  if (backbone) result.backbone = backbone;
  return result;
}
