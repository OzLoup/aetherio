import { useEffect, useState } from "react";
import type { ProgressContext } from "@/api/progress";
import { t } from "@/i18n";
import { episodeCode, nextEpisode, previousEpisode } from "@/lib/episodes";
import { episodeNumber } from "@/lib/meta";
import { streamsPath } from "@/lib/routes";
import { getMeta, type AddonRef, type Video } from "@/lib/stremio";

export interface EpisodeLink {
  /** Stream picker for that episode. */
  href: string;
  /** "T1E3" / "S1E3". */
  code: string;
  title?: string;
}
/** Kept for the players. */
export type NextEpisodeLink = EpisodeLink;

interface Adjacent {
  previous: EpisodeLink | null;
  next: EpisodeLink | null;
}

/** Same title and context as picking the episode on the series page. */
function linkTo(type: string, ctx: ProgressContext, v: Video): EpisodeLink {
  const ep = episodeNumber(v);
  const title = v.title ?? v.name ?? t("Episodio {n}", { n: ep ?? "" });
  const code = episodeCode(v.season, ep);
  const fullTitle = [ctx.name, code, title].filter(Boolean).join(" · ");
  return {
    href: streamsPath(type, v.id, fullTitle, { ...ctx, season: v.season, episode: ep, episodeTitle: title }),
    code,
    title,
  };
}

/** The episodes before and after the one being watched/picked: undefined
 * while looking them up, null fields when there's none. */
export function useAdjacentEpisodes(addons: AddonRef[], type: string, ctx?: ProgressContext) {
  const [adjacent, setAdjacent] = useState<Adjacent | undefined>(undefined);
  const { metaId, season, episode } = ctx ?? {};

  useEffect(() => {
    if (type !== "series" || !ctx || !metaId || season == null || episode == null || addons.length === 0) {
      setAdjacent({ previous: null, next: null });
      return;
    }
    setAdjacent(undefined);
    let cancelled = false;
    getMeta(addons, type, metaId)
      .then((res) => {
        if (cancelled) return;
        const videos = res?.meta.videos ?? [];
        const prev = previousEpisode(videos, season, episode);
        const next = nextEpisode(videos, season, episode);
        setAdjacent({ previous: prev && linkTo(type, ctx, prev), next: next && linkTo(type, ctx, next) });
      })
      .catch(() => !cancelled && setAdjacent({ previous: null, next: null }));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addons, type, metaId, season, episode]);

  return adjacent;
}

/** The next released episode, for the players: undefined while looking it
 * up, null when there's none. Its link starts the best source by itself. */
export function useNextEpisode(addons: AddonRef[], type: string, ctx?: ProgressContext) {
  const adjacent = useAdjacentEpisodes(addons, type, ctx);
  if (adjacent === undefined) return undefined;
  // auto=1: the picker starts the best ready source by itself.
  return adjacent.next && { ...adjacent.next, href: `${adjacent.next.href}&auto=1` };
}
