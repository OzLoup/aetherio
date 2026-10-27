import { t } from "@/i18n";
const TYPE_LABELS: Record<string, string> = {
  movie: "Películas",
  series: "Series",
  channel: "Canales",
  tv: "TV",
  anime: "Anime",
  other: "Otros",
};

export function typeLabel(type: string) {
  return TYPE_LABELS[type] ? t(TYPE_LABELS[type]) : type.charAt(0).toUpperCase() + type.slice(1);
}

/** "Popular · Películas" style title for a catalog row. */
export function catalogTitle(name: string | undefined, id: string, type: string) {
  return `${name ?? id} · ${typeLabel(type)}`;
}
