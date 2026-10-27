import { afterEach, describe, expect, it } from "vitest";
import { episodeCode } from "@/lib/episodes";
import { typeLabel } from "@/lib/labels";
import { streamLangLabel, subtitleLabel } from "@/lib/languages";
import { en } from "./en";
import { setLanguage, t } from "./index";

afterEach(() => setLanguage("es"));

describe("i18n", () => {
  it("returns Spanish as-is and English from the dictionary", () => {
    setLanguage("es");
    expect(t("Ajustes")).toBe("Ajustes");
    setLanguage("en");
    expect(t("Ajustes")).toBe("Settings");
  });

  it("fills variables in either language", () => {
    setLanguage("en");
    expect(t("Temporada {n}", { n: 2 })).toBe("Season 2");
    setLanguage("es");
    expect(t("Temporada {n}", { n: 2 })).toBe("Temporada 2");
  });

  it("falls back to Spanish when a translation is missing", () => {
    setLanguage("en");
    expect(t("Texto que no existe en el diccionario")).toBe("Texto que no existe en el diccionario");
  });

  it("translates helpers used across the UI", () => {
    setLanguage("en");
    expect(episodeCode(1, 2)).toBe("S1E2");
    expect(typeLabel("movie")).toBe("Movies");
    expect(streamLangLabel("latino")).toBe("Latino");
    expect(subtitleLabel("spa")).toBe("Spanish");
    setLanguage("es");
    expect(episodeCode(1, 2)).toBe("T1E2");
    expect(subtitleLabel("spa")).toBe("Español");
  });

  it("keeps every {placeholder} in the English texts", () => {
    for (const [es, english] of Object.entries(en)) {
      const vars = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
      expect(vars(english), es).toEqual(vars(es));
    }
  });
});
