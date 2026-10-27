import { Loader2 } from "lucide-react";
import { CatalogRow } from "@/components/catalog/CatalogRow";
import { ContinueWatching } from "@/components/catalog/ContinueWatching";
import { FeaturedHero } from "@/components/catalog/FeaturedHero";
import { ScrollReveal } from "@/components/motion/ScrollReveal";
import { SuggestedAddons } from "@/components/catalog/SuggestedAddons";
import { useAddons } from "@/hooks/useAddons";
import { catalogTitle } from "@/lib/labels";
import { discoverHref } from "@/lib/routes";
import { browsableCatalogs } from "@/lib/stremio";


/** One row per browsable catalog of every enabled addon, in addon priority order. */
export default function Home() {
  const { active, loading } = useAddons();
  const rows = active.flatMap((addon) =>
    browsableCatalogs(addon.manifest)
      // Live channels have their own page (TV en vivo).
      .filter((catalog) => catalog.type !== "tv")
      .map((catalog) => ({ addon, catalog })),
  );

  if (loading) {
    return (
      <div className="flex justify-center py-24">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (rows.length === 0) return <SuggestedAddons />;
  // Hero: the first "Popular" movies catalog if there is one, else the first row.
  const featured = rows.find((r) => r.catalog.type === "movie" && r.catalog.id === "top") ?? rows[0];

  return (
    <div className="flex flex-col gap-8">
      <FeaturedHero addon={featured.addon} type={featured.catalog.type} catalogId={featured.catalog.id} />
      <ScrollReveal>
        <ContinueWatching />
      </ScrollReveal>
      {rows.map(({ addon, catalog }) => (
        <ScrollReveal key={`${addon.id}|${catalog.type}|${catalog.id}`}>
        <CatalogRow
          key={`${addon.id}|${catalog.type}|${catalog.id}`}
          title={catalogTitle(catalog.name, catalog.id, catalog.type)}
          subtitle={addon.manifest.name}
          addon={addon}
          type={catalog.type}
          catalogId={catalog.id}
          seeAllHref={discoverHref(addon.id, catalog.type, catalog.id)}
        />
        </ScrollReveal>
      ))}
    </div>
  );
}
