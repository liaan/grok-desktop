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
 * Combine ensureAgent session fields with inspectBackbone for agent:restart.
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
  const bb = backbone || {
    ok: false,
    skills: [],
    mcpServers: [],
    plugins: [],
  };
  return {
    ok: Boolean(bb.ok),
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
    backbone: bb,
  };
}
