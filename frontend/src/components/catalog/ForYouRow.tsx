import { BlossomCarousel } from "@blossom-carousel/react";
import { useEffect, useState } from "react";
import { getHistory, type ProgressEntry } from "@/api/progress";
import { useAddons } from "@/hooks/useAddons";
import { useLibrary } from "@/hooks/useLibrary";
import { useRatings } from "@/hooks/useRatings";
import { buildTaste, genresOf, hasEnoughSignals, rankForYou, topGenres, type Signal } from "@/lib/forYou";
import { browsableCatalogs, genreOptions, getCatalog, getMeta, type MetaPreview } from "@/lib/stremio";
import { PosterCard } from "./PosterCard";
import { t } from "@/i18n";

// How many recent watched/saved titles to look up for their genres.
const LOOKUPS = 12;

/** "Para ti": popular titles in the genres this profile likes (from its
 * ratings, what it watched and Mi lista), minus what it already knows.
 * Hidden until there's enough to go on. Everything runs on the device. */
export function ForYouRow() {
  const { active, loading } = useAddons();
  const { ratings } = useRatings();
  const { items: saved } = useLibrary();
  const [items, setItems] = useState<MetaPreview[] | null>(null);

  useEffect(() => {
    if (loading || ratings === null || saved === null) return;
    let cancelled = false;
    (async () => {
      const history = await getHistory().catch(() => [] as ProgressEntry[]);
      const rated = new Set(ratings.map((r) => r.meta_id));

      // Genres of watched/saved titles that weren't rated (ratings carry theirs).
      const toLookUp = [
        ...history.filter((h) => h.watched).map((h) => ({ id: h.meta_id, type: h.type, kind: "watched" as const })),
        ...saved.map((s) => ({ id: s.meta_id, type: s.type, kind: "saved" as const })),
      ]
        .filter((x, i, all) => !rated.has(x.id) && all.findIndex((y) => y.id === x.id) === i)
        .slice(0, LOOKUPS);
      const looked = await Promise.all(
        toLookUp.map(async (x): Promise<Signal | null> => {
          const found = await getMeta(active, x.type, x.id).catch(() => null);
          return found ? { kind: x.kind, genres: genresOf(found.meta) } : null;
        }),
      );
      const signals: Signal[] = [
        ...ratings.map((r): Signal => ({ kind: "rating", rating: r.rating, genres: r.genres })),
        ...looked.filter((s): s is Signal => s !== null),
      ];
      if (!hasEnoughSignals(signals)) {
        if (!cancelled) setItems([]);
        return;
      }

      const taste = buildTaste(signals);
      const genres = topGenres(taste, 3);
      // Movie and series catalogs that can filter by those genres (Cinemeta's
      // "Popular", or any addon's), one per type.
      const sources = ["movie", "series"].flatMap((type) => {
        for (const addon of active) {
          const catalog = browsableCatalogs(addon.manifest).find((c) => c.type === type && genreOptions(c).length);
          if (catalog) return [{ addon, catalog }];
        }
        return [];
      });
      const requests = sources.flatMap(({ addon, catalog }) =>
        genres
          .filter((g) => genreOptions(catalog).includes(g))
          .map((g) => getCatalog(addon, catalog.type, catalog.id, { genre: g }).catch(() => [] as MetaPreview[])),
      );
      const candidates = (await Promise.all(requests)).flat();
      const exclude = new Set([...rated, ...history.map((h) => h.meta_id), ...saved.map((s) => s.meta_id)]);
      if (!cancelled) setItems(rankForYou(candidates, taste, exclude));
    })();
    return () => {
      cancelled = true;
    };
    // Recompute when tastes change (a new rating, something saved).
  }, [active, loading, ratings, saved]);

  if (!items?.length) return null;
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold">{t("Para ti")}</h2>
      <BlossomCarousel className="-mx-4 flex snap-x scroll-px-4 gap-3 px-4 pb-2 pt-1">
        {items.map((m) => (
          <div key={m.id} data-blossom-slide className="w-32 shrink-0 snap-start sm:w-40">
            <PosterCard meta={m} />
          </div>
        ))}
      </BlossomCarousel>
    </section>
  );
}
