import { locale } from "@/i18n";
import type { MetaDetail, MetaPreview, Video } from "@/lib/stremio";

function linksOf(meta: MetaDetail, category: string) {
  return (meta.links ?? []).filter((l) => l.category.toLowerCase() === category.toLowerCase()).map((l) => l.name);
}

/** Addons send people/genres either as plain arrays (legacy) or as `links`. */
export function metaGenres(meta: MetaDetail) {
  return meta.genres ?? meta.genre ?? linksOf(meta, "Genres");
}

export function metaCast(meta: MetaDetail) {
  return meta.cast?.length ? meta.cast : linksOf(meta, "Cast");
}

export function metaDirectors(meta: MetaDetail) {
  return meta.director?.length ? meta.director : linksOf(meta, "Directors");
}

export function trailerYouTubeId(meta: MetaDetail) {
  return meta.trailerStreams?.find((t) => t.ytId)?.ytId ?? meta.trailers?.find((t) => t.source)?.source;
}

export function episodeNumber(v: Video) {
  return v.episode ?? v.number;
}

/** Episodes grouped by season, seasons ascending with specials (0) last. */
export function groupBySeason(videos: Video[]) {
  const map = new Map<number, Video[]>();
  for (const v of videos) {
    const season = v.season ?? 0;
    if (!map.has(season)) map.set(season, []);
    map.get(season)!.push(v);
  }
  for (const list of map.values()) list.sort((a, b) => (episodeNumber(a) ?? 0) - (episodeNumber(b) ?? 0));
  const seasons = [...map.keys()].sort((a, b) => (a === 0 ? 1 : b === 0 ? -1 : a - b));
  return seasons.map((season) => ({ season, episodes: map.get(season)! }));
}

export function isReleased(v: Video, now = Date.now()) {
  return !v.released || new Date(v.released).getTime() <= now;
}

export function formatDate(iso?: string) {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString(locale(), { day: "numeric", month: "short", year: "numeric" });
}

// --- sorting a catalog (Discover) -------------------------------------------

export type CatalogSort = "" | "az" | "recent";

/** Latest year a title is about: "2019–2023" → 2023, an ongoing series
 * ("2019–") → this year, "2021" → 2021. null when the addon gives none. */
export function metaYear(m: MetaPreview, thisYear = new Date().getFullYear()): number | null {
  const text = `${m.releaseInfo ?? ""} ${m.year ?? ""}`.trim();
  const years = (text.match(/\b(19|20)\d{2}\b/g) ?? []).map(Number);
  if (!years.length) return null;
  if (/[–-]\s*$/.test(m.releaseInfo ?? "")) return thisYear;
  return Math.max(...years);
}

/** "" keeps the addon's order (often popularity). Titles without a year go
 * last when sorting by most recent; ties keep the addon's order. */
export function sortMetas(items: MetaPreview[], sort: CatalogSort, thisYear?: number) {
  if (!sort) return items;
  const collator = new Intl.Collator(locale(), { sensitivity: "base", numeric: true });
  const list = items.map((m, i) => ({ m, i }));
  if (sort === "az") {
    list.sort((a, b) => collator.compare(a.m.name, b.m.name) || a.i - b.i);
  } else {
    list.sort((a, b) => (metaYear(b.m, thisYear) ?? -1) - (metaYear(a.m, thisYear) ?? -1) || a.i - b.i);
  }
  return list.map((x) => x.m);
}
