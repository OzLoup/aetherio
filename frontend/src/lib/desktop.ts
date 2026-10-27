/**
 * Bridge to the macOS app's local video server (desktop/src/media-server.mjs).
 * `desktop` is undefined on the website: everything here is optional.
 */
import { subtitleLabel, type StreamLang } from "@/lib/languages";
import { t as tr } from "@/i18n";

export interface DesktopInfo {
  mediaBase: string;
  mediaToken: string;
  platform: string;
  version: string;
  /** Open a link in the system browser. */
  openExternal: (url: string) => Promise<void>;
  /** macOS → Privacy & Security → Local Network. */
  openLocalNetworkSettings: () => Promise<void>;
  /** Cast to Chromecast / DLNA TVs on the local network (macOS app). */
  cast: DesktopCast;
  /** Google login result coming back through aetherio://; returns unsubscribe. */
  onAuth: (callback: (payload: { token: string | null; error: string | null }) => void) => () => void;
}

export interface CastDevice {
  id: string;
  name: string;
  kind: "chromecast" | "dlna";
  host: string;
}

export interface CastStatus {
  id: string;
  device: string;
  state: string; // PLAYING / PAUSED / BUFFERING / IDLE
  currentTime: number;
  duration: number | null;
  idleReason: string | null;
}

/** What to cast: the original link (direct) or re-packaged by the Mac. */
export interface DesktopCastMedia {
  title: string;
  url: string;
  headers?: Record<string, string>;
  direct: boolean;
  contentType: string;
  audio: number;
  videoCodec?: string;
  videoMode: "copy" | "h264";
  duration: number | null;
  start: number;
  vtt?: string;
}

export interface DesktopCast {
  list: () => Promise<CastDevice[]>;
  refresh: () => Promise<void>;
  play: (deviceId: string, media: DesktopCastMedia) => Promise<{ device: string; kind: string }>;
  pause: () => Promise<void>;
  resume: () => Promise<void>;
  seek: (t: number) => Promise<void>;
  stop: () => Promise<void>;
  onDevices: (cb: (devices: CastDevice[]) => void) => () => void;
  onStatus: (cb: (status: CastStatus) => void) => () => void;
}

export const desktop: DesktopInfo | undefined =
  typeof window === "undefined" ? undefined : (window as unknown as { desktop?: DesktopInfo }).desktop;

export interface ProbeAudio {
  order: number;
  codec: string;
  channels?: number;
  language: string | null;
  title: string | null;
  default: boolean;
}

export interface ProbeSubtitle {
  order: number;
  codec: string;
  language: string | null;
  title: string | null;
  text: boolean;
  forced: boolean;
}

export interface ProbeInfo {
  duration: number | null;
  container: string | null;
  video: { codec: string; width: number; height: number } | null;
  audio: ProbeAudio[];
  subtitles: ProbeSubtitle[];
}

type Headers = Record<string, string> | undefined;

