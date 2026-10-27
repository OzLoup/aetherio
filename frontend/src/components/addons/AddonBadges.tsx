import { Badge } from "@/components/ui/badge";
import { typeLabel } from "@/lib/labels";
import { resourceNames, type Manifest } from "@/lib/stremio";
import { t } from "@/i18n";

const RESOURCE_LABELS: Record<string, string> = {
  catalog: "Catálogos",
  meta: "Metadatos",
  stream: "Streams",
  subtitles: "Subtítulos",
  addon_catalog: "Addons",
};


export function AddonBadges({ manifest }: { manifest: Manifest }) {
  const hints = manifest.behaviorHints ?? {};
  return (
    <div className="flex flex-wrap gap-1.5">
      {resourceNames(manifest).map((r) => (
        <Badge key={`r-${r}`} variant="primary">
          {RESOURCE_LABELS[r] ? t(RESOURCE_LABELS[r]) : r}
        </Badge>
      ))}
      {manifest.types.map((item) => (
        <Badge key={`item-${item}`}>{typeLabel(item)}</Badge>
      ))}
      {hints.p2p && <Badge variant="warning">P2P</Badge>}
      {hints.adult && <Badge variant="destructive">+18</Badge>}
    </div>
  );
}
