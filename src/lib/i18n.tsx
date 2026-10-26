import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  normalizeLocalePref,
  resolveLocale,
  translate,
  type Locale,
  type LocalePref,
} from "../../shared/ui-copy.mjs";

const STORAGE_KEY = "grok-desktop-locale";

/**
 * Bumped only by a user setPref. Bootstrap captures this before getInfo and
 * passes it back; a stale snapshot must not write localStorage.
 */
export const localeGen = { current: 0 };

export function readStoredLocalePref(): LocalePref | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw == null) return null;
    return normalizeLocalePref(raw);
  } catch {
    return null;
  }
}

export function storeLocalePref(pref: LocalePref): void {
  try {
    localStorage.setItem(STORAGE_KEY, pref);
  } catch {
    /* ignore */
  }
}

type I18nValue = {
  pref: LocalePref;
  locale: Locale;
  /** User write. Pass `{ gen }` to apply a getInfo snapshot without setLocale. */
  setPref: (pref: unknown, opts?: { gen?: number }) => void;
  t: (key: string, vars?: Record<string, string | number>) => string;
};

const I18nContext = createContext<I18nValue | null>(null);

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [pref, setPrefState] = useState<LocalePref>(
    () => readStoredLocalePref() ?? "system",
  );
  const locale = resolveLocale(pref, navigator.language);

  const setPref = useCallback((next: unknown, opts?: { gen?: number }) => {
    if (opts && opts.gen !== localeGen.current) return;
    if (!opts) localeGen.current += 1;
    const value = normalizeLocalePref(next);
    storeLocalePref(value);
    setPrefState(value);
    if (opts) return;
    void window.grokDesktop?.setLocale?.(value);
  }, []);

  useEffect(() => {
    document.documentElement.lang = locale === "zh-CN" ? "zh-CN" : "en";
  }, [locale]);

  const t = useCallback(
    (key: string, vars?: Record<string, string | number>) =>
      translate(locale, key, vars),
    [locale],
  );

  const value = useMemo(
    () => ({ pref, locale, setPref, t }),
    [pref, locale, setPref, t],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    const locale = resolveLocale("system", navigator.language);
    return {
      pref: "system",
      locale,
      setPref: () => {},
      t: (key, vars) => translate(locale, key, vars),
    };
  }
  return ctx;
}
