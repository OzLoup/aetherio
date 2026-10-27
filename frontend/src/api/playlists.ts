import { api } from "@/api/client";
import type { Playlist } from "@/api/types";
import { parseM3u, type Channel } from "@/lib/m3u";
import { hideAdult } from "@/lib/stremio";

/** Ready-made lists: public, free channels collected by iptv-org. */
export const PLAYLIST_PRESETS = [
  {
    name: "TV en español",
    description: "Más de 2.000 canales en español, incluidos los de Pluto TV (novelas, cine, noticias).",
    url: "https://iptv-org.github.io/iptv/languages/spa.m3u",
  },
  {
    name: "Canales de México",
    description: "Canales abiertos y locales de México.",
    url: "https://iptv-org.github.io/iptv/countries/mx.m3u",
  },
] as const;

export async function listPlaylists() {
  const { data } = await api.get<Playlist[]>("/playlists");
  return data;
}

export async function addPlaylist(name: string, url: string) {
  const { data } = await api.post<Playlist>("/playlists", { name, url });
  return data;
}

export async function removePlaylist(id: number) {
  await api.delete(`/playlists/${id}`);
}

const TTL_MS = 30 * 60 * 1000;
const cache = new Map<string, { expires: number; promise: Promise<Channel[]> }>();

/** Download and parse a list: straight from its server (like addons), or
 * through our backend when the server doesn't let web pages read it. Adult
 * groups are left out on profiles without adult content. */
export function loadChannels(playlist: Playlist): Promise<Channel[]> {
  const hit = cache.get(playlist.url);
  const promise =
    hit && hit.expires > Date.now()
      ? hit.promise
      : (async () => {
          let text: string;
          try {
            const res = await fetch(playlist.url);
            if (!res.ok) throw new Error(String(res.status));
            text = await res.text();
          } catch {
            const { data } = await api.get<string>(`/playlists/${playlist.id}/content`, { responseType: "text" });
            text = data;
          }
          return parseM3u(text);
        })();
  if (!hit || hit.promise !== promise) {
    cache.set(playlist.url, { expires: Date.now() + TTL_MS, promise });
    promise.catch(() => cache.delete(playlist.url));
  }
  return promise.then((channels) =>
    channels.filter((c) => !c.groups.some(hideAdult.group) && !hideAdult.group(c.name)),
  );
}
