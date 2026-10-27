import { api } from "./client";

/** What a progress row needs to know about the title (drawn without addons). */
export interface ProgressContext {
  metaId: string;
  type: string;
  name: string;
  poster?: string;
  season?: number;
  episode?: number;
  episodeTitle?: string;
}

export interface ProgressEntry {
  video_id: string;
  meta_id: string;
  type: string;
  name: string;
  poster: string | null;
  season: number | null;
  episode: number | null;
  episode_title: string | null;
  position: number;
  duration: number;
  watched: boolean;
  updated_at: string;
}

const enc = encodeURIComponent;

export async function saveProgress(videoId: string, ctx: ProgressContext, position: number, duration: number) {
  await api.put(
    `/progress/video/${enc(videoId)}`,
    {
      meta_id: ctx.metaId,
      type: ctx.type,
      name: ctx.name,
      poster: ctx.poster ?? null,
      season: ctx.season ?? null,
      episode: ctx.episode ?? null,
      episode_title: ctx.episodeTitle ?? null,
      position,
      duration,
    },
  );
}

export async function getVideoProgress(videoId: string) {
  const { data } = await api.get<ProgressEntry | null>(`/progress/video/${enc(videoId)}`);
  return data;
}

export async function getMetaProgress(metaId: string) {
  const { data } = await api.get<ProgressEntry[]>(`/progress/meta/${enc(metaId)}`);
  return data;
}

export async function getContinueWatching() {
  const { data } = await api.get<ProgressEntry[]>("/progress/continue");
  return data;
}

export async function getHistory() {
  const { data } = await api.get<ProgressEntry[]>("/progress/history");
  return data;
}

export async function markWatched(
  ctx: Omit<ProgressContext, "season" | "episode" | "episodeTitle">,
  videos: { videoId: string; season?: number; episode?: number; episodeTitle?: string }[],
  watched: boolean,
) {
  await api.post("/progress/watched", {
    meta_id: ctx.metaId,
    type: ctx.type,
    name: ctx.name,
    poster: ctx.poster ?? null,
    watched,
    videos: videos.map((v) => ({
      video_id: v.videoId,
      season: v.season ?? null,
      episode: v.episode ?? null,
      episode_title: v.episodeTitle ?? null,
    })),
  });
}

export async function dismissFromContinue(metaId: string) {
  await api.post(`/progress/meta/${enc(metaId)}/dismiss`);
}

export async function deleteFromHistory(videoId: string) {
  await api.delete(`/progress/video/${enc(videoId)}`);
}

/** Resume point worth offering (seconds), or 0. */
export function resumePoint(p: ProgressEntry | null | undefined) {
  if (!p || p.watched || p.position < 30) return 0;
  // Within the last 2 minutes: credits, start over instead.
  if (p.duration && p.duration - p.position < 120) return 0;
  return p.position;
}
