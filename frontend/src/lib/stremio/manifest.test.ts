import { describe, expect, it } from "vitest";
import { browsableCatalogs, isDebridLibraryCatalog } from "./manifest";
import type { Manifest } from "./types";

describe("debrid library catalogs", () => {
  it("are hidden from browsing", () => {
    const m: Manifest = {
      id: "t",
      name: "Torrentio RD",
      version: "1",
      resources: ["catalog", "stream"],
      types: ["movie", "other"],
      catalogs: [
        { type: "other", id: "torrentio-realdebrid", name: "RealDebrid" },
        { type: "movie", id: "top", name: "Popular" },
      ],
    };
    expect(browsableCatalogs(m).map((c) => c.id)).toEqual(["top"]);
    expect(isDebridLibraryCatalog({ type: "other", id: "x", name: "TorBox" })).toBe(true);
    expect(isDebridLibraryCatalog({ type: "movie", id: "top", name: "Popular" })).toBe(false);
  });
});
