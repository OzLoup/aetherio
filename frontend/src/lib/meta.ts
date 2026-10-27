import { locale } from "@/i18n";
import type { MetaDetail, Video } from "@/lib/stremio";

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
