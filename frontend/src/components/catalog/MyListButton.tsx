import { Check, Plus } from "lucide-react";
import { useLibrary } from "@/hooks/useLibrary";
import type { MetaPreview } from "@/lib/stremio";
import { cn } from "@/lib/utils";
import { t } from "@/i18n";

/** Add/remove a title from "Mi lista": icon only (the label is the tooltip),
 * same height as the rating buttons. */
export function MyListButton({ meta }: { meta: Pick<MetaPreview, "id" | "type" | "name" | "poster" | "posterShape"> }) {
  const { has, add, remove } = useLibrary();
  const saved = has(meta.id);
  const label = saved ? t("Quitar de Mi lista") : t("Agregar a Mi lista");
  return (
    <button
      type="button"
      aria-pressed={saved}
      aria-label={label}
      title={label}
      onClick={() =>
        void (saved
          ? remove(meta.id)
          : add({ meta_id: meta.id, type: meta.type, name: meta.name, poster: meta.poster ?? null, poster_shape: meta.posterShape ?? null })
        ).catch(() => {})
      }
      className={cn(
        "flex size-11 shrink-0 items-center justify-center rounded-lg border border-border transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        saved ? "text-primary" : "text-foreground",
      )}
    >
      {saved ? <Check className="size-5" /> : <Plus className="size-5" />}
    </button>
  );
}
