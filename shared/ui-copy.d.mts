export type LocalePref = "system" | "en" | "zh-CN";
export type Locale = "en" | "zh-CN";

export const LOCALE_PREFS: readonly LocalePref[];

export function normalizeLocalePref(pref: unknown): LocalePref;
export function resolveLocale(
  pref: unknown,
  systemLang: string | null | undefined,
): Locale;

export const catalogs: Record<Locale, Record<string, string>>;

export function translate(
  locale: Locale,
  key: string,
  vars?: Record<string, string | number>,
): string;
