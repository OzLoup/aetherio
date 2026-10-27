import { BlossomCarousel } from "@blossom-carousel/react";
import { Film, Play, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { dismissFromContinue, getContinueWatching, type ProgressEntry } from "@/api/progress";
import { useAddons } from "@/hooks/useAddons";
import { episodeCode, nextEpisode, progressShare } from "@/lib/episodes";
import { streamsPath } from "@/lib/routes";
import { getMeta } from "@/lib/stremio";
import { t } from "@/i18n";

interface Item {
  entry: ProgressEntry;
  /** Where the card goes: the same video (resume) or the next episode. */
  videoId: string;
  season?: number;
  episode?: number;
  episodeTitle?: string;
  label: string;
  share: number;
  isNext: boolean;
}

/** "Continuar viendo": synced per profile, so it follows you across devices. */
export function ContinueWatching() {
  const { active, loading } = useAddons();
  const [items, setItems] = useState<Item[] | null>(null);

  useEffect(() => {
    if (loading) return;
    let cancelled = false;
    (async () => {
      const entries = await getContinueWatching().catch(() => [] as ProgressEntry[]);
      const built = await Promise.all(
        entries.map(async (entry): Promise<Item | null> => {
          if (!entry.watched) {
            const left = Math.max(0, Math.round((entry.duration - entry.position) / 60));
            return {
              entry,
              videoId: entry.video_id,
              season: entry.season ?? undefined,
              episode: entry.episode ?? undefined,
              episodeTitle: entry.episode_title ?? undefined,
              label: [episodeCode(entry.season, entry.episode), left ? t("Quedan {n} min", { n: left }) : ""].filter(Boolean).join(" · "),
              share: progressShare(entry),
              isNext: false,
            };
          }
          // Finished an episode: offer the next one (if it's out).
          if (entry.season == null || entry.episode == null) return null;
          const meta = await getMeta(active, entry.type, entry.meta_id).catch(() => null);
          const next = meta ? nextEpisode(meta.meta.videos ?? [], entry.season, entry.episode) : null;
          if (!next) return null;
          const ep = next.episode ?? next.number;
          return {
            entry,
            videoId: next.id,
            season: next.season,
            episode: ep,
            episodeTitle: next.title ?? next.name,
            label: t("Siguiente: {code}", { code: episodeCode(next.season, ep) }),
            share: 0,
            isNext: true,
          };
        }),
      );
      if (!cancelled) setItems(built.filter((i): i is Item => i !== null));
    })();
    return () => {
      cancelled = true;
    };
  }, [active, loading]);

  async function dismiss(metaId: string) {
    setItems((prev) => prev?.filter((i) => i.entry.meta_id !== metaId) ?? null);
    await dismissFromContinue(metaId).catch(() => {});
  }

  if (!items || items.length === 0) return null;

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold">{t("Continuar viendo")}</h2>
      <BlossomCarousel className="-mx-4 flex snap-x scroll-px-4 gap-3 px-4 pb-2 pt-1">
        {items.map((item) => {
          const { entry } = item;
          const title = [entry.name, episodeCode(item.season, item.episode), item.episodeTitle].filter(Boolean).join(" · ");
          const href = streamsPath(entry.type, item.videoId, title, {
            metaId: entry.meta_id,
            type: entry.type,
            name: entry.name,
            poster: entry.poster ?? undefined,
            season: item.season,
            episode: item.episode,
            episodeTitle: item.episodeTitle,
          });
          return (
            <div key={entry.meta_id} data-blossom-slide className="group relative w-32 shrink-0 snap-start sm:w-40">
              <Link to={href} className="flex flex-col gap-2 rounded-lg focus-visible:outline-none" title={title}>
                <div className="relative aspect-[2/3] overflow-hidden rounded-lg bg-muted ring-offset-2 ring-offset-background transition group-hover:ring-2 group-hover:ring-primary group-focus-within:ring-4 group-focus-within:ring-foreground">
                  {entry.poster ? (
                    <img src={entry.poster} alt="" loading="lazy" className="size-full object-cover" />
                  ) : (
                    <div className="flex size-full items-center justify-center">
                      <Film className="size-6 text-muted-foreground" />
                    </div>
                  )}
                  <div className="absolute inset-0 flex items-center justify-center bg-black/0 opacity-0 transition group-hover:bg-black/40 group-hover:opacity-100">
                    <Play className="size-10 fill-white text-white" />
                  </div>
                  {item.share > 0 && (
                    <div className="absolute inset-x-0 bottom-0 h-1.5 bg-black/60">
                      <div className="h-full bg-primary" style={{ width: `${Math.max(4, item.share * 100)}%` }} />
                    </div>
                  )}
                </div>
                <div className="min-w-0 px-0.5">
                  <p className="truncate text-sm font-medium">{entry.name}</p>
                  <p className={`truncate text-xs ${item.isNext ? "text-primary" : "text-muted-foreground"}`}>{item.label}</p>
                </div>
              </Link>
              <button
                onClick={() => dismiss(entry.meta_id)}
                className="absolute right-1.5 top-1.5 flex size-7 items-center justify-center rounded-full bg-black/70 text-white opacity-0 transition hover:bg-black focus-visible:opacity-100 group-hover:opacity-100"
                aria-label={t("Quitar {name} de Continuar viendo", { name: entry.name })}
                title={t("Quitar de Continuar viendo")}
              >
                <X className="size-4" />
              </button>
            </div>
          );
        })}
      </BlossomCarousel>
    </section>
  );
}
