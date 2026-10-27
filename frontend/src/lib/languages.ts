import { t } from "@/i18n";
export type LanguageCode = "es-419" | "es-ES" | "en" | "pt-BR";

/** Language tags we can recognise in a stream's name/title. */
/** "espanol" = Spanish without saying which (often Latino in English-named releases). */
export type StreamLang = "latino" | "castellano" | "espanol" | "english" | "portugues" | "japones" | "multi";

export const LANGUAGES: {
  code: LanguageCode;
  label: string;
  /** Subtitle codes to look for, best first (OpenSubtitles uses ISO 639-2). */
  subtitles: string[];
  /** How much each stream language suits this profile (missing = 0). */
  streamScore: Partial<Record<StreamLang, number>>;
}[] = [
  {
    code: "es-419",
    label: "Español latino",
    subtitles: ["spn", "ea", "es-419", "es-mx", "spa", "es"],
    streamScore: { latino: 3, espanol: 2, multi: 1, castellano: 1 },
  },
  {
    code: "es-ES",
    label: "Español (España)",
    subtitles: ["spa", "es", "es-es", "spn", "ea"],
    streamScore: { castellano: 3, espanol: 2, multi: 1, latino: 1 },
  },
  { code: "en", label: "English", subtitles: ["eng", "en"], streamScore: { english: 3, multi: 1 } },
  {
    code: "pt-BR",
    label: "Português (Brasil)",
    subtitles: ["pob", "pt-br", "por", "pt"],
    streamScore: { portugues: 3, multi: 1 },
  },
];

export function languageInfo(code: string | undefined) {
  return LANGUAGES.find((l) => l.code === code) ?? LANGUAGES[0];
}

const SUBTITLE_NAMES: Record<string, string> = {
  spa: "Español",
  es: "Español",
  spn: "Español (Latinoamérica)",
  ea: "Español (Latinoamérica)",
  "es-419": "Español (Latinoamérica)",
  "es-mx": "Español (México)",
  eng: "English",
  en: "English",
  por: "Português",
  pt: "Português",
  pob: "Português (Brasil)",
  "pt-br": "Português (Brasil)",
  fre: "Français",
  fra: "Français",
  ita: "Italiano",
  ger: "Deutsch",
  deu: "Deutsch",
};

/** Language name in the app's language ("Español" / "Spanish"). */
export function subtitleLabel(lang: string) {
  const name = SUBTITLE_NAMES[lang.toLowerCase()];
  return name ? t(name) : lang;
}

/** "Latino", "Castellano"… in the app's language. */
export function streamLangLabel(lang: StreamLang) {
  return t(STREAM_LANG_LABELS[lang]);
}

export const STREAM_LANG_LABELS: Record<StreamLang, string> = {
  latino: "Latino",
  castellano: "Castellano",
  espanol: "Español",
  english: "Inglés",
  portugues: "Portugués",
  japones: "Japonés",
  multi: "Multi audio",
};
