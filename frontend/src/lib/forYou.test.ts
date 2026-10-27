import { describe, expect, it } from "vitest";
import { buildTaste, hasEnoughSignals, rankForYou, topGenres, type Signal } from "./forYou";

const signals: Signal[] = [
  { kind: "rating", rating: 2, genres: ["Drama", "Romance"] },
  { kind: "rating", rating: 1, genres: ["Drama"] },
  { kind: "watched", genres: ["Comedy"] },
  { kind: "rating", rating: -1, genres: ["Horror"] },
  { kind: "rating", rating: -1, genres: ["Horror"] },
];
const meta = (id: string, genre: string[], imdbRating = "7") => ({ id, type: "movie", name: id, genre, imdbRating });

describe("Para ti", () => {
  it("learns favourite genres and dislikes", () => {
    const taste = buildTaste(signals);
    expect(topGenres(taste)).toEqual(["Drama", "Romance", "Comedy"]);
    expect(taste.get("Horror")).toBeLessThan(-1);
    expect(hasEnoughSignals(signals)).toBe(true);
    expect(hasEnoughSignals(signals.slice(3))).toBe(false);
  });

  it("ranks by fit, skips excluded, duplicates and disliked genres", () => {
    const taste = buildTaste(signals);
    const ranked = rankForYou(
      [
        meta("comedy", ["Comedy"], "8"),
        meta("drama", ["Drama", "Romance"]),
        meta("seen", ["Drama"]),
        meta("drama", ["Drama", "Romance"]),
        meta("scary", ["Horror", "Drama"], "9"),
      ],
      taste,
      new Set(["seen"]),
    );
    expect(ranked.map((m) => m.id)).toEqual(["drama", "comedy"]);
  });
});
