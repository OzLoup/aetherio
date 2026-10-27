import type { MetaPreview } from "@/lib/stremio";
import { PosterCard, PosterSkeleton } from "./PosterCard";

const GRID = "grid grid-cols-[repeat(auto-fill,minmax(8rem,1fr))] gap-x-3 gap-y-5 sm:grid-cols-[repeat(auto-fill,minmax(10rem,1fr))]";

export function PosterGrid({ items }: { items: MetaPreview[] }) {
  return (
    <div className={GRID}>
      {items.map((m) => (
        <PosterCard key={m.id} meta={m} />
      ))}
    </div>
  );
}

export function PosterGridSkeleton({ count = 18 }: { count?: number }) {
  return (
    <div className={GRID}>
      {Array.from({ length: count }, (_, i) => (
        <PosterSkeleton key={i} />
      ))}
    </div>
  );
}
