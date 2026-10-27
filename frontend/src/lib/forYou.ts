/**
 * "Para ti": which genres this profile likes, from what it did, and how
 * well a catalog title fits. Pure functions (the row in
 * components/catalog/ForYouRow.tsx fetches the data).
 */
import type { MetaPreview } from "@/lib/stremio";

export type Signal =
  | { kind: "rating"; rating: -1 | 1 | 2; genres: string[] }
  | { kind: "watched" | "saved"; genres: string[] };

const WEIGHT = {
  love: 2,
  like: 1,
  dislike: -1.5,
  watched: 0.5,
  saved: 0.7,
} as const;

export function genresOf(m: Pick<MetaPreview, "genres" | "genre">) {
  return [...new Set([...(m.genres ?? []), ...(m.genre ?? [])])];
}

/** Genre → weight (positive = likes it). */
export function buildTaste(signals: Signal[]) {
  const taste = new Map<string, number>();
  for (const s of signals) {
    const w =
      s.kind === "rating"
        ? s.rating === 2
          ? WEIGHT.love
          : s.rating === 1
            ? WEIGHT.like
            : WEIGHT.dislike
        : WEIGHT[s.kind];
    // A title with many genres says less about each one.
    const share = w / Math.max(1, Math.sqrt(s.genres.length));
    for (const g of s.genres) taste.set(g, (taste.get(g) ?? 0) + share);
  }
  return taste;
}

/** Favourite genres, best first. */
export function topGenres(taste: Map<string, number>, n = 3) {
  return [...taste.entries()]
    .filter(([, w]) => w > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([g]) => g);
}

/** Enough to go on: a few positive signals with genres. */
export function hasEnoughSignals(signals: Signal[]) {
  return signals.filter((s) => s.genres.length && (s.kind !== "rating" || s.rating > 0)).length >= 3;
}

export function fitScore(m: MetaPreview, taste: Map<string, number>) {
  const genres = genresOf(m);
  if (!genres.length) return -Infinity;
  const fit = genres.reduce((sum, g) => sum + (taste.get(g) ?? 0), 0) / Math.sqrt(genres.length);
  const rating = Number(m.imdbRating) || 0;
  return fit + rating / 10;
}

/** Best fits first, without duplicates or anything in `exclude` (seen,
 * rated, saved); titles with a genre the profile dislikes are dropped. */
export function rankForYou(candidates: MetaPreview[], taste: Map<string, number>, exclude: Set<string>, limit = 30) {
  const seen = new Set<string>();
  return candidates
    .filter((m) => {
      if (exclude.has(m.id) || seen.has(m.id)) return false;
      seen.add(m.id);
      return !genresOf(m).some((g) => (taste.get(g) ?? 0) < -1);
    })
    .map((m) => ({ m, score: fitScore(m, taste) }))
    .filter((x) => Number.isFinite(x.score))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => x.m);
}
