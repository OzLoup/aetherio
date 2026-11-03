/**
 * App language (Spanish / English). The Spanish text IS the key:
 *   t("Buscar") → "Search" in English, "Buscar" in Spanish.
 *   t("Quedan {n} min", { n: 12 })
 * English lives in ./en.ts, loaded only when the app is in English (it's
 * ~120 KB the Spanish UI never needs); a missing entry falls back to Spanish.
 *
 * `t` is a plain function (usable in lib/ code too). Switching language
 * remounts the tree (I18nProvider keys it), so everything re-renders.
 */
import { createContext, Fragment, useContext, useEffect, useState, type ReactNode } from "react";

export type UiLanguage = "es" | "en";
export const UI_LANGUAGES: { code: UiLanguage; label: string }[] = [
  { code: "es", label: "Español" },
  { code: "en", label: "English" },
];

const STORAGE_KEY = "ap_ui_lang";

function initialLanguage(): UiLanguage {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === "es" || saved === "en") return saved;
  } catch {
    // ignore
  }
  return typeof navigator !== "undefined" && !navigator.language.toLowerCase().startsWith("es") ? "en" : "es";
}

let current: UiLanguage = typeof window === "undefined" ? "es" : initialLanguage();

// English text, once downloaded.
let en: Record<string, string> | null = null;
let enLoading: Promise<void> | null = null;

/** Download the English dictionary (once). Spanish needs nothing. */
export function loadDictionary(lang: UiLanguage): Promise<void> {
  if (lang !== "en" || en) return Promise.resolve();
  enLoading ??= import("./en").then((m) => {
    en = m.en;
  });
  return enLoading;
}

// English UI: start downloading right away, in parallel with the rest.
if (current === "en") void loadDictionary("en");

export function getLanguage(): UiLanguage {
  return current;
}

/** Normally driven by I18nProvider; exported for tests and non-React code. */
export function setLanguage(lang: UiLanguage) {
  current = lang;
}

/** Locale for dates/numbers. */
export function locale() {
  return current === "en" ? "en-US" : "es";
}

export function t(text: string, vars?: Record<string, string | number>): string {
  let out = current === "en" && en ? (en[text] ?? text) : text;
  if (current === "en" && en && !(text in en) && import.meta.env.DEV) console.debug("[i18n] missing:", text);
  if (vars) for (const [k, v] of Object.entries(vars)) out = out.replaceAll(`{${k}}`, String(v));
  return out;
}

const I18nContext = createContext<{ language: UiLanguage; setLanguage: (l: UiLanguage) => void }>({
  language: current,
  setLanguage: () => {},
});

export function I18nProvider({ children, language }: { children: ReactNode; language?: UiLanguage }) {
  const [lang, setLang] = useState<UiLanguage>(language ?? current);
  // English shows once its dictionary is here (a moment, the first time).
  const [ready, setReady] = useState(() => lang !== "en" || en !== null);
  useEffect(() => {
    let cancelled = false;
    loadDictionary(lang).then(() => !cancelled && setReady(true));
    return () => {
      cancelled = true;
    };
  }, [lang]);

  // The profile's setting wins once known.
  useEffect(() => {
    if (language && language !== lang) setLang(language);
  }, [language, lang]);

  current = lang;
  useEffect(() => {
    document.documentElement.lang = lang;
    try {
      localStorage.setItem(STORAGE_KEY, lang);
    } catch {
      // ignore
    }
  }, [lang]);

  return (
    <I18nContext.Provider value={{ language: lang, setLanguage: setLang }}>
      <Fragment key={`${lang}-${ready}`}>{ready || lang !== "en" ? children : null}</Fragment>
    </I18nContext.Provider>
  );
}

export function useLanguage() {
  return useContext(I18nContext);
}
