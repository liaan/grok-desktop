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
  setPref: (pref: LocalePref) => void;
  t: (key: string, vars?: Record<string, string | number>) => string;
};

const I18nContext = createContext<I18nValue | null>(null);

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [pref, setPrefState] = useState<LocalePref>(
    () => readStoredLocalePref() ?? "system",
  );
  const locale = resolveLocale(pref, navigator.language);

  const setPref = useCallback((next: LocalePref) => {
    const pref = normalizeLocalePref(next);
    storeLocalePref(pref);
    setPrefState(pref);
    void window.grokDesktop?.setLocale?.(pref);
  }, []);

  useEffect(() => {
    document.documentElement.lang = locale === "zh-CN" ? "zh-CN" : "en";
    if (readStoredLocalePref() != null) {
      void window.grokDesktop?.setLocale?.(pref);
    }
  }, [locale, pref]);

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
