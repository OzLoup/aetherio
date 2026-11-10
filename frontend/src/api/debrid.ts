import { api } from "./client";
import type { ProgressContext } from "./progress";
import type { TorrentRef } from "@/lib/streams";

export interface DebridAccount {
  connected: boolean;
  valid?: boolean;
  username?: string;
  premium?: boolean;
  expiration?: string;
  error?: string;
}

/** Live state of a torrent in Real-Debrid. */
export interface TorrentStatus {
  status: string;
  progress: number;
  speed: number;
  seeders: number | null;
  filename?: string | null;
  bytes?: number;
  ready: boolean;
  failed: boolean;
}

export interface DownloadSource {
  name?: string;
  title?: string;
  description?: string;
  headline?: string;
  quality?: string;
  size?: string;
  languages?: string[];
  behaviorHints?: Record<string, unknown>;
}

export interface Download extends TorrentStatus {
  id: number;
  infohash: string;
  type: string;
  meta_id: string;
  video_id: string;
  name: string;
  poster: string | null;
  season: number | null;
  episode: number | null;
  episode_title: string | null;
  source: DownloadSource;
  created_at: string | null;
}

let account: Promise<DebridAccount> | null = null;

/** The account's debrid connection (asked once, until it changes). */
export function getDebridAccount(fresh = false) {
  if (!account || fresh) {
    account = api
      .get<DebridAccount>("/debrid/account")
      .then((r) => r.data)
      .catch((e) => {
        account = null;
        throw e;
      });
  }
  return account;
}

export async function connectDebrid(key: string) {
  const { data } = await api.put<DebridAccount>("/debrid/account", { key });
  account = Promise.resolve(data);
  return data;
}

export async function disconnectDebrid() {
  await api.delete("/debrid/account");
  account = Promise.resolve({ connected: false });
}

export async function startDownload(
  ref: TorrentRef,
  videoId: string,
  ctx: ProgressContext,
  source: DownloadSource,
) {
  const { data } = await api.post<Download>("/debrid/downloads", {
    infohash: ref.infohash,
    file_idx: ref.fileIdx ?? null,
    filename: ref.filename ?? null,
    trackers: ref.trackers ?? [],
    type: ctx.type,
    meta_id: ctx.metaId,
    video_id: videoId,
    name: ctx.name,
    poster: ctx.poster ?? null,
    season: ctx.season ?? null,
    episode: ctx.episode ?? null,
    episode_title: ctx.episodeTitle ?? null,
    source,
  });
  return data;
}

export async function getDownloads() {
  const { data } = await api.get<Download[]>("/debrid/downloads");
  return data;
}

export async function getDownload(id: number) {
  const { data } = await api.get<Download>(`/debrid/downloads/${id}`);
  return data;
}

/** A direct link to the finished file. */
export async function playableLink(id: number) {
  const { data } = await api.post<{ url: string; filename?: string; size?: number }>(`/debrid/downloads/${id}/play`);
  return data;
}

export async function removeDownload(id: number, cancel: boolean) {
  await api.delete(`/debrid/downloads/${id}`, { params: { cancel } });
}

/** Progress of these torrents if they're already in the account. */
export async function torrentsStatus(hashes: string[]) {
  const { data } = await api.post<{ connected: boolean; items: Record<string, TorrentStatus & { download_id: number | null }> }>(
    "/debrid/status",
    { hashes },
  );
  return data;
}

export function downloadContext(d: Download): ProgressContext {
  return {
    metaId: d.meta_id,
    type: d.type,
    name: d.name,
    poster: d.poster ?? undefined,
    season: d.season ?? undefined,
    episode: d.episode ?? undefined,
    episodeTitle: d.episode_title ?? undefined,
  };
}
