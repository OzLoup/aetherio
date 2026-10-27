import { Check, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useLibrary } from "@/hooks/useLibrary";
import type { MetaPreview } from "@/lib/stremio";
import { t } from "@/i18n";

/** Add/remove a title from "Mi lista". */
export function MyListButton({ meta, size = "lg" }: { meta: Pick<MetaPreview, "id" | "type" | "name" | "poster" | "posterShape">; size?: "lg" | "default" | "sm" }) {
  const { has, add, remove } = useLibrary();
  const saved = has(meta.id);
  return (
    <Button
      size={size}
      variant="outline"
      aria-pressed={saved}
      onClick={() =>
        void (saved
          ? remove(meta.id)
          : add({ meta_id: meta.id, type: meta.type, name: meta.name, poster: meta.poster ?? null, poster_shape: meta.posterShape ?? null })
        ).catch(() => {})
      }
    >
      {saved ? <Check /> : <Plus />}
      {saved ? t("En mi lista") : t("Mi lista")}
    </Button>
  );
}
