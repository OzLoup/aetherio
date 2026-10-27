import { Heart, ThumbsDown, ThumbsUp } from "lucide-react";
import type { RatingValue } from "@/api/ratings";
import { useRatings } from "@/hooks/useRatings";
import { genresOf } from "@/lib/forYou";
import type { MetaPreview } from "@/lib/stremio";
import { cn } from "@/lib/utils";
import { t } from "@/i18n";

const OPTIONS: { value: RatingValue; icon: typeof ThumbsUp; label: string }[] = [
  { value: -1, icon: ThumbsDown, label: "No me gusta" },
  { value: 1, icon: ThumbsUp, label: "Me gusta" },
  { value: 2, icon: Heart, label: "Me encanta" },
];

/** Three icon-only buttons (the label shows as a tooltip). Tapping the
 * chosen one again takes the rating back. */
export function RatingButtons({ meta }: { meta: MetaPreview }) {
  const { ratingOf, rate } = useRatings();
  const current = ratingOf(meta.id);
  return (
    <div className="flex items-center gap-1 rounded-lg border border-border p-1" role="group" aria-label={t("Calificar")}>
      {OPTIONS.map(({ value, icon: Icon, label }) => {
        const on = current === value;
        return (
          <button
            key={value}
            type="button"
            aria-pressed={on}
            aria-label={t(label)}
            title={t(label)}
            onClick={() =>
              void rate(
                { meta_id: meta.id, type: meta.type, name: meta.name, poster: meta.poster ?? null, genres: genresOf(meta) },
                value,
              ).catch(() => {})
            }
            className={cn(
              "flex size-9 items-center justify-center rounded-md transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              on ? (value === 2 ? "text-rose-500" : "text-primary") : "text-muted-foreground",
            )}
          >
            <Icon className={cn("size-5", on && "fill-current")} />
          </button>
        );
      })}
    </div>
  );
}
