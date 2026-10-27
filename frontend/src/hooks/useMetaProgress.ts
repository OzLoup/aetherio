import { useCallback, useEffect, useState } from "react";
import { getMetaProgress, markWatched, type ProgressEntry } from "@/api/progress";
import type { MetaDetail, Video } from "@/lib/stremio";
import { episodeNumber } from "@/lib/meta";

/** Watched marks / positions of one title for the current profile. */
export function useMetaProgress(meta: MetaDetail) {
  const [byVideo, setByVideo] = useState<Map<string, ProgressEntry>>(new Map());

  useEffect(() => {
    let cancelled = false;
    getMetaProgress(meta.id)
      .then((list) => {
        if (!cancelled) setByVideo(new Map(list.map((p) => [p.video_id, p])));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [meta.id]);

  const setWatched = useCallback(
    async (videos: { id: string; video?: Video }[], watched: boolean) => {
      // Optimistic: the marks change right away.
      setByVideo((prev) => {
        const next = new Map(prev);
        for (const { id } of videos) {
          const old = next.get(id);
          next.set(id, { ...(old ?? emptyEntry(meta, id)), watched, position: 0 });
        }
        return next;
      });
      try {
        await markWatched(
          { metaId: meta.id, type: meta.type, name: meta.name, poster: meta.poster },
          videos.map(({ id, video }) => ({
            videoId: id,
            season: video?.season,
            episode: video ? episodeNumber(video) : undefined,
            episodeTitle: video?.title ?? video?.name,
          })),
          watched,
        );
      } catch (err) {
        console.warn("[progress] mark failed", err);
      }
    },
    [meta],
  );

  return { byVideo, setWatched };
}

function emptyEntry(meta: MetaDetail, videoId: string): ProgressEntry {
  return {
    video_id: videoId,
    meta_id: meta.id,
    type: meta.type,
    name: meta.name,
    poster: meta.poster ?? null,
    season: null,
    episode: null,
    episode_title: null,
    position: 0,
    duration: 0,
    watched: false,
    updated_at: new Date().toISOString(),
  };
}
