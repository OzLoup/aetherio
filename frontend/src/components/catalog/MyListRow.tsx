import { BlossomCarousel } from "@blossom-carousel/react";
import { useLibrary } from "@/hooks/useLibrary";
import { hideAdult } from "@/lib/stremio";
import { PosterCard } from "./PosterCard";
import { t } from "@/i18n";

/** "Mi lista" on Home: newest first; hidden while empty. */
export function MyListRow() {
  const { items } = useLibrary();
  const visible = (items ?? []).filter((i) => !hideAdult.meta({ id: i.meta_id, type: i.type, name: i.name }));
  if (!visible.length) return null;
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold">{t("Mi lista")}</h2>
      <BlossomCarousel className="-mx-4 flex snap-x scroll-px-4 gap-3 px-4 pb-2 pt-1">
        {visible.map((i) => (
          <div key={i.meta_id} data-blossom-slide className="w-32 shrink-0 snap-start sm:w-40">
            <PosterCard
              meta={{ id: i.meta_id, type: i.type, name: i.name, poster: i.poster ?? undefined, posterShape: i.poster_shape ?? undefined }}
            />
          </div>
        ))}
      </BlossomCarousel>
    </section>
  );
}
