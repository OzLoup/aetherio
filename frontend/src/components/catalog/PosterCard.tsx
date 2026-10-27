import { Film, Star } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { TiltCard } from "@/components/motion/TiltCard";
import { detailPath } from "@/lib/routes";
import type { MetaPreview, PosterShape } from "@/lib/stremio";
import { cn } from "@/lib/utils";

const ASPECT: Record<PosterShape, string> = {
  poster: "aspect-[2/3]",
  square: "aspect-square",
  landscape: "aspect-video",
};

export const CARD_WIDTH: Record<PosterShape, string> = {
  poster: "w-32 sm:w-40",
  square: "w-36 sm:w-44",
  landscape: "w-56 sm:w-72",
};

export function PosterCard({ meta, className }: { meta: MetaPreview; className?: string }) {
  const shape = meta.posterShape ?? "poster";
  const [failed, setFailed] = useState(false);
  const year = meta.releaseInfo ?? meta.year;

  return (
    <Link
      to={detailPath(meta.type, meta.id)}
      className={cn("group flex flex-col gap-2 rounded-lg focus-visible:outline-none", className)}
      title={meta.name}
    >
      <TiltCard className={ASPECT[shape]}>
      <div
        className={cn(
          "relative size-full overflow-hidden rounded-lg bg-muted shadow-md ring-offset-2 ring-offset-background transition group-hover:shadow-xl group-hover:ring-2 group-hover:ring-primary group-focus-visible:ring-4 group-focus-visible:ring-foreground",
        )}
      >
        {meta.poster && !failed ? (
          <img
            src={meta.poster}
            alt=""
            loading="lazy"
            decoding="async"
            onError={() => setFailed(true)}
            className="size-full object-cover transition-transform duration-300 group-hover:scale-105 group-focus-visible:scale-105"
          />
        ) : (
          <div className="flex size-full flex-col items-center justify-center gap-2 p-3 text-center">
            <Film className="size-6 text-muted-foreground" />
            <span className="line-clamp-3 text-xs font-medium">{meta.name}</span>
          </div>
        )}
        {meta.imdbRating && (
          <span className="absolute right-1.5 top-1.5 flex items-center gap-0.5 rounded-md bg-black/70 px-1.5 py-0.5 text-[11px] font-semibold text-white">
            <Star className="size-3 fill-current text-yellow-400" />
            {meta.imdbRating}
          </span>
        )}
      </div>
      </TiltCard>
      <div className="min-w-0 px-0.5">
        <p className="truncate text-sm font-medium">{meta.name}</p>
        {year && <p className="truncate text-xs text-muted-foreground">{year}</p>}
      </div>
    </Link>
  );
}

export function PosterSkeleton({ shape = "poster", className }: { shape?: PosterShape; className?: string }) {
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <div className={cn("animate-pulse rounded-lg bg-muted", ASPECT[shape])} />
      <div className="h-3.5 w-3/4 animate-pulse rounded bg-muted" />
    </div>
  );
}
