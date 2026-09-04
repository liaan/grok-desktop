/** Client-minted `interjectionId`s so the agent echo is not painted twice. */
const selfIds = new Set<string>();

export function rememberSelfInterjection(id: string) {
  const key = String(id || "").trim();
  if (key) selfIds.add(key);
}

export function consumeSelfInterjection(id: string): boolean {
  const key = String(id || "").trim();
  return Boolean(key) && selfIds.delete(key);
}

export function selfInterjectionIds(): Set<string> {
  return selfIds;
}
