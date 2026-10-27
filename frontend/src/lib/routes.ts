/** Detail page URL. Ids can contain ":" or "/" (e.g. "kitsu:123"), so encode. */
export function detailPath(type: string, id: string) {
  return `/detail/${encodeURIComponent(type)}/${encodeURIComponent(id)}`;
}

import type { ProgressContext } from "@/api/progress";

/** Stream picker for a playable item (a movie, or one episode: "tt123:1:2").
 * `ctx` travels in the URL so the progress can be saved even after a reload. */
export function streamsPath(type: string, videoId: string, title: string, ctx?: ProgressContext) {
  const params = new URLSearchParams({ title });
  if (ctx) {
    params.set("m", ctx.metaId);
    params.set("n", ctx.name);
    if (ctx.poster) params.set("p", ctx.poster);
    if (ctx.season !== undefined) params.set("s", String(ctx.season));
    if (ctx.episode !== undefined) params.set("e", String(ctx.episode));
    if (ctx.episodeTitle) params.set("et", ctx.episodeTitle);
  }
  return `/streams/${encodeURIComponent(type)}/${encodeURIComponent(videoId)}?${params}`;
}

export function progressContextFrom(params: URLSearchParams, type: string, videoId: string): ProgressContext {
  const num = (k: string) => (params.get(k) !== null && params.get(k) !== "" ? Number(params.get(k)) : undefined);
  return {
    // Fallback for old links: "tt123:1:2" belongs to "tt123", "kitsu:1:5" to "kitsu:1".
    metaId: params.get("m") ?? (type === "series" ? videoId.split(":").slice(0, -2).join(":") || videoId : videoId),
    type,
    name: params.get("n") ?? params.get("title") ?? videoId,
    poster: params.get("p") ?? undefined,
    season: num("s"),
    episode: num("e"),
    episodeTitle: params.get("et") ?? undefined,
  };
}

export function playerPath(type: string, videoId: string) {
  return `/play/${encodeURIComponent(type)}/${encodeURIComponent(videoId)}`;
}

export function discoverHref(addonId: number, type: string, catalogId: string) {
  return `/discover?${new URLSearchParams({ addon: String(addonId), type, catalog: catalogId })}`;
}
