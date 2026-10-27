import type { ProgressEntry } from "@/api/progress";
import { episodeNumber, isReleased } from "@/lib/meta";
import type { Video } from "@/lib/stremio";
import { t } from "@/i18n";

/** The first released regular episode after (season, episode). */
export function nextEpisode(videos: Video[], season: number, episode: number) {
  return (
    videos
      .filter((v) => (v.season ?? 0) > 0 && isReleased(v))
      .sort((a, b) => (a.season ?? 0) - (b.season ?? 0) || (episodeNumber(a) ?? 0) - (episodeNumber(b) ?? 0))
      .find((v) => {
        const s = v.season ?? 0;
        const e = episodeNumber(v) ?? 0;
        return s > season || (s === season && e > episode);
      }) ?? null
  );
}

export function episodeCode(season?: number | null, episode?: number | null) {
  // "T1E2" (temporada/episodio) in Spanish, "S1E2" in English.
  return season != null && episode != null ? t("T{s}E{e}", { s: season, e: episode }) : "";
}

export function progressShare(p: Pick<ProgressEntry, "position" | "duration">) {
  return p.duration > 0 ? Math.min(1, p.position / p.duration) : 0;
}
