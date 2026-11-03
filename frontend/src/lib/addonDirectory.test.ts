import { describe, expect, it } from "vitest";
import { mergeDirectories, searchDirectory } from "./addonDirectory";

const addon = (id: string, name: string, resources: string[], description = "", extra = {}) => ({
  transportUrl: `https://${id}.example/manifest.json`,
  manifest: { id, name, version: "1", description, resources, types: ["movie"], ...extra },
});

describe("addon directory", () => {
  it("merges both lists without repeats or broken entries", () => {
    const a = addon("a", "Anime Kitsu", ["catalog"]);
    const merged = mergeDirectories([[a, { transportUrl: "" }], [{ ...a, transportUrl: a.transportUrl + "/" }, addon("b", "B", ["stream"])]]);
    expect(merged.map((x) => x.manifest.id)).toEqual(["a", "b"]);
  });

  it("searches ignoring accents, name matches first, filtered by kind", () => {
    const list = mergeDirectories([[
      addon("1", "Subs Pro", ["subtitles"], "Subtítulos en español latino"),
      addon("2", "Latino Catálogo", ["catalog"]),
      addon("3", "Streams X", ["stream"], "fuentes latino"),
    ]]);
    expect(searchDirectory(list, "latino", "", false).map((x) => x.manifest.id)).toEqual(["2", "1", "3"]);
    expect(searchDirectory(list, "subtitulos", "", false).map((x) => x.manifest.id)).toEqual(["1"]);
    expect(searchDirectory(list, "", "stream", false).map((x) => x.manifest.id)).toEqual(["3"]);
  });

  it("hides adult addons unless the profile allows them", () => {
    const list = mergeDirectories([[addon("x", "Cosa XXX", ["catalog"])]]);
    expect(searchDirectory(list, "", "", false)).toHaveLength(0);
    expect(searchDirectory(list, "", "", true)).toHaveLength(1);
  });
});
