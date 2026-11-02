import { describe, expect, it } from "vitest";
import type { MetaPreview } from "@/lib/stremio";
import { metaYear, sortMetas } from "./meta";

const m = (name: string, releaseInfo?: string): MetaPreview => ({ id: name, type: "series", name, releaseInfo });

describe("metaYear", () => {
  it("reads single years, ranges and ongoing series", () => {
    expect(metaYear(m("a", "2021"))).toBe(2021);
    expect(metaYear(m("a", "2015–2019"))).toBe(2019);
    expect(metaYear(m("a", "2019–"), 2026)).toBe(2026);
    expect(metaYear(m("a"))).toBeNull();
  });
});

describe("sortMetas", () => {
  const items = [m("Ñandú", "2001"), m("avatar", "2009"), m("Breaking Bad", "2008–2013"), m("Sin año"), m("Ángel", "2023")];
  it("keeps the addon's order by default", () => expect(sortMetas(items, "")).toBe(items));
  it("sorts A–Z ignoring case and accents", () =>
    expect(sortMetas(items, "az").map((x) => x.name)).toEqual(["Ángel", "avatar", "Breaking Bad", "Ñandú", "Sin año"]));
  it("puts the newest first and titles without a year last", () =>
    expect(sortMetas(items, "recent", 2026).map((x) => x.name)).toEqual(["Ángel", "Breaking Bad", "avatar", "Ñandú", "Sin año"]));
});
