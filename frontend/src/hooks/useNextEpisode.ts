import { useEffect, useState } from "react";
import type { ProgressContext } from "@/api/progress";
import { episodeCode, nextEpisode } from "@/lib/episodes";
import { getMeta, type AddonRef } from "@/lib/stremio";
import { streamsPath } from "@/lib/routes";

export interface NextEpisodeLink {
  /** Stream picker for the next episode. */
  href: string;
  /** "T1E3" / "S1E3". */
  code: string;
  title?: string;
}

/** The next released episode of the series being played: undefined while
 * looking it up, null when there's none. */
export function useNextEpisode(addons: AddonRef[], type: string, ctx?: ProgressContext) {
  const [next, setNext] = useState<NextEpisodeLink | null | undefined>(undefined);
  const { metaId, season, episode } = ctx ?? {};

  useEffect(() => {
    if (type !== "series" || !ctx || !metaId || season == null || episode == null || addons.length === 0) {
      setNext(null);
      return;
    }
    setNext(undefined);
    let cancelled = false;
    getMeta(addons, type, metaId)
      .then((res) => {
        const v = nextEpisode(res?.meta.videos ?? [], season, episode);
        if (cancelled) return;
        if (!v) return setNext(null);
        const ep = v.episode ?? v.number;
        const epTitle = v.title ?? v.name;
        setNext({
          // auto=1: the picker starts the best ready source by itself.
          href: `${streamsPath(type, v.id, ctx.name, { ...ctx, season: v.season, episode: ep, episodeTitle: epTitle })}&auto=1`,
          code: episodeCode(v.season, ep),
          title: epTitle,
        });
      })
      .catch(() => !cancelled && setNext(null));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addons, type, metaId, season, episode]);

  return next;
}