function toBase64Url(text: string) {
  return btoa(unescape(encodeURIComponent(text))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function endpoint(path: string, url: string, headers: Headers, extra: Record<string, string | number> = {}) {
  if (!desktop) throw new Error("not running in the desktop app");
  const params = new URLSearchParams({ t: desktop.mediaToken, u: url });
  if (headers && Object.keys(headers).length) params.set("h", toBase64Url(JSON.stringify(headers)));
  for (const [k, v] of Object.entries(extra)) params.set(k, String(v));
  return `${desktop.mediaBase}${path}?${params}`;
}

async function getJson<T>(href: string): Promise<T> {
  const res = await fetch(href);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
  return data as T;
}

export function probeMedia(url: string, headers?: Headers, fresh = false) {
  return getJson<ProbeInfo>(endpoint("/probe", url, headers, fresh ? { fresh: Date.now() } : {}));
}

/** Copying video can only start on a keyframe: where a seek to `ss` lands. */
export async function seekpoint(url: string, headers: Headers, ss: number) {
  if (ss <= 0) return 0;
  return (await getJson<{ start: number }>(endpoint("/seekpoint", url, headers, { ss }))).start;
}

export function streamUrl(
  url: string,
  headers: Headers,
  opts: { audio: number; start: number; videoCodec?: string; videoMode?: "copy" | "h264" },
) {
  return endpoint("/stream", url, headers, {
    a: opts.audio,
    ss: Math.max(0, Math.round(opts.start * 1000) / 1000),
    vm: opts.videoMode ?? "copy",
    ...(opts.videoCodec ? { vc: opts.videoCodec } : {}),
  });
}

export function embeddedSubtitleUrl(url: string, headers: Headers, order: number) {
  return endpoint("/subtitle", url, headers, { s: order });
}

// ffprobe reports both MKV and WebM as "matroska,webm": send those through
// the local server rather than guess.
const DIRECT_CONTAINERS = /mp4|mov/;
const DIRECT_VIDEO = ["h264", "hevc", "vp9", "av1"];
const DIRECT_AUDIO = ["aac", "mp3", "opus", "vorbis", "flac"];

/** Can the built-in player play the file untouched (and with this track)? */
export function canPlayDirect(info: ProbeInfo, audioOrder: number) {
  if (!info.container || !DIRECT_CONTAINERS.test(info.container)) return false;
  if (!info.video || !DIRECT_VIDEO.includes(info.video.codec)) return false;
  // Several tracks: the browser would play only the default one, so a file
  // with more than one goes through the local server (which picks).
  if (info.audio.length > 1) return false;
  return info.audio.every((a) => a.order === audioOrder && DIRECT_AUDIO.includes(a.codec));
}

const SPANISH = ["spa", "es", "esp", "spn", "es-419", "es-mx", "es-es"];
const LATINO_HINT = /lat|latino|latam|419|m[eé]x|hispano/i;
const SPAIN_HINT = /castellano|castilian|espa[ñn]a|\bspain\b|\bes-es\b|\bcast\b/i;

/** Best audio track for the profile language (es-419 prefers tracks titled
 * "Latino" over Castellano). Falls back to the file's default track. */
export function pickAudioTrack(tracks: ProbeAudio[], profileLanguage: string) {
  if (!tracks.length) return 0;
  const lang = (t: ProbeAudio) => (t.language ?? "").toLowerCase();
  const text = (t: ProbeAudio) => `${t.title ?? ""} ${t.language ?? ""}`;
  const score = (t: ProbeAudio) => {
    if (profileLanguage === "es-419" || profileLanguage === "es-ES") {
      if (!SPANISH.includes(lang(t)) && !/espa[ñn]ol|spanish|latino|castellano/i.test(text(t))) return 0;
      const wantLatino = profileLanguage === "es-419";
      if (LATINO_HINT.test(text(t))) return wantLatino ? 3 : 1;
      if (SPAIN_HINT.test(text(t))) return wantLatino ? 1 : 3;
      return 2;
    }
    if (profileLanguage === "en") return ["eng", "en"].includes(lang(t)) ? 3 : 0;
    if (profileLanguage === "pt-BR") return ["por", "pt", "pob", "pt-br"].includes(lang(t)) ? 3 : 0;
    return 0;
  };
  let best = tracks.find((t) => t.default) ?? tracks[0];
  let bestScore = score(best);
  for (const t of tracks) {
    const s = score(t);
    if (s > bestScore) {
      best = t;
      bestScore = s;
    }
  }
  return best.order;
}

/** Is this audio track in the profile's language (so subtitles can stay off)? */
export function isTrackInLanguage(t: ProbeAudio | undefined, profileLanguage: string) {
  if (!t) return false;
  const lang = (t.language ?? "").toLowerCase();
  if (profileLanguage.startsWith("es")) return SPANISH.includes(lang) || /espa[ñn]ol|spanish|latino|castellano/i.test(t.title ?? "");
  if (profileLanguage === "en") return ["eng", "en"].includes(lang);
  if (profileLanguage === "pt-BR") return ["por", "pt", "pob", "pt-br"].includes(lang);
  return false;
}

/** A real audio track as one of our stream language tags. */
export function trackStreamLang(t: ProbeAudio): StreamLang | null {
  const lang = (t.language ?? "").toLowerCase();
  const text = `${t.title ?? ""} ${t.language ?? ""}`;
  if (SPANISH.includes(lang) || /espa[ñn]ol|spanish|latino|castellano/i.test(t.title ?? "")) {
    if (LATINO_HINT.test(text)) return "latino";
    if (SPAIN_HINT.test(text)) return "castellano";
    return "espanol";
  }
  if (["eng", "en"].includes(lang)) return "english";
  if (["jpn", "ja"].includes(lang)) return "japones";
  if (["por", "pt", "pob", "pt-br"].includes(lang)) return "portugues";
  return null;
}

/** Audio languages a file really has (no "multi": we know them). */
export function verifiedLanguages(info: ProbeInfo): StreamLang[] {
  return [...new Set(info.audio.map(trackStreamLang).filter((l): l is StreamLang => l !== null))];
}

const CODEC_NAMES: Record<string, string> = { ac3: "AC3", eac3: "E-AC3", dts: "DTS", truehd: "TrueHD", aac: "AAC", opus: "Opus", flac: "FLAC", mp3: "MP3" };

export function audioTrackLabel(t: ProbeAudio) {
  const language = t.language && t.language !== "und" ? subtitleLabel(t.language) : tr("Pista {n}", { n: t.order + 1 });
  const title = t.title && !language.toLowerCase().includes(t.title.toLowerCase()) ? ` — ${t.title}` : "";
  const channels = t.channels ? (t.channels >= 6 ? " 5.1" : t.channels === 2 ? ` ${tr("estéreo")}` : "") : "";
  return `${language}${title} (${CODEC_NAMES[t.codec] ?? t.codec}${channels})`;
}

export function subtitleTrackLabel(s: ProbeSubtitle) {
  const language = s.language && s.language !== "und" ? subtitleLabel(s.language) : tr("Subtítulo {n}", { n: s.order + 1 });
  const title = s.title ? ` — ${s.title}` : "";
  return `${language}${title}${s.forced ? ` (${tr("forzados")})` : ""} · ${tr("del archivo")}`;
}
