/**
 * IPTV M3U playlists (live TV). Reads the common "extended M3U" format:
 *
 *   #EXTINF:-1 tvg-id="x" tvg-logo="https://…" group-title="News;Public",Canal 5 (1080p)
 *   #EXTVLCOPT:http-referrer=https://…        (optional, per channel)
 *   https://…/index.m3u8
 */

export interface Channel {
  /** Stable id within the app (from the URL). */
  id: string;
  name: string;
  logo?: string;
  groups: string[];
  url: string;
  /** Headers some servers require (Referer, User-Agent). */
  headers?: Record<string, string>;
}

const ATTR = /([a-zA-Z0-9-]+)="([^"]*)"/g;

function hash(s: string) {
  // FNV-1a, enough to give each channel a short stable id.
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

export function parseM3u(text: string): Channel[] {
  const channels: Channel[] = [];
  let pending: { name: string; attrs: Record<string, string>; headers: Record<string, string> } | null = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith("#EXTINF")) {
      const comma = line.lastIndexOf(",");
      const head = comma >= 0 ? line.slice(0, comma) : line;
      const attrs: Record<string, string> = {};
      for (const m of head.matchAll(ATTR)) attrs[m[1].toLowerCase()] = m[2];
      const headers: Record<string, string> = {};
      if (attrs["http-referrer"]) headers.Referer = attrs["http-referrer"];
      if (attrs["http-user-agent"]) headers["User-Agent"] = attrs["http-user-agent"];
      pending = { name: (comma >= 0 ? line.slice(comma + 1) : "").trim(), attrs, headers };
    } else if (line.startsWith("#EXTVLCOPT:") && pending) {
      const [key, ...rest] = line.slice("#EXTVLCOPT:".length).split("=");
      const value = rest.join("=");
      if (key === "http-referrer") pending.headers.Referer = value;
      if (key === "http-user-agent") pending.headers["User-Agent"] = value;
    } else if (!line.startsWith("#") && pending) {
      const url = line;
      const groups = (pending.attrs["group-title"] ?? "")
        .split(";")
        .map((g) => g.trim())
        .filter((g) => g && g !== "Undefined");
      channels.push({
        id: hash(url),
        name: pending.name || pending.attrs["tvg-name"] || url,
        logo: pending.attrs["tvg-logo"] || undefined,
        groups: groups.length ? groups : ["General"],
        url,
        headers: Object.keys(pending.headers).length ? pending.headers : undefined,
      });
      pending = null;
    }
  }
  return channels;
}

/** iptv-org's English category names, for the group chips. */
const GROUP_LABELS: Record<string, string> = {
  General: "General",
  Religious: "Religión",
  Music: "Música",
  Entertainment: "Entretenimiento",
  News: "Noticias",
  Movies: "Películas",
  Sports: "Deportes",
  Series: "Series",
  Kids: "Infantil",
  Legislative: "Legislativo",
  Education: "Educación",
  Culture: "Cultura",
  Animation: "Animación",
  Documentary: "Documentales",
  Public: "Pública",
  Lifestyle: "Estilo de vida",
  Outdoor: "Aire libre",
  Comedy: "Comedia",
  Travel: "Viajes",
  Family: "Familia",
  Classic: "Clásicos",
  Cooking: "Cocina",
  Business: "Negocios",
  Auto: "Autos",
  Science: "Ciencia",
  Weather: "Clima",
  Shop: "Compras",
};

/** Spanish label of a group (translate with t() where shown). */
export function groupLabel(group: string) {
  return GROUP_LABELS[group] ?? group;
}
