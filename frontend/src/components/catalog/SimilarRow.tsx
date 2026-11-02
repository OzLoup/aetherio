import { BlossomCarousel } from "@blossom-carousel/react";
import { useEffect, useState } from "react";
import { API_BASE_URL } from "@/api/client";
import { useProfiles } from "@/context/ProfileContext";
import { hideAdult, type MetaPreview } from "@/lib/stremio";
import { PosterCard } from "./PosterCard";
import { t } from "@/i18n";

/** "Títulos similares" on a detail page (TMDB recommendations, via our
 * backend). Hidden while loading, for non-IMDb ids, or when there's none. */
export function SimilarRow({ type, id }: { type: string; id: string }) {
  const { current } = useProfiles();
  const language = current?.language ?? "es-419";
  const [items, setItems] = useState<MetaPreview[]>([]);

  useEffect(() => {
    if (!id.startsWith("tt") || (type !== "movie" && type !== "series")) return;
    let cancelled = false;
    const url = `${API_BASE_URL}/stremio/tmdb/similar/${type}/${encodeURIComponent(id)}.json?lang=${encodeURIComponent(language)}`;
    fetch(url)
      .then((r) => (r.ok ? r.json() : { metas: [] }))
      .then((d: { metas?: MetaPreview[] }) => !cancelled && setItems(d.metas ?? []))
      .catch(() => !cancelled && setItems([]));
    return () => {
      cancelled = true;
      setItems([]);
    };
  }, [type, id, language]);

  const visible = items.filter((m) => !hideAdult.meta(m));
  if (!visible.length) return null;
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-xl font-semibold">{t("Títulos similares")}</h2>
      <BlossomCarousel className="-mx-4 flex snap-x scroll-px-4 gap-3 px-4 pb-2 pt-1">
        {visible.map((m) => (
          <div key={m.id} data-blossom-slide className="w-32 shrink-0 snap-start sm:w-40">
            <PosterCard meta={m} />
          </div>
        ))}
      </BlossomCarousel>
    </section>
  );
}
